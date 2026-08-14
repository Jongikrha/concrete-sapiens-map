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
// 전북특별자치도)는 신/구 표기를 둘 다 매핑해둔다(2026-08-14).
const SIDO_ABBR = [
  ["서울특별시", "서울"],
  ["부산광역시", "부산"],
  ["대구광역시", "대구"],
  ["인천광역시", "인천"],
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

// 오늘의 질문 프롬프트 목록 (매일 오전 6시에 하나씩 결정론적으로 노출) —
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

let client = null;
let _cache = [];
let _bannedWords = [];

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

  saveStory(story) {
    _cache.push(story);
    if (client) client.models.Story.create(story).catch((e) => console.error("스토리 저장 실패(백그라운드)", story.id, e));
    else console.error("백엔드 미연결 상태라 저장이 서버에 반영되지 않았습니다", story.id);
    return story;
  },

  /**
   * 작성자 본인이 자기 글을 고칠 때 쓴다(js/composer.js 수정 모드).
   * saveStory와 같은 낙관적 업데이트 패턴 — 캐시를 먼저 바꾸고 서버 반영은
   * 백그라운드로 보낸다. id/publicId/createdAt/작성 통계(reportCount 등)는
   * fields에 안 담아 보내면 그대로 유지된다.
   */
  updateStory(storyId, fields) {
    const target = _cache.find((s) => s.id === storyId);
    if (!target) return null;
    Object.assign(target, fields);
    if (client) {
      client.models.Story.update({ id: storyId, ...fields })
        .catch((e) => console.error("스토리 수정 실패(백그라운드)", storyId, e));
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
    client.models.StoryAuthor.create({ storyId, userId, email })
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
  getGroupedByPlace() {
    const stories = this.getVisibleStories();
    const groups = {};

    stories.forEach((story) => {
      const key = story.placeId
        ? `place:${story.placeId}`
        : `pin:${story.lat.toFixed(4)},${story.lng.toFixed(4)}`;

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
   * 구/동/도로명은 그대로). 작성폼(composer.js)의 "주소 확인 중" 표시는
   * 이 함수를 거치지 않는 별도 지점이라 원본 그대로 유지된다.
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

  getStoryMonth(story) {
    if (story.dateMode === "past" && story.referenceDate) {
      const parts = story.referenceDate.split("-");
      return parts[1] ? parseInt(parts[1], 10) : null;
    }
    if (story.dateMode === "now") {
      return new Date(story.createdAt).getMonth() + 1;
    }
    return null;
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
   * 고른다(같은 날 여러 번 불러도 항상 같은 질문). 요청대로(2026-08-14)
   * 자정이 아니라 오전 6시를 하루 경계로 쓴다 — 6시 이전이면 "어제"로
   * 쳐서 전날 질문을 그대로 이어간다.
   */
  getDailyPrompt() {
    const now = new Date();
    const effective = new Date(now);
    if (now.getHours() < 6) effective.setDate(effective.getDate() - 1);
    const seed = `${effective.getFullYear()}-${String(effective.getMonth() + 1).padStart(2, "0")}-${String(effective.getDate()).padStart(2, "0")}`;
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash * 31 + seed.charCodeAt(i)) % DAILY_PROMPTS.length;
    }
    return DAILY_PROMPTS[Math.abs(hash) % DAILY_PROMPTS.length];
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
      const am = this.getStoryMonth(a) || 0, bm = this.getStoryMonth(b) || 0;
      return dir * (am - bm);
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
