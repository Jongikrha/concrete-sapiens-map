// ============================================================
// 데이터 저장 계층 (Storage Layer) — AppSync + DynamoDB 연동
// ============================================================
// v5: localStorage 전체 저장을 AppSync(GraphQL)로 교체.
//
// 설계: app.js/map.js/composer.js/storySheet.js/filters.js 전역의 Storage.*
// 호출부가 전부 동기 호출이라(렌더 함수 안 체인 등), 인터페이스는 계속 동기로
// 유지한다. 부팅 시 전체 스토리를 한 번 메모리 캐시(_cache)로 가져오고,
// 순수 조회 메서드는 전부 이 캐시를 대상으로 지금 코드 그대로 동작한다.
// 쓰기 메서드(saveStory/reportStory/toggleReaction/incrementShareCount)는
// 캐시를 동기로 먼저 바꾸고 즉시 반환한 뒤, AppSync mutation은 백그라운드로
// fire-and-forget 전송한다(낙관적 업데이트). 네트워크 실패 시 로컬 캐시와
// 서버가 어긋날 수 있다는 건 알려진 트레이드오프로 받아들인다 — 재시도
// 큐는 이 트래픽 규모에 과설계라 만들지 않는다.
//
// 실제 AppSync 클라이언트 생성(Amplify.configure 등)은 js/backend.js(ES
// 모듈)가 담당하고 window._backendClientReady(Promise, index.html에서 미리
// 생성)로 넘겨준다 — 이 파일은 import 문이 없는 클래식 스크립트로 남겨서
// Node(node:test)에서도 그대로 require해 테스트할 수 있게 한다.
// ============================================================

const REACTED_KEY = "concrete_sapiens_reacted_v1";
const SHARED_KEY = "concrete_sapiens_shared_v1";
const DEVICE_ID_KEY = "concrete_sapiens_device_id";

// 기억 카드에 주소를 보여줄 때 시/도 풀네임을 축약 — 카카오 역지오코딩이
// 반환하는 공식 행정구역명(예: "서울특별시")은 카드에선 장황해서 앞부분만
// 짧게 바꾼다. 개명 이력이 있는 도(강원도→강원특별자치도, 전라북도→
// 전북특별자치도)는 신/구 표기를 둘 다 매핑해둔다(2026-08-14). 전남·광주
// 통합 논의로 나오는 "전남광주통합특별시" 표기도 같은 방식으로 축약(2026-08-15).
const SIDO_ABBR = [
  ["서울특별시", "서울"],
  ["부산광역시", "부산"],
  ["대구광역시", "대구"],
  ["인천광역시", "인천"],
  ["전남광주통합특별시", "전남광주"],
  ["광주광역시", "광주"],
  ["대전광역시", "대전"],
  ["울산광역시", "울산"],
  ["세종특별자치시", "세종"],
  ["경기도", "경기"],
  ["강원특별자치도", "강원"],
  ["강원도", "강원"],
  ["충청북도", "충북"],
  ["충청남도", "충남"],
  ["전북특별자치도", "전북"],
  ["전라북도", "전북"],
  ["전라남도", "전남"],
  ["경상북도", "경북"],
  ["경상남도", "경남"],
  ["제주특별자치도", "제주"],
];

// SIDO_ABBR 중 그 자체로 이미 "도시" 단위인 광역시/특별시/세종 — getCityLabel()이
// 이 목록에 있으면 다음 토큰(구)을 안 보고 시/도명 자체를 도시명으로 쓴다.
const SIDO_IS_CITY_LEVEL = new Set([
  "서울특별시",
  "부산광역시",
  "대구광역시",
  "인천광역시",
  "전남광주통합특별시",
  "광주광역시",
  "대전광역시",
  "울산광역시",
  "세종특별자치시",
]);

// 오늘의 질문 프롬프트 목록 (매일 자정에 하나씩 결정론적으로 노출) —
// 데이터 의존 없음. 한 번 만들었다가(2026-08-11) 없앴는데(2026-08-12),
// 해시태그 칩과 같은 크기의 칩으로 다시 살렸다(2026-08-14).
const DAILY_PROMPTS = [
  "당신이 처음으로 혼자 소주를 마셨던 가게는 어디인가요?",
  "부모님과 마지막으로 손을 잡고 걸었던 길을 기억하나요?",
  "이사 가기 전, 마지막으로 눈에 담았던 우리 집 풍경은?",
  "첫 출근길, 어떤 마음으로 그 길을 걸었나요?",
  "가장 친했던 친구와 마지막으로 함께 있었던 장소는?",
  "혼자 울고 싶을 때 찾아가던 곳이 있었나요?",
  "첫사랑과 처음 손을 잡았던 곳은 어디였나요?",
  "이제는 사라진, 그리운 동네 가게가 있나요?",
  "졸업식 날, 가장 오래 머물렀던 장소는 어디였나요?",
  "누군가를 배웅하며 눈물을 참았던 곳이 있나요?",
];

// referenceDate("YYYY-MM")의 월 자리에 정확한 월 대신 넣을 수 있는 계절
// 코드 — 연도는 기억나도 월까진 확실하지 않은 경우가 많다는 피드백으로
// 도입(2026-08-21). 새 필드를 만드는 대신 기존 문자열 필드를 그대로 써서
// 백엔드 스키마 변경 없이 배포한다. 정렬(getStoryMonthSortValue)에서는
// 그 계절의 "마지막 달 바로 뒤" 위치로 끼워 넣는다 — 겨울(12월~다음해
// 2월)처럼 해를 넘기는 계절도 이렇게 하면 "그 해 12월 다음"으로 고정돼
// 애매함이 없다.
const SEASON_LABELS = { SP: "봄", SU: "여름", FA: "가을", WI: "겨울" };
const SEASON_SORT_OFFSET = { SP: 5.5, SU: 8.5, FA: 11.5, WI: 12.5 };

let client = null;
let _cache = [];
let _bannedWords = [];
// 로그인 계정으로 연결된(StoryAuthor 기반) "내 글" id 집합 — isMyStory()가
// 동기로 매번 참조해야 해서(카드 목록 렌더링 도중) 미리 캐싱해둔다.
// null이면 아직 로드 전(=isMyStory는 항상 false). auth.js가 로그인/로그아웃
// 시점에 refreshMyStoryIds()/clearMyStoryIds()로 갱신한다.
let _myStoryIds = null;

async function fetchAll(modelName) {
  const items = [];
  let nextToken = null;
  do {
    const { data, nextToken: token, errors } = await client.models[modelName].list({
      limit: 1000,
      nextToken,
    });
    if (errors) {
      console.error(`${modelName} 목록 조회 실패`, errors);
      break;
    }
    items.push(...data);
    nextToken = token;
  } while (nextToken);
  return items;
}

const Storage = {
  async init() {
    try {
      client = await window._backendClientReady;
      await this.refresh();
    } catch (e) {
      console.error("백엔드 연결 실패 — 빈 지도로 시작합니다", e);
      _cache = [];
    }
  },

  /**
   * 전체 스토리 + 금칙어 목록을 서버에서 다시 가져와 캐시를 갱신한다.
   * init()이 부팅 시 한 번 호출하고, admin.js는 로그인 직후와 각 액션
   * (숨김/삭제/복구) 이후 재호출해서 화면을 최신 상태로 유지한다.
   */
  async refresh() {
    _cache = await fetchAll("Story");
    _bannedWords = await fetchAll("BannedWord");
  },

  // client/_cache 직접 주입 — 원래 테스트 전용이었지만, admin.js도 로그인 후
  // 게스트 클라이언트 대신 관리자 권한 클라이언트를 주입하는 데 그대로
  // 재사용한다(정식 확장 지점).
  _setClient(c) {
    client = c;
  },
  _setCache(c) {
    _cache = c;
  },
  _setBannedWords(w) {
    _bannedWords = w;
  },

  getAllStories() {
    return _cache;
  },

  /**
   * onFail(선택): updateStory와 같은 이유로 필요하다 — Amplify Data 클라이언트는
   * GraphQL 레벨 에러를 reject가 아니라 `{ data: null, errors: [...] }`로 정상
   * resolve해서 돌려주기 때문에 .catch()만으로는 못 잡는다(2026-08-19,
   * updateStory 수정과 동일 패턴 적용 — 새 기억 저장도 조용히 실패할 수 있었다).
   */
  saveStory(story, { onFail } = {}) {
    _cache.push(story);
    if (client) {
      client.models.Story.create(story)
        .then(({ errors }) => {
          if (!errors) return;
          console.error("스토리 저장 실패(백그라운드)", story.id, errors);
          if (onFail) onFail(errors);
        })
        .catch((e) => {
          console.error("스토리 저장 실패(백그라운드)", story.id, e);
          if (onFail) onFail(e);
        });
    } else {
      console.error("백엔드 미연결 상태라 저장이 서버에 반영되지 않았습니다", story.id);
    }
    return story;
  },

  /**
   * 작성자 본인이 자기 글을 고칠 때 쓴다(js/composer.js 수정 모드).
   * saveStory와 같은 낙관적 업데이트 패턴 — 캐시를 먼저 바꾸고 서버 반영은
   * 백그라운드로 보낸다. id/publicId/createdAt/작성 통계(reportCount 등)는
   * fields에 안 담아 보내면 그대로 유지된다.
   *
   * onFail(선택): 서버 반영이 실패하면 호출자가 사용자에게 알릴 수 있게
   * 넘겨준다. Amplify Data 클라이언트는 GraphQL 레벨 에러(예: DynamoDB
   * ConditionalCheckFailedException)를 reject가 아니라 `{ data: null,
   * errors: [...] }`로 정상 resolve해서 돌려주기 때문에, .catch()만으로는
   * 이런 실패를 못 잡고 콘솔 로그조차 안 남는 채로 조용히 사라진다
   * (2026-08-19 확인 — 새로고침하면 방금 수정한 내용이 사라지는 버그의
   * 원인). resolve된 값의 errors도 함께 확인해야 한다.
   */
  updateStory(storyId, fields, { onFail } = {}) {
    const target = _cache.find((s) => s.id === storyId);
    if (!target) return null;
    Object.assign(target, fields);
    if (client) {
      client.models.Story.update({ id: storyId, ...fields })
        .then(({ errors }) => {
          if (!errors) return;
          console.error("스토리 수정 실패(백그라운드)", storyId, errors);
          if (onFail) onFail(errors);
        })
        .catch((e) => {
          console.error("스토리 수정 실패(백그라운드)", storyId, e);
          if (onFail) onFail(e);
        });
    }
    return target;
  },

  getVisibleStories() {
    return this.getAllStories().filter((s) => s.status !== "HIDDEN" && s.status !== "DELETED");
  },

  getStoryByPublicId(publicId) {
    return this.getAllStories().find((s) => s.publicId === publicId) || null;
  },

  reportStory(storyId) {
    const target = _cache.find((s) => s.id === storyId);
    if (!target) return null;
    target.reportCount = (target.reportCount || 0) + 1;
    if (target.reportCount >= CONFIG.REPORT_HIDE_THRESHOLD) {
      target.status = "HIDDEN";
    }
    if (client) {
      client.models.Story.update({ id: storyId, reportCount: target.reportCount, status: target.status })
        .catch((e) => console.error("신고 반영 실패(백그라운드)", storyId, e));
    }
    return target;
  },

  toggleReaction(storyId) {
    const target = _cache.find((s) => s.id === storyId);
    if (!target) return null;
    // 자기 글에는 스스로 "떠올랐어요"를 누를 수 없다 — storySheet.js가
    // 버튼을 disabled로 막아두지만, 클라이언트 상태만으로 판단하는 낙관적
    // 업데이트 계층이라 여기서도 한 번 더 막아 데이터 정합성을 지킨다.
    if (this.isMyStory(storyId)) return target;

    const reactedSet = this._getReactedSet();
    target.reactionCount = target.reactionCount || 0;

    if (reactedSet.has(storyId)) {
      target.reactionCount = Math.max(0, target.reactionCount - 1);
      reactedSet.delete(storyId);
    } else {
      target.reactionCount += 1;
      reactedSet.add(storyId);
    }

    this._saveReactedSet(reactedSet);
    if (client) {
      client.models.Story.update({ id: storyId, reactionCount: target.reactionCount })
        .catch((e) => console.error("반응 반영 실패(백그라운드)", storyId, e));
    }
    return target;
  },

  hasReacted(storyId) {
    return this._getReactedSet().has(storyId);
  },

  // "내가 반응했는지" 표시는 의도적으로 브라우저 로컬에만 둔다 — 서버의
  // reactionCount가 이미 공유 진실이고, "누가" 반응했는지는 사용자 계정
  // 개념이 필요한 나중 단계(로그인/어드민)의 몫이다.
  _getReactedSet() {
    const raw = localStorage.getItem(REACTED_KEY);
    try {
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (e) {
      return new Set();
    }
  },

  _saveReactedSet(set) {
    localStorage.setItem(REACTED_KEY, JSON.stringify([...set]));
  },

  hasShared(storyId) {
    return this._getSharedSet().has(storyId);
  },

  // "내가 전달했는지"도 반응과 같은 이유로 브라우저 로컬에만 둔다 —
  // shareCount는 이미 서버의 공유 진실이고, "누가" 전달했는지 목록은
  // MY MEMORY(GNB)의 "전달한 기억"에서만 개인 참고용으로 쓴다.
  markShared(storyId) {
    const set = this._getSharedSet();
    set.add(storyId);
    this._saveSharedSet(set);
  },

  _getSharedSet() {
    const raw = localStorage.getItem(SHARED_KEY);
    try {
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (e) {
      return new Set();
    }
  },

  _saveSharedSet(set) {
    localStorage.setItem(SHARED_KEY, JSON.stringify([...set]));
  },

  /**
   * 실계정 없이 브라우저 단위로 "내가 쓴 글"을 상관관계로 묶기 위한
   * 비식별 ID(진짜 신원 아님 — 브라우저 데이터를 지우거나 다른 브라우저를
   * 쓰면 새 ID가 생긴다). 어드민 화면과 GNB의 "내가 남긴 기억"이 공유해서
   * 쓴다(composer.js에서 이동).
   */
  getDeviceId() {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  },

  incrementShareCount(storyId) {
    const target = _cache.find((s) => s.id === storyId);
    if (!target) return null;
    target.shareCount = (target.shareCount || 0) + 1;
    if (client) {
      client.models.Story.update({ id: storyId, shareCount: target.shareCount })
        .catch((e) => console.error("공유 수 반영 실패(백그라운드)", storyId, e));
    }
    return target;
  },

  incrementViewCount(storyId) {
    const target = _cache.find((s) => s.id === storyId);
    if (!target) return null;
    target.viewCount = (target.viewCount || 0) + 1;
    if (client) {
      client.models.Story.update({ id: storyId, viewCount: target.viewCount })
        .catch((e) => console.error("조회수 반영 실패(백그라운드)", storyId, e));
    }
    return target;
  },

  /**
   * 방문 로그 기록 — write-only(게스트는 read 권한이 없어 자기가 남긴 것도
   * 못 읽는다). 실패해도 지도 사용에는 영향 없으니 fire-and-forget.
   */
  logPageView(storyId) {
    if (!client) return;
    client.models.PageView.create({ storyId: storyId || null })
      .catch((e) => console.error("방문 로그 기록 실패", e));
  },

  /**
   * 관리자 전용 — 방문 로그 전체 조회. refresh()에 안 끼워넣는 이유: 게스트는
   * PageView read 권한이 없어서, 일반 방문자 부팅 흐름에서 이걸 부르면 매번
   * 권한 에러만 콘솔에 쌓인다. admin.js가 로그인 후에만 명시적으로 부른다.
   */
  async listPageViews() {
    return fetchAll("PageView");
  },

  /**
   * 로그인한 사용자가 글을 남길 때 storyId ↔ 계정(userId/email) 연결을
   * 기록한다. PageView와 같은 write-only 텔레메트리 — 실패해도 글 작성
   * 자체엔 영향 없으니 fire-and-forget.
   */
  recordStoryAuthor(storyId, userId, email) {
    if (!client) return;
    // owner 필드가 로그인 계정의 sub로 채워지려면 이 create 호출 자체가
    // userPool 인증으로 나가야 한다 — 기본 client(identityPool)로 보내면
    // owner가 비어서 listMyStoryAuthors()의 owner 기반 읽기 규칙에 안
    // 걸린다(amplify/data/resource.ts StoryAuthor 권한 주석 참고).
    client.models.StoryAuthor.create({ storyId, userId, email }, { authMode: "userPool" })
      .catch((e) => console.error("작성자 계정 연결 기록 실패", storyId, e));
  },

  /**
   * 관리자 전용 — storyId별 작성자 계정 전체 조회. PageView와 같은 이유로
   * refresh()에는 안 끼워넣고 admin.js가 로그인 후 명시적으로 부른다.
   */
  async listStoryAuthors() {
    return fetchAll("StoryAuthor");
  },

  /**
   * 로그인한 본인 글만 — owner 기반 읽기라 recordStoryAuthor와 동일하게
   * userPool authMode로 호출해야 한다. 비로그인 상태에선 애초에 호출하지
   * 않는다(권한이 없어 에러만 남는다) — mymemory.js/filters.js가
   * Auth.getCurrentUser()로 로그인 여부를 먼저 확인하고 부른다.
   */
  async listMyStoryAuthors() {
    if (!client) return [];
    const items = [];
    let nextToken = null;
    try {
      do {
        const { data, nextToken: token, errors } = await client.models.StoryAuthor.list({
          limit: 1000,
          nextToken,
          authMode: "userPool",
        });
        if (errors) {
          console.error("내 작성 기록 조회 실패", errors);
          break;
        }
        items.push(...data);
        nextToken = token;
      } while (nextToken);
    } catch (e) {
      console.error("내 작성 기록 조회 실패", e);
    }
    return items;
  },

  /**
   * 로그인 직후(auth.js)에 한 번 호출해 "내 글" id 캐시를 채운다.
   * isMyStory()가 카드 렌더링 중 동기로 이 캐시를 참조한다 — 수정하기/
   * 삭제하기 버튼 노출도 오직 계정 연결만 보고, 브라우저 기기ID는
   * 절대 안 쓴다(2026-08-14).
   */
  async refreshMyStoryIds() {
    const records = await this.listMyStoryAuthors();
    _myStoryIds = new Set(records.map((r) => r.storyId));
  },

  /**
   * 로그아웃(auth.js)에 한 번 호출해 캐시를 비운다 — 남아있으면 다음
   * 사용자가 로그인하기 전 짧은 순간 이전 계정의 글이 "내 글"로 보일 수
   * 있다.
   */
  clearMyStoryIds() {
    _myStoryIds = null;
  },

  /**
   * 방금 글을 쓴 직후(composer.js)에 부른다 — 다음 refreshMyStoryIds
   * 왕복을 기다리지 않고 바로 그 카드에 수정하기/삭제하기가 뜨게
   * 낙관적으로 캐시에 추가해둔다.
   */
  addMyStoryId(storyId) {
    if (_myStoryIds) _myStoryIds.add(storyId);
  },

  isMyStory(storyId) {
    return !!_myStoryIds && _myStoryIds.has(storyId);
  },

  /**
   * 관리자 전용 — 신고 없이도 바로 숨김 처리(신고 임계치 로직인
   * reportStory와는 별개). 부적절한 글을 신고 들어오기 전에 선제 조치할 때.
   */
  async hideStory(storyId) {
    const target = _cache.find((s) => s.id === storyId);
    if (!target) return null;
    target.status = "HIDDEN";
    await client.models.Story.update({ id: storyId, status: "HIDDEN" });
    return target;
  },

  /**
   * 관리자 전용 — 완전 삭제. 게스트가 호출해도 서버(@auth)가 거부하므로
   * 프론트에서 숨길 필요 없다.
   */
  async deleteStory(storyId) {
    await client.models.Story.delete({ id: storyId });
    _cache = _cache.filter((s) => s.id !== storyId);
  },

  /**
   * 작성자 본인이 자기 글을 지울 때 쓴다(js/storySheet.js "삭제하기").
   * 서버 delete 권한은 관리자에게만 있어(deleteStory 참고) 게스트/로그인
   * 사용자는 진짜 delete를 호출할 수 없다 — 그래서 이미 열려 있는 update
   * 권한으로 status를 DELETED로 바꿔 모든 화면에서 안 보이게 한다(레코드
   * 자체는 서버에 남는 소프트 삭제). status는 자유 문자열이라 스키마
   * 변경/백엔드 재배포 없이 바로 동작한다. 신고 누적/관리자 숨김이 쓰는
   * HIDDEN과 값을 분리해서 관리자 신고 검토 큐(admin.js)에 안 섞인다.
   * "자기 글만" 제약은 update/report 등 기존 패턴과 동일하게 UI 노출
   * 여부로만 건다(서버가 소유자 단위로 막지는 않는다).
   */
  async softDeleteStory(storyId) {
    const target = _cache.find((s) => s.id === storyId);
    if (!target) return null;
    target.status = "DELETED";
    await client.models.Story.update({ id: storyId, status: "DELETED" });
    return target;
  },

  /**
   * 관리자 전용 — 신고 검토에서 "복구" 눌렀을 때 원상복구.
   */
  async restoreStory(storyId) {
    const target = _cache.find((s) => s.id === storyId);
    if (!target) return null;
    target.status = "ACTIVE";
    target.reportCount = 0;
    await client.models.Story.update({ id: storyId, status: "ACTIVE", reportCount: 0 });
    return target;
  },

  // ------------------------------------------------------------
  // 금칙어 — 게스트는 읽기만(작성 화면 체크용), 추가/삭제는 관리자만
  // (서버 @auth가 실제 경계, 여기 함수는 누구나 호출은 가능).
  // ------------------------------------------------------------
  getBannedWords() {
    return _bannedWords;
  },

  containsBannedWord(text) {
    return _bannedWords.some((b) => b.word && text.includes(b.word));
  },

  async addBannedWord(word) {
    const created = await client.models.BannedWord.create({ word });
    _bannedWords.push(created.data);
    return created.data;
  },

  async removeBannedWord(id) {
    await client.models.BannedWord.delete({ id });
    _bannedWords = _bannedWords.filter((b) => b.id !== id);
  },

  /**
   * 좌표 근처(같은 장소)의 이야기를 그룹핑합니다.
   * - placeId가 있으면(검색형) 그룹 제목은 카카오 공식 장소명
   * - 없으면(자유 핀) 그룹 제목은 항상 "주소" (첫 이야기의 address)
   *   → 특정 유저가 붙인 임의의 이름이 장소의 "공식 명칭"처럼
   *     굳어버리는 것을 방지하기 위한 설계
   */
  /**
   * getGroupedByPlace/getStoriesAtSamePlace가 공유하는 장소 그룹 키.
   */
  _groupKeyFor(story) {
    return story.placeId
      ? `place:${story.placeId}`
      : `pin:${story.lat.toFixed(4)},${story.lng.toFixed(4)}`;
  },

  getGroupedByPlace() {
    return this.groupStoriesByPlace(this.getVisibleStories());
  },

  /**
   * getGroupedByPlace()의 그룹핑 로직 본체 — 스토리 배열을 인자로 받도록
   * 일반화해서, 전체 지도가 아니라 "내가 남긴 기억"처럼 이미 걸러낸
   * 부분집합도 같은 방식으로 장소 단위로 묶을 수 있게 한다(js/recall.js
   * 별자리 기능에서 재사용, 2026-08-19).
   */
  groupStoriesByPlace(stories) {
    const groups = {};

    stories.forEach((story) => {
      const key = this._groupKeyFor(story);

      if (!groups[key]) {
        groups[key] = {
          key,
          lat: story.lat,
          lng: story.lng,
          placeId: story.placeId,
          officialPlaceName: story.officialPlaceName || null,
          address: story.address || null,
          stories: [],
        };
      }
      // 그룹 대표 주소가 비어있으면 이후 이야기의 주소로 보강
      if (!groups[key].address && story.address) {
        groups[key].address = story.address;
      }
      groups[key].stories.push(story);
    });

    return Object.values(groups);
  },

  /**
   * 장소 그룹 키(_groupKeyFor 형식)로 그룹을 찾는다 — 장소 단위 공유
   * 링크(?place=)가 도착 지점을 찾을 때 쓴다.
   */
  getGroupByKey(key) {
    return this.getGroupedByPlace().find((g) => g.key === key) || null;
  },

  /**
   * 같은 장소(스팟)에 남겨진 다른 기억들 — 자기 자신은 제외. 기억 카드의
   * "우연히 겹치는 기억" 캡션(정확히 같은 장소·같은 해, js/storySheet.js)
   * 에 쓴다 — 알림 뱃지의 "겹치는 기억"은 반경 1km 판단(getStoriesNear)
   * 만 쓰도록 2026-08-20에 분리됐다.
   */
  getStoriesAtSamePlace(story) {
    const key = this._groupKeyFor(story);
    return this.getVisibleStories().filter((s) => s.id !== story.id && this._groupKeyFor(s) === key);
  },

  /**
   * 두 좌표 사이의 직선 거리(미터) — 하버사인 공식. "근처" 판단(장소가
   * 달라도 걸어서 닿을 거리)에 쓴다(getStoriesNear 참고).
   */
  _distanceMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  },

  /**
   * 임의 좌표 기준 반경(미터) 안의 기억들 — 검색 결과를 눌렀을 때
   * "이 동네에는 몇 개의 기억이, 몇 년부터 몇 년까지 있는지" 배너와
   * 지도 마커 밝히기에 쓴다(js/search.js, js/map.js).
   */
  getStoriesNear(lat, lng, radiusMeters) {
    return this.getVisibleStories().filter((s) => this._distanceMeters(lat, lng, s.lat, s.lng) <= radiusMeters);
  },

  /** 두 좌표가 반경(미터) 안인지 — map.js가 검색한 동네 근처 마커를 밝힐 때 쓴다. */
  isNear(lat1, lng1, lat2, lng2, radiusMeters) {
    return this._distanceMeters(lat1, lng1, lat2, lng2) <= radiusMeters;
  },

  /**
   * 스팟의 대표 제목을 결정한다. 이 서비스는 지도 서비스가 아니라
   * 기억 서비스이므로, 사람이 실제로 기억하는 이름(검색형 장소의
   * 공식 이름, 또는 누군가 붙인 개인적 이름)을 도로명주소보다
   * 우선한다. 주소는 항상 별도로(작게) 같이 보여줄 수 있도록
   * getGroupAddressCaption과 짝을 이룬다.
   */
  getGroupTitle(group) {
    if (group.placeId && group.officialPlaceName) return group.officialPlaceName;
    if (group.customName) return group.customName;
    if (group.stories && group.stories.length) {
      const withCustomName = group.stories.find((s) => s.customName);
      if (withCustomName) return withCustomName.customName;
    }
    return (group.address && this.abbreviateAddress(group.address)) || "주소를 확인할 수 없는 곳";
  },

  /**
   * 주소 맨 앞의 시/도 풀네임만 SIDO_ABBR 기준으로 축약한다(나머지
   * 구/동/도로명은 그대로). 작성폼(composer.js)의 주소 표시/장소명 자동
   * 채움과 상단 검색창 자동완성(search.js)도 이 함수를 거치도록
   * 맞춰뒀다(2026-08-20) — 예전엔 그 두 곳만 이 함수를 거치지 않아
   * "전남광주통합특별시"처럼 축약 전 풀네임이 그대로 보이는 경우가 있었다.
   */
  abbreviateAddress(address) {
    if (!address) return address;
    for (const [full, short] of SIDO_ABBR) {
      if (address.startsWith(full)) {
        return short + address.slice(full.length);
      }
    }
    return address;
  },

  /**
   * 시/군/구/동(읍·면·리·가) 레벨까지만 남기고 번지수는 뗀다 — 기억
   * 라디오(js/recall.js openRecallCard)에서 장소 이름을 안 붙인 자유
   * 핀이면 지번 주소 전체("서울 중구 충무로4가 23-1")가 그대로 노출돼
   * 너무 구체적으로 보인다는 피드백으로 추가(2026-08-21). 맨 끝에서부터
   * "산" 또는 숫자(-숫자 포함)로만 된 토큰을 지번으로 보고 잘라낸다 —
   * "산 123-4"처럼 산지번이 두 토큰으로 쪼개진 경우도 순서대로 둘 다
   * 떨어진다. 이 축약은 기억 라디오 전용이라 카드/공유 등 다른 화면의
   * getGroupAddressCaption/getGroupTitle은 그대로 abbreviateAddress를 쓴다.
   */
  getDongLevelAddress(address) {
    if (!address) return address;
    const tokens = this.abbreviateAddress(address).split(/\s+/);
    while (tokens.length > 1 && /^(산|\d+(-\d+)?)$/.test(tokens[tokens.length - 1])) {
      tokens.pop();
    }
    return tokens.join(" ");
  },

  /**
   * "서울·부산·경주" 같은 도시 단위 요약 문구(js/recall.js 별자리 기능)에
   * 쓰는 도시명 추출 — abbreviateAddress()는 시/도 레벨까지만 축약해서
   * "경상북도 경주시..."가 "경북 경주시..."로만 줄고 "경주"까지는 안
   * 나온다. 광역시/특별시/세종처럼 이미 시/도 자체가 도시 단위인 곳은
   * SIDO_ABBR 축약형을 그대로 쓰고, 도(경기·강원·충청·전라·경상·제주)는
   * 그다음 토큰(시/군)에서 "시"/"군" 접미사를 떼어 도시명으로 쓴다.
   */
  getCityLabel(address) {
    if (!address) return null;
    const tokens = address.trim().split(/\s+/);
    if (tokens.length === 0) return null;

    for (const [full, short] of SIDO_ABBR) {
      if (tokens[0] !== full) continue;
      if (SIDO_IS_CITY_LEVEL.has(full)) return short;
      const next = tokens[1];
      if (!next) return short;
      return next.replace(/(시|군)$/, "") || next;
    }
    return null;
  },

  /**
   * 제목이 이미 주소 자체가 아닐 때만(즉 공식명/개인 이름을 제목으로
   * 쓰고 있을 때만) 주소를 작은 캡션으로 별도 노출한다. 제목이 곧
   * 주소인 경우(둘 다 정보가 없는 자유 핀) 중복 표시를 피한다.
   */
  getGroupAddressCaption(group) {
    if (!group.address) return null;
    const abbreviated = this.abbreviateAddress(group.address);
    // getGroupTitle()도 이름이 없으면 이 축약 주소로 폴백하므로,
    // 축약된 값끼리 비교해야 "제목이 곧 주소인" 케이스를 정확히 잡는다
    // (원본 vs 축약본을 비교하면 항상 다르게 나와 중복 표시가 새버린다).
    if (abbreviated === this.getGroupTitle(group)) return null;
    return abbreviated;
  },

  _getHashtagCounts() {
    const counts = {};
    this.getVisibleStories().forEach((s) => {
      (s.hashtags || []).forEach((tag) => {
        counts[tag] = (counts[tag] || 0) + 1;
      });
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  },

  getTopHashtags(limit = 30) {
    return this._getHashtagCounts()
      .slice(0, limit)
      .map(([tag]) => tag);
  },

  // 상단 바의 "더보기" 시트용 — 개수 제한 없이 전체 태그를 많이 쓰인 순으로.
  getAllHashtagsWithCounts() {
    return this._getHashtagCounts().map(([tag, count]) => ({ tag, count }));
  },

  getHashtagCount(tag) {
    return this.getVisibleStories().filter((s) => (s.hashtags || []).includes(tag)).length;
  },

  /**
   * referenceDate("YYYY-MM")에서 연도를 추출. dateMode에 따라 분기.
   */
  getStoryYear(story) {
    if (story.dateMode === "past" && story.referenceDate) {
      return parseInt(story.referenceDate.split("-")[0], 10);
    }
    if (story.dateMode === "now") {
      return new Date(story.createdAt).getFullYear();
    }
    return null;
  },

  /**
   * 유튜브 링크(watch?v=, youtu.be, shorts, embed 등 흔한 형태)에서
   * 11자리 video ID만 뽑아낸다. 못 알아보는 형태면 null — 작성 폼에서
   * 미리보기/검증에, 카드 렌더링에서 embed URL 조립에 쓴다.
   */
  extractYoutubeVideoId(url) {
    if (!url) return null;
    const match = String(url).match(
      /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
    );
    return match ? match[1] : null;
  },

  /**
   * 유튜브 영상 제목("아티스트 - 곡명 (Official MV)" 같은 형태)에서 아티스트/곡명을
   * 추정해 분리한다. 영상 제목 형식이 제각각이라 100% 정확할 수 없어 작성 폼에서
   * 사용자가 확인/수정하는 걸 전제로 한다 — 여기선 "그럴듯한 초안"만 만든다.
   */
  /**
   * rawTitle(영상 제목)만으론 구분자 없는 업로드가 많아(뮤직비디오 채널이
   * 제목엔 곡명만 적고, 채널 자체가 아티스트인 경우 등) channelName(oEmbed의
   * author_name, 즉 업로더 채널명)을 두 번째 신호로 함께 쓴다. 특히 유튜브가
   * 자동 생성하는 "아티스트 - Topic" 채널명은 사실상 정답에 가까워 노이즈만
   * 벗겨내면 그대로 아티스트로 쓸 수 있다(2026-08-19, 기존 제목-only 분리가
   * 자주 틀린다는 피드백으로 추가).
   */
  parseYoutubeMusicTitle(rawTitle, channelName) {
    if (!rawTitle) return { artist: null, title: null };

    // 괄호 안에 노이즈 키워드가 있는 경우(예: "(Official MV)")와, 괄호 없이
    // 제목 끝에 그냥 붙는 경우(예: "... Official MV") 둘 다 흔해서 따로 처리한다.
    const BRACKET_NOISE =
      /[([][^)\]]*\b(official|m\/?v|music\s*video|lyrics?|audio|live|teaser|visualizer|hd|4k)\b[^)\]]*[)\]]/gi;
    const TRAILING_NOISE =
      /\s*[-–—|]?\s*\b(official\s*(music\s*)?video|official\s*audio|official\s*m\/?v|m\/v|mv|lyrics?|teaser|visualizer)\b\s*$/i;
    const trim = (s) =>
      s
        .replace(/^[\s"'“”'‘]+|[\s"'“”'‘]+$/g, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, "");

    // 채널명 특유의 꼬리표(자동 생성 Topic 채널, VEVO, "공식 채널" 등)를 벗겨
    // 순수 아티스트명에 가깝게 정리한다.
    const cleanChannelName = (name) => {
      if (!name) return null;
      const cleaned = name
        .replace(/\s*-\s*Topic$/i, "")
        .replace(/VEVO$/i, "")
        .replace(/\s*(공식\s*)?(채널|Official|Music|Ent(ertainment)?)$/i, "")
        .trim();
      return cleaned || null;
    };

    const withoutNoise = trim(rawTitle.replace(BRACKET_NOISE, "").replace(TRAILING_NOISE, ""));
    const channelArtist = cleanChannelName(channelName);

    // 「곡명」/『곡명』처럼 따옴표로 곡명을 감싸는 업로드 관행이 흔해서, 대시
    // 구분자보다 먼저 확인한다 — 이 패턴이 잡히면 나머지 앞부분이 곧 아티스트.
    const quoteMatch = withoutNoise.match(/[「『]([^」』]+)[」』]/);
    if (quoteMatch) {
      const title = trim(quoteMatch[1]);
      const artist = trim(withoutNoise.slice(0, quoteMatch.index)) || channelArtist;
      if (title) return { artist: artist || null, title };
    }

    // 대시류 외에 ":", "|"로 구분하는 업로드도 있어 구분자에 포함한다.
    const parts = withoutNoise.split(/\s+[-–—~:|]\s+/);
    if (parts.length >= 2) {
      let artist = trim(parts[0]);
      let title = trim(parts.slice(1).join(" - "));
      // "곡명 - 아티스트"로 순서가 뒤집힌 제목도 있다 — 채널명이 뒷부분과
      // 일치하면 순서를 바로잡는다.
      if (channelArtist && norm(channelArtist) === norm(title) && norm(channelArtist) !== norm(artist)) {
        [artist, title] = [title, artist];
      }
      if (artist && title) return { artist, title };
    }

    // 구분자가 아예 없으면(제목엔 곡명만 있는 업로드) 채널명을 아티스트로 쓴다.
    return { artist: channelArtist, title: withoutNoise || null };
  },

  /**
   * 아티스트+곡명을 대소문자/공백 무시하고 비교하는 정규화 키 — "같은 노래"인지
   * 판단하는 유일한 기준이다. 15명이 각자 다른 유튜브 URL을 붙여도 이 키가
   * 같으면 하나의 곡으로 묶인다. 아티스트를 못 찾은 기억(파싱 실패)은 곡명만으로
   * 묶는다.
   */
  normalizeSongKey(artist, title) {
    const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, "");
    return `${norm(artist)}::${norm(title)}`;
  },

  /**
   * 같은 노래(아티스트+곡명)를 가진 공개 스토리 전체 — 카드의 "이 노래와 함께
   * 남겨진 기억" 배너, 곡 목록 시트, 지도 필터(filters.js exploreSong)가
   * 공유해서 쓴다.
   */
  getStoriesForSong(artist, title) {
    if (!title) return [];
    const key = this.normalizeSongKey(artist, title);
    return this.getVisibleStories().filter(
      (s) => s.musicTitle && this.normalizeSongKey(s.musicArtist, s.musicTitle) === key
    );
  },

  getSongMemoryCount(artist, title) {
    return this.getStoriesForSong(artist, title).length;
  },

  _getSongCounts() {
    const map = new Map();
    this.getVisibleStories().forEach((s) => {
      if (!s.musicTitle) return;
      const key = this.normalizeSongKey(s.musicArtist, s.musicTitle);
      const existing = map.get(key);
      if (existing) existing.count += 1;
      else map.set(key, { artist: s.musicArtist || null, title: s.musicTitle, count: 1 });
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
  },

  getTopSongs(limit = 30) {
    return this._getSongCounts().slice(0, limit);
  },

  // 상단 바의 "더보기" 시트용 — 개수 제한 없이 전체 곡을 많이 남겨진 순으로.
  getAllSongsWithCounts() {
    return this._getSongCounts();
  },

  /**
   * 작성 폼에서 아티스트/곡명을 채운 뒤, 이미 저장된 곡 중 곡명이 겹치는 게
   * 있으면 "혹시 이 곡?" 제안을 만든다. normalizeSongKey는 아티스트+곡명이
   * 둘 다 일치해야 하나로 묶는데, 아티스트 표기가 언어/철자로 갈리는 경우
   * (예: "성시경" vs "Sung si kyoun")는 그 기준으로 못 묶는다 — 대신 곡명
   * 쪽은 그대로 겹치는 경우가 많아 곡명 포함 관계만으로 느슨하게 찾는다.
   * 자동 병합이 아니라 사용자가 확인하고 눌러야 반영되는 제안이라 느슨해도
   * 된다. 짧은 제목(2자 미만)은 엉뚱한 매칭이 잦아 제외한다.
   */
  suggestSongMatch(artist, title) {
    const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, "");
    const inputTitle = norm(title);
    if (inputTitle.length < 2) return null;
    const currentKey = this.normalizeSongKey(artist, title);

    const match = this._getSongCounts().find((song) => {
      if (this.normalizeSongKey(song.artist, song.title) === currentKey) return false;
      const candTitle = norm(song.title);
      if (candTitle.length < 2) return false;
      return candTitle.includes(inputTitle) || inputTitle.includes(candTitle);
    });

    return match ? { artist: match.artist, title: match.title } : null;
  },

  /**
   * API 키 없이 쓸 수 있는 유튜브 oEmbed 원본 응답(제목 + 채널명)을 가져온다.
   * fetchYoutubeTitle/fetchYoutubeOEmbed가 공유해서 쓴다.
   */
  async _fetchYoutubeOEmbedRaw(videoId) {
    try {
      const watchUrl = encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`);
      const res = await fetch(`https://www.youtube.com/oembed?url=${watchUrl}&format=json`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  },

  /**
   * 영상 제목만 가져온다. 미니 플레이어(저장된 곡 정보가 없는 옛 기억의
   * 폴백 표시)가 쓴다.
   */
  async fetchYoutubeTitle(videoId) {
    const data = await this._fetchYoutubeOEmbedRaw(videoId);
    return (data && data.title) || null;
  },

  /**
   * 영상 제목 + 채널명(author_name)을 함께 가져온다. 작성 폼이 parseYoutubeMusicTitle에
   * 채널명을 두 번째 신호로 넘겨 아티스트/곡명 분리 정확도를 높이는 데 쓴다.
   */
  async fetchYoutubeOEmbed(videoId) {
    const data = await this._fetchYoutubeOEmbedRaw(videoId);
    if (!data) return null;
    return { title: data.title || null, channelName: data.author_name || null };
  },

  getStoryMonth(story) {
    if (story.dateMode === "past" && story.referenceDate) {
      const raw = story.referenceDate.split("-")[1];
      if (!raw || SEASON_LABELS[raw]) return null;
      return parseInt(raw, 10);
    }
    if (story.dateMode === "now") {
      return new Date(story.createdAt).getMonth() + 1;
    }
    return null;
  },

  /** referenceDate 월 자리가 계절 코드(SP/SU/FA/WI)면 그 코드를, 아니면 null. */
  getStorySeasonCode(story) {
    if (story.dateMode !== "past" || !story.referenceDate) return null;
    const raw = story.referenceDate.split("-")[1];
    return SEASON_LABELS[raw] ? raw : null;
  },

  getStorySeasonLabel(story) {
    const code = this.getStorySeasonCode(story);
    return code ? SEASON_LABELS[code] : null;
  },

  /**
   * 카드 등에서 월/계절 자리에 그대로 넣을 텍스트 — 정확한 월이 있으면
   * "3월", 계절만 있으면 "봄"(월 접미사 없음), 둘 다 없으면 null.
   */
  getStoryDateLabel(story) {
    const month = this.getStoryMonth(story);
    if (month !== null) return `${month}월`;
    return this.getStorySeasonLabel(story);
  },

  /**
   * sortStoriesForDisplay 전용 — 정확한 월이 있으면 그 숫자, 계절만
   * 있으면 SEASON_SORT_OFFSET으로 그 계절의 마지막 달 바로 뒤에 끼워
   * 넣는다(위 SEASON_SORT_OFFSET 주석 참고). 월도 계절도 없이 연도만
   * 있는 기억(2026-08-21, 월/계절 입력을 선택사항으로 바꾸며 생긴
   * 케이스)은 그 해의 맨 마지막(12.6)으로 보낸다 — 맨 앞으로 보내면
   * 1월보다도 앞서는 것처럼 보여 어색하다.
   */
  getStoryMonthSortValue(story) {
    const month = this.getStoryMonth(story);
    if (month !== null) return month;
    const code = this.getStorySeasonCode(story);
    if (code) return SEASON_SORT_OFFSET[code];
    return 12.6;
  },

  getStoriesByYear(year) {
    return this.getVisibleStories().filter((s) => this.getStoryYear(s) === year);
  },

  /**
   * 전체 이야기 중 연도가 있는 것들의 최소/최대 연도 (시간 슬라이더 범위용)
   */
  getYearRange() {
    const years = this.getVisibleStories()
      .map((s) => this.getStoryYear(s))
      .filter((y) => y !== null);
    if (years.length === 0) {
      const thisYear = new Date().getFullYear();
      return { min: thisYear - 10, max: thisYear };
    }
    return { min: Math.min(...years), max: new Date().getFullYear() };
  },

  /**
   * createdAt이 오늘(로컬 기준 00:00~23:59) 안에 있는지. "오늘의 기억"
   * 목록과 지도 마커의 "오늘 남긴 기억이 있으면 더 선명하게"(디자인
   * 가이드 VARIATIONS) 둘 다 이 기준을 쓴다.
   */
  isToday(dateString) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
    const t = new Date(dateString).getTime();
    return t >= start && t <= end;
  },

  /**
   * "오늘의 기억" 칩용 — 오늘 등록된 기억 전부. 예전에는 날짜 시드로
   * 고른 "매일 하나씩" 랜덤 추천이었는데, 실제로 오늘 올라온 글만 보고
   * 싶다는 요청(2026-08-13)으로 바뀌었다.
   */
  getTodayStories() {
    return this.getVisibleStories().filter((s) => this.isToday(s.createdAt));
  },

  /**
   * 오늘의 질문 — 날짜 문자열을 시드로 DAILY_PROMPTS 중 하나를 결정론적으로
   * 고른다(같은 날 여러 번 불러도 항상 같은 질문). 자정을 하루 경계로 쓴다
   * (2026-08-18, 기존 오전 6시 경계에서 변경).
   */
  getDailyPrompt() {
    const effective = new Date();
    const seed = `${effective.getFullYear()}-${String(effective.getMonth() + 1).padStart(2, "0")}-${String(effective.getDate()).padStart(2, "0")}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash * 31 + seed.charCodeAt(i)) % DAILY_PROMPTS.length;
    }
    return DAILY_PROMPTS[Math.abs(hash) % DAILY_PROMPTS.length];
  },

  /**
   * "오늘의 미션" 4종(질문/시간/장소/이번 주)이 공유하는 날짜 경계 —
   * getDailyPrompt와 동일하게 자정을 하루 경계로 쓴다(2026-08-18, 기존
   * 오전 6시 경계에서 변경).
   */
  _missionEffectiveDate() {
    return new Date();
  },

  /** getDailyPrompt와 같은 해시 방식 — suffix로 미션 종류별 시드를 분리한다. */
  _missionSeedIndex(suffix, mod) {
    if (mod <= 0) return 0;
    const d = this._missionEffectiveDate();
    const seed = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${suffix}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash * 31 + seed.charCodeAt(i)) % mod;
    }
    return Math.abs(hash) % mod;
  },

  /**
   * 요일별로 오늘의 미션 종류를 정한다 — 월·목 질문, 화·금 시간, 수·토
   * 장소, 일 이번 주(2026-08-17 논의). 매일 같은 형식(설문조사처럼)이면
   * 지겨워진다는 이유로 4종을 번갈아 보여주기로 함.
   */
  getTodayMissionType() {
    return this._missionTypeForDay(this._missionEffectiveDate().getDay());
  },

  /** getTodayMissionType의 순수 매핑 부분만 떼어낸 것 — 테스트가 실제
   * 오늘 요일에 의존하지 않고 이 매핑 자체를 검증할 수 있게 한다. */
  _missionTypeForDay(day) { // 0=일 ... 6=토
    if (day === 1 || day === 4) return "question";
    if (day === 2 || day === 5) return "year";
    if (day === 3 || day === 6) return "place";
    return "week";
  },

  /** 실제 기억이 존재하는 연도 중에서만 고른다 — 데이터 없는 해를 보여주면 막다른 길이 된다. */
  getTodayMissionYear() {
    const years = [...new Set(
      this.getVisibleStories().map((s) => this.getStoryYear(s)).filter((y) => y !== null)
    )].sort((a, b) => a - b);
    if (years.length === 0) return null;
    return years[this._missionSeedIndex("year", years.length)];
  },

  /**
   * 기억이 3개 이상 모인 "인기 스팟" 중에서 우선 고르고(예시처럼 "37개의
   * 기억"이 의미 있으려면), 그런 곳이 아직 없으면 아무 스팟이나. 기기별로
   * 캐시 순서가 다를 수 있어 key로 정렬해 모든 사용자가 같은 날 같은
   * 장소를 보게 한다.
   */
  getTodayMissionPlace() {
    const groups = this.getGroupedByPlace();
    if (groups.length === 0) return null;
    const POPULAR_MIN = 3;
    const popular = groups.filter((g) => g.stories.length >= POPULAR_MIN);
    const pool = (popular.length > 0 ? popular : groups).slice().sort((a, b) => a.key.localeCompare(b.key));
    return pool[this._missionSeedIndex("place", pool.length)];
  },

  /**
   * 이번 주(월요일 0시~) 등록된 기억 중 연도가 가장 오래된 것 — "이번 주의
   * 기억"(일요일 미션)에 쓴다. 이번 주에 등록된 게 없으면 null.
   */
  getWeekOldestStory() {
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = day === 0 ? 6 : day - 1;
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
    weekStart.setHours(0, 0, 0, 0);

    const candidates = this.getVisibleStories().filter(
      (s) => new Date(s.createdAt) >= weekStart && this.getStoryYear(s) !== null
    );
    if (candidates.length === 0) return null;
    return candidates.reduce((oldest, s) => (this.getStoryYear(s) < this.getStoryYear(oldest) ? s : oldest));
  },

  /**
   * 목록 정렬 공통 로직 — "지금까지 쌓인 기억"/"오늘의 기억" 모달과 기억
   * 카드(스팟/해시태그) 목록이 전부 같은 3가지 정렬을 쓴다:
   * - "latest"(최신 등록순): createdAt 내림차순, 시점 유무 구분 없음
   * - "timetravel"(시간여행순): 시점 있는 것만 연도·월 오름차순(과거→현재),
   *   시점 모르는 건 등록순으로 뒤에 따로 묶음
   * - "timetravel-reverse"(역시간여행순): 위와 같지만 연도·월 내림차순
   *   (지금→과거)
   * dated/undated로 나눠 반환 — "시점을 알 수 없는 기억들" 구간 렌더는
   * 호출부마다 마크업이 달라 여기서 합치지 않는다.
   */
  sortStoriesForDisplay(stories, mode) {
    if (mode !== "timetravel" && mode !== "timetravel-reverse") {
      return {
        dated: [...stories].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
        undated: [],
      };
    }
    const dated = stories.filter((s) => this.getStoryYear(s) !== null);
    const undated = stories.filter((s) => this.getStoryYear(s) === null);
    const dir = mode === "timetravel-reverse" ? -1 : 1;

    dated.sort((a, b) => {
      const ay = this.getStoryYear(a), by = this.getStoryYear(b);
      if (ay !== by) return dir * (ay - by);
      const am = this.getStoryMonthSortValue(a), bm = this.getStoryMonthSortValue(b);
      if (am !== bm) return dir * (am - bm);
      // 연도·월까지 같으면(예: 이번 달 안에서) 등록 시각으로 한 번 더
      // 갈라준다 — 안 그러면 같은 달로 묶인 기억들 사이의 순서가
      // 정렬 전 배열 순서에 그대로 고정돼, 새로 올린 기억이 같은 달의
      // 오래된 기억보다 항상 뒤로 밀려 보이지 않는 문제가 있었다
      // (2026-08-17 확인 — "역시간여행순"이 며칠째 똑같아 보인다는 제보).
      return dir * (new Date(a.createdAt) - new Date(b.createdAt));
    });
    undated.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return { dated, undated };
  },

  getRandomRecentStory() {
    const visible = this.getVisibleStories();
    if (visible.length === 0) return null;

    const sorted = [...visible].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );
    const pool = sorted.slice(0, CONFIG.RECENT_STORY_POOL_SIZE);
    return pool[Math.floor(Math.random() * pool.length)];
  },

  getRandomStory() {
    const visible = this.getVisibleStories();
    if (visible.length === 0) return null;
    return visible[Math.floor(Math.random() * visible.length)];
  },

  generatePublicId() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let id = "";
    for (let i = 0; i < 8; i++) {
      id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
  },
};

// 브라우저에서는 <script src="js/storage.js">로 로드되어 전역 Storage를
// 그대로 쓰고, Node(node:test)에서는 이 guard로 require해서 테스트한다.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { Storage, DAILY_PROMPTS };
}
