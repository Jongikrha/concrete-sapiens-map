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

// 예전(2026-10-08 이전) 브라우저 단위 반응 기록 — 정리(삭제) 용도로만 남김.
const LEGACY_REACTED_KEY = "concrete_sapiens_reacted_v1";
const LEGACY_SHARED_KEY = "concrete_sapiens_shared_v1";
const DEVICE_ID_KEY = "concrete_sapiens_device_id";
// 이 브라우저 기기 ID를 방문 통계 제외 목록에 이미 넣었는지(값 = 넣은 기기 ID).
const ADMIN_DEVICE_EXCLUDED_KEY = "concrete_sapiens_admin_device_excluded";
const LAST_VISIT_KEY = "concrete_sapiens_last_visit_v1";
const READ_STORIES_KEY = "concrete_sapiens_read_stories_v1";
// 전체 스토리 목록 로컬 캐시(2026-09-02) — 부팅 시마다 서버에서 전체 목록을
// 새로 받아오는 동안(920건 기준 약 1MB, 1초 가까이) 지도가 마커 없이
// 비어 보이는 문제 대응. 지난 방문 때 받아온 목록을 즉시 그려서 "빈 지도"
// 체감을 없애고, 최신 목록은 백그라운드로 이어서 받아와 조용히 교체한다.
// 스토리 수가 아주 많아지면(수만 건) 이 캐시 자체도 커지겠지만, localStorage
// 한도(보통 5~10MB)에는 아직 여유가 커서 지금은 그대로 둔다.
const STORY_CACHE_KEY = "concrete_sapiens_story_cache_v1";
// 발자취 장소마다 마지막으로 본 사진 번호(2026-10-16) — 다음에 그 장소
// 카드를 열면 그 다음 사진부터 보여준다(인스타그램처럼). 보기 편의일 뿐이라
// 계정이 아니라 이 브라우저에만 둔다. { [placeId]: index }
const COURSE_PHOTO_SEEN_KEY = "concrete_sapiens_course_photo_seen_v1";
// 발자취 따라 걷기 진행(2026-10-16) — 장소가 많은 코스를 다시 열면 지난번
// 보던 장소부터 이어 걷게. 사진 번호처럼 보기 편의라 이 브라우저에만 둔다.
// { [courseId]: { lastPlaceId, seen: [placeId...], finished } } — 번호가 아니라
// 장소 id로 기억해서 어드민이 순서를 바꿔도 같은 장소로 돌아간다.
const NEW_PLACE_DAYS = 7; // 발자취 장소에 NEW를 붙여두는 기간
const COURSE_PROGRESS_KEY = "concrete_sapiens_course_progress_v1";
// 발자취 장소 하나에 올릴 수 있는 사진 수(js/admin.js, js/course.js)
const COURSE_PLACE_PHOTO_MAX = 3;

// "새 글" 지도 표시(2026-08-27)의 기준 시각 — markVisitAndGetUnseenThreshold()가
// 앱 부팅 시 한 번 채워두고, 세션 내내 이 값을 기준으로 isUnseen()을 판정한다.
// 방문할 때마다 즉시 갱신하지 않는 이유: 지도를 보는 도중에 기준 시각이
// 계속 "지금"으로 따라오면 방금 막 켜진 새 점이 다음 렌더에 바로 꺼져버려
// "새 글" 표시가 사실상 안 보인다.
let _unseenSinceTimestamp = null;

// 위 시간 기준과 별개로, 실제로 열어본 기억은 다음 방문을 기다리지 않고
// 바로 "새 글" 점을 꺼주기 위한 보조 신호(2026-08-31). 기기 단위
// localStorage — isUnseen과 마찬가지로 신원 확인이 아니라 UX 신호다.
let _readStoryIdsCache = null;
function loadReadStoryIds() {
  if (_readStoryIdsCache) return _readStoryIdsCache;
  try {
    const raw = localStorage.getItem(READ_STORIES_KEY);
    _readStoryIdsCache = new Set(raw ? JSON.parse(raw) : []);
  } catch (e) {
    _readStoryIdsCache = new Set();
  }
  return _readStoryIdsCache;
}

// Story의 nullable 문자열 필드들 — updateStory에서 명시적 null을 보내면
// AppSync가 "Unauthorized on [필드명]"으로 거부한다(Amplify Gen2 알려진 버그:
// identityPool 규칙과 userPools 그룹 규칙을 함께 쓰는 모델에서, update
// 뮤테이션에 nullable 필드를 null로 보내는 조합에서만 재현됨 — 값을 아예 안
// 보내거나 실제 문자열을 보내면 문제없다. 실제 GraphQL 응답으로 재현·확인
// 했다, 2026-08-24. 이 필드들은 전부 falsy 체크로만 쓰여서 빈 문자열도 null과
// 동일하게 동작해 안전한 우회책이다 — updateStory가 서버로 나가기 직전에만
// null → ""로 바꾼다).
const NULLABLE_STRING_FIELDS = [
  "placeId", "officialPlaceName", "address", "customName",
  "youtubeUrl", "musicArtist", "musicTitle", "referenceDate", "photoKey",
];

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
// 로그인 계정의 "떠올랐어요" 반응 — storyId → StoryReaction 레코드 id(Promise).
// _myStoryIds와 같은 이유로 미리 캐싱하고, null이면 비로그인(=반응 없음).
// auth.js가 로그인/로그아웃 시점에 refreshMyReactions()/clearMyReactions()로 갱신한다.
let _myReactions = null;
// 로그인 계정이 "전달한" 기억 id 집합(StoryShare) — 위와 같은 패턴.
let _mySharedIds = null;
// 로그인 계정의 발자취 장소 "가보고 싶어요"(PlaceWish, 2026-10-16) —
// placeId → { courseId, createdAt, recordId(Promise) }. 위와 같은 패턴.
let _myPlaceWishes = null;
// 로그인 계정이 좋아요한 발자취(CourseLike, 2026-10-22) — courseId → 레코드
// id(Promise). 위와 같은 패턴이라 null이면 비로그인.
let _myCourseLikes = null;
// 발자취 좋아요 수(CourseLikeCount) — courseId → count. 레코드가 아직 없는
// 코스(한 번도 안 눌림)는 Map에 없고, 처음 누를 때 create로 만든다.
const _courseLikeCounts = new Map();
// 발자취 조회수(CourseViewCount) — courseId → count. 좋아요 수와 같은 방식.
const _courseViewCounts = new Map();

// strict: 조회 오류를 빈 목록으로 삼키지 않고 던진다 — "데이터가 없음"과 "못 받음"을
// 구분해야 하는 곳(발자취 목록)에서 쓴다. 기본은 예전처럼 오류를 로그만 남기고 받은 만큼 돌려준다.
async function fetchAll(modelName, { strict = false } = {}) {
  const items = [];
  let nextToken = null;
  do {
    const { data, nextToken: token, errors } = await client.models[modelName].list({
      limit: 1000,
      nextToken,
    });
    if (errors) {
      console.error(`${modelName} 목록 조회 실패`, errors);
      if (strict) throw new Error(`${modelName} 목록 조회 실패`);
      break;
    }
    items.push(...data);
    nextToken = token;
  } while (nextToken);
  return items;
}

const Storage = {
  // true면 logEvent가 아무것도 남기지 않는다 — 비공개 시안 미리보기(?preview=1)로
  // 둘러보는 동안의 반응이 발자취 통계에 섞이지 않게(js/course.js).
  eventsSuppressed: false,

  async init() {
    // 지난 방문 때 캐시해둔 목록이 있으면 네트워크 응답을 기다리지 않고
    // 먼저 그려둔다 — map.js가 이미 로드돼 있어야 하는데, app.js가
    // initMap()을 Storage.init()보다 먼저 부르도록 되어 있어 순서는
    // 보장된다.
    const cached = this._loadCachedStories();
    if (cached) {
      _cache = cached;
      if (typeof renderMarkers === "function") renderMarkers();
    }

    try {
      client = await window._backendClientReady;
      await this.refresh();
    } catch (e) {
      console.error("백엔드 연결 실패", e);
      // 캐시가 있었으면 오래된 목록이라도 보여주는 게 빈 지도보다 낫다 —
      // 캐시가 아예 없었을 때만(첫 방문 등) 빈 목록으로 시작한다.
      if (!cached) _cache = [];
    }
  },

  /**
   * 전체 스토리 + 금칙어 목록을 서버에서 다시 가져와 캐시를 갱신한다.
   * init()이 부팅 시 한 번 호출하고, admin.js는 로그인 직후와 각 액션
   * (숨김/삭제/복구) 이후 재호출해서 화면을 최신 상태로 유지한다.
   */
  async refresh() {
    // 서로 의존관계가 없는 두 목록 조회를 순차 대기하고 있었다 — 병렬로
    // 바꿔 왕복 한 번만큼 부팅 시간을 줄인다(2026-09-01).
    const [stories, bannedWords] = await Promise.all([fetchAll("Story"), fetchAll("BannedWord")]);
    _cache = stories;
    _bannedWords = bannedWords;
    this._saveCachedStories(stories);
  },

  _loadCachedStories() {
    try {
      const raw = localStorage.getItem(STORY_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  },

  _saveCachedStories(stories) {
    try {
      localStorage.setItem(STORY_CACHE_KEY, JSON.stringify(stories));
    } catch (e) {
      // 저장공간 부족 등으로 실패해도 다음 방문에서 그냥 서버 응답을
      // 기다리는 것으로 조용히 폴백된다 — 캐시는 있으면 좋은 것일 뿐.
    }
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
      // 로컬 캐시(target)는 위에서 이미 null 그대로 반영했다 — 서버로 나가는
      // 값만 NULLABLE_STRING_FIELDS 우회책을 적용한다(위 상수 주석 참고).
      const wireFields = { ...fields };
      NULLABLE_STRING_FIELDS.forEach((key) => {
        if (wireFields[key] === null) wireFields[key] = "";
      });
      client.models.Story.update({ id: storyId, ...wireFields })
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
    // 반응은 로그인 계정 단위로만 기록한다(2026-10-08) — 비로그인이면
    // 호출부(handleReactionTap)가 먼저 로그인을 요구하므로 여기선 무시.
    if (!_myReactions) return target;

    target.reactionCount = target.reactionCount || 0;

    if (_myReactions.has(storyId)) {
      target.reactionCount = Math.max(0, target.reactionCount - 1);
      const recordIdPromise = _myReactions.get(storyId);
      _myReactions.delete(storyId);
      if (client) {
        // 방금 누른 반응을 바로 취소하는 경우 create 응답(레코드 id)을
        // 기다렸다가 지운다.
        recordIdPromise
          .then((id) => id && client.models.StoryReaction.delete({ id }, { authMode: "userPool" }))
          .then((res) => res?.errors && console.error("반응 기록 삭제 실패", storyId, res.errors))
          .catch((e) => console.error("반응 기록 삭제 실패", storyId, e));
      }
    } else {
      target.reactionCount += 1;
      // Amplify Data는 GraphQL 에러를 reject가 아니라 errors 배열로
      // resolve하므로 따로 확인한다([[project_amplify_data_silent_errors]]).
      const recordIdPromise = client
        ? client.models.StoryReaction.create({ storyId }, { authMode: "userPool" })
          .then(({ data, errors }) => {
            if (errors) console.error("반응 기록 실패", storyId, errors);
            return data?.id || null;
          })
          .catch((e) => {
            console.error("반응 기록 실패", storyId, e);
            return null;
          })
        : Promise.resolve(null);
      _myReactions.set(storyId, recordIdPromise);
    }

    if (client) {
      client.models.Story.update({ id: storyId, reactionCount: target.reactionCount })
        .catch((e) => console.error("반응 반영 실패(백그라운드)", storyId, e));
    }
    return target;
  },

  /**
   * "내가 떠올랐어요를 눌렀는지"는 오직 로그인 계정 기준이다(2026-10-08).
   * 예전엔 브라우저 localStorage에만 둬서 같은 브라우저에서 다른 계정으로
   * 로그인해도 이전 계정의 반응이 그대로 보였다. 비로그인이면 항상 false.
   */
  hasReacted(storyId) {
    return !!_myReactions && _myReactions.has(storyId);
  },

  /**
   * 로그인 직후(auth.js)에 한 번 호출해 내 반응 캐시를 채운다 —
   * refreshMyStoryIds와 같은 패턴(owner 기반 읽기라 userPool authMode).
   */
  async refreshMyReactions() {
    // 예전 브라우저 단위 기록은 누구 반응인지 알 수 없어 그냥 버린다.
    try {
      localStorage.removeItem(LEGACY_REACTED_KEY);
    } catch (_) {}
    const reactions = new Map();
    if (client) {
      let nextToken = null;
      try {
        do {
          const { data, nextToken: token, errors } = await client.models.StoryReaction.list({
            limit: 1000,
            nextToken,
            authMode: "userPool",
          });
          if (errors) {
            console.error("내 반응 기록 조회 실패", errors);
            break;
          }
          data.forEach((r) => reactions.set(r.storyId, Promise.resolve(r.id)));
          nextToken = token;
        } while (nextToken);
      } catch (e) {
        console.error("내 반응 기록 조회 실패", e);
      }
    }
    _myReactions = reactions;
  },

  /**
   * 로그아웃/탈퇴(auth.js) 시 비운다 — 남아있으면 다음 계정에 이전
   * 계정의 반응이 "이미 했음"으로 보인다.
   */
  clearMyReactions() {
    _myReactions = null;
  },

  /**
   * 발자취 장소를 "가보고 싶어요"에 담았는지 — 로그인 계정 기준(비로그인이면
   * 항상 false). 반응(hasReacted)과 같은 이유로 브라우저에는 두지 않는다.
   */
  hasWishedPlace(placeId) {
    return !!_myPlaceWishes && _myPlaceWishes.has(placeId);
  },

  /** 담은 장소들, 최근에 담은 순 — 계정 메뉴 "가보고 싶은 곳" 목록. */
  getMyPlaceWishes() {
    if (!_myPlaceWishes) return [];
    return [..._myPlaceWishes.entries()]
      .map(([placeId, w]) => ({ placeId, courseId: w.courseId, createdAt: w.createdAt }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  /**
   * 담기/빼기를 바꾸고 바뀐 상태(담겼으면 true)를 돌려준다. 비로그인이면
   * 호출부가 먼저 로그인을 요구하므로 여기선 아무것도 안 한다(false).
   */
  togglePlaceWish(placeId, courseId) {
    if (!_myPlaceWishes) return false;
    const existing = _myPlaceWishes.get(placeId);
    if (existing) {
      _myPlaceWishes.delete(placeId);
      if (client) {
        // 방금 담은 걸 바로 빼는 경우 create 응답(레코드 id)을 기다렸다가 지운다.
        existing.recordId
          .then((id) => id && client.models.PlaceWish.delete({ id }, { authMode: "userPool" }))
          .then((res) => res?.errors && console.error("가보고 싶어요 삭제 실패", placeId, res.errors))
          .catch((e) => console.error("가보고 싶어요 삭제 실패", placeId, e));
      }
      return false;
    }
    // GraphQL 에러는 reject가 아니라 errors 배열로 온다([[project_amplify_data_silent_errors]]).
    const recordId = client
      ? client.models.PlaceWish.create({ placeId, courseId }, { authMode: "userPool" })
        .then(({ data, errors }) => {
          if (errors) console.error("가보고 싶어요 저장 실패", placeId, errors);
          return data?.id || null;
        })
        .catch((e) => {
          console.error("가보고 싶어요 저장 실패", placeId, e);
          return null;
        })
      : Promise.resolve(null);
    _myPlaceWishes.set(placeId, { courseId, createdAt: new Date().toISOString(), recordId });
    return true;
  },

  /** 로그인 직후(auth.js) 호출 — refreshMyReactions와 같은 패턴. */
  async refreshMyPlaceWishes() {
    const wishes = new Map();
    if (client) {
      let nextToken = null;
      try {
        do {
          const { data, nextToken: token, errors } = await client.models.PlaceWish.list({
            limit: 1000,
            nextToken,
            authMode: "userPool",
          });
          if (errors) {
            console.error("가보고 싶어요 조회 실패", errors);
            break;
          }
          data.forEach((w) => wishes.set(w.placeId, { courseId: w.courseId, createdAt: w.createdAt || "", recordId: Promise.resolve(w.id) }));
          nextToken = token;
        } while (nextToken);
      } catch (e) {
        console.error("가보고 싶어요 조회 실패", e);
      }
    }
    _myPlaceWishes = wishes;
  },

  /** 로그아웃/탈퇴(auth.js) 시 비운다 — 다음 계정에 섞이지 않게. */
  clearMyPlaceWishes() {
    _myPlaceWishes = null;
  },

  /** 발자취 좋아요 수 — 목록을 받아올 때(fetchPublishedCourses) 같이 채운다. */
  getCourseLikeCount(courseId) {
    return _courseLikeCounts.get(courseId) || 0;
  },

  /** 이 발자취에 좋아요를 눌렀는지 — 로그인 계정 기준(비로그인이면 항상 false). */
  hasLikedCourse(courseId) {
    return !!_myCourseLikes && _myCourseLikes.has(courseId);
  },

  /**
   * 좋아요를 누르거나 취소하고 바뀐 상태(눌렸으면 true)를 돌려준다 —
   * toggleReaction과 같이 화면 숫자를 먼저 바꾸고 서버엔 백그라운드로 보낸다.
   * 비로그인이면 호출부가 먼저 로그인을 요구하므로 여기선 아무것도 안 한다.
   */
  toggleCourseLike(courseId) {
    if (!_myCourseLikes) return false;
    const hadCount = _courseLikeCounts.has(courseId);
    const prev = _courseLikeCounts.get(courseId) || 0;
    const liked = !_myCourseLikes.has(courseId);
    const count = liked ? prev + 1 : Math.max(0, prev - 1);
    _courseLikeCounts.set(courseId, count);

    if (liked) {
      // GraphQL 에러는 reject가 아니라 errors 배열로 온다([[project_amplify_data_silent_errors]]).
      const recordId = client
        ? client.models.CourseLike.create({ courseId }, { authMode: "userPool" })
          .then(({ data, errors }) => {
            if (errors) console.error("발자취 좋아요 기록 실패", courseId, errors);
            return data?.id || null;
          })
          .catch((e) => {
            console.error("발자취 좋아요 기록 실패", courseId, e);
            return null;
          })
        : Promise.resolve(null);
      _myCourseLikes.set(courseId, recordId);
    } else {
      const recordId = _myCourseLikes.get(courseId);
      _myCourseLikes.delete(courseId);
      if (client) {
        // 방금 누른 걸 바로 취소하는 경우 create 응답(레코드 id)을 기다렸다가 지운다.
        recordId
          .then((id) => id && client.models.CourseLike.delete({ id }, { authMode: "userPool" }))
          .then((res) => res?.errors && console.error("발자취 좋아요 삭제 실패", courseId, res.errors))
          .catch((e) => console.error("발자취 좋아요 삭제 실패", courseId, e));
      }
    }

    if (client) {
      // 처음 눌리는 코스면 숫자 레코드부터 만든다. 그 사이 다른 사람이 먼저
      // 만들었으면 create가 거부되니 update로 다시 보낸다.
      const update = () => client.models.CourseLikeCount.update({ courseId, count });
      const send = hadCount
        ? update()
        : client.models.CourseLikeCount.create({ courseId, count })
          .then((res) => (res?.errors ? update() : res));
      send
        .then((res) => res?.errors && console.error("발자취 좋아요 수 반영 실패", courseId, res.errors))
        .catch((e) => console.error("발자취 좋아요 수 반영 실패", courseId, e));
    }
    return liked;
  },

  /** 로그인 직후(auth.js) 호출 — refreshMyReactions와 같은 패턴. */
  async refreshMyCourseLikes() {
    const likes = new Map();
    if (client?.models.CourseLike) {
      let nextToken = null;
      try {
        do {
          const { data, nextToken: token, errors } = await client.models.CourseLike.list({
            limit: 1000,
            nextToken,
            authMode: "userPool",
          });
          if (errors) {
            console.error("발자취 좋아요 조회 실패", errors);
            break;
          }
          data.forEach((l) => likes.set(l.courseId, Promise.resolve(l.id)));
          nextToken = token;
        } while (nextToken);
      } catch (e) {
        console.error("발자취 좋아요 조회 실패", e);
      }
    }
    _myCourseLikes = likes;
  },

  /** 로그아웃/탈퇴(auth.js) 시 비운다 — 다음 계정에 섞이지 않게. */
  clearMyCourseLikes() {
    _myCourseLikes = null;
  },

  /** 발자취 조회수 — 목록을 받아올 때(fetchPublishedCourses) 같이 채운다. */
  getCourseViewCount(courseId) {
    return _courseViewCounts.get(courseId) || 0;
  },

  /**
   * 발자취에 들어가 장소 카드를 보면 조회수 +1(js/course.js showCourseStep) — 한 번
   * 걸을 때 1번(카드를 몇 장 넘기든). 처음엔 브라우저·계정당 1번(본 사람 수)으로
   * 셌다가 "사람이 아니라 눈"이라 본 횟수로 바꿨다(2026-10-23). 그때 쓰던
   * CourseView 모델은 스키마에만 남아 있고 더는 안 쓴다.
   */
  recordCourseView(courseId) {
    if (this.isAutomatedBrowser()) return;
    // 화면 숫자는 바로 올리고, 저장은 아래에서 최신 값을 다시 읽어 +1 한다
    _courseViewCounts.set(courseId, (_courseViewCounts.get(courseId) || 0) + 1);
    if (!client?.models.CourseViewCount) return;
    // 목록을 받아온 뒤 숫자가 바뀌었을 수 있어(다른 사람의 조회, 관리자 수정
    // 2026-10-23) 저장 직전에 최신 값을 다시 읽는다 — 페이지를 열 때 받은 옛
    // 숫자에 +1 해서 덮어쓰면 그 사이 늘어난 숫자가 되돌아간다. 동시에 여러 명이
    // 보는 순간엔 여전히 한두 번이 빠질 수 있다(완전히 막으려면 서버 쪽 +1 필요).
    // 레코드가 없으면 만들고, 그 사이 누가 먼저 만들었으면 create가 거부되니 다시 읽어 update.
    const model = client.models.CourseViewCount;
    const readLatest = async () => {
      const { data, errors } = await model.get({ courseId });
      if (errors) throw new Error(errors.map((e) => e.message).join(", "));
      return data;
    };
    const bump = async (latest) => {
      const count = (latest?.count || 0) + 1;
      _courseViewCounts.set(courseId, count);
      return latest ? model.update({ courseId, count }) : model.create({ courseId, count });
    };
    (async () => {
      let res = await bump(await readLatest());
      if (res?.errors) res = await bump(await readLatest());
      if (res?.errors) console.error("발자취 조회수 반영 실패", courseId, res.errors);
    })().catch((e) => console.error("발자취 조회수 반영 실패", courseId, e));
  },

  hasShared(storyId) {
    return !!_mySharedIds && _mySharedIds.has(storyId);
  },

  // "내가 전달했는지"도 반응과 같은 이유로 로그인 계정 기준이다(2026-10-08,
  // 예전엔 브라우저 localStorage라 같은 브라우저의 다른 계정과 섞였다).
  // shareCount는 비로그인 공유도 계속 세고, 이 기록은 MY MEMORY(GNB)의
  // "전달한 기억"에서만 개인 참고용으로 쓰여 로그인 상태에서만 남긴다.
  markShared(storyId) {
    if (!_mySharedIds || _mySharedIds.has(storyId)) return;
    _mySharedIds.add(storyId);
    if (!client) return;
    client.models.StoryShare.create({ storyId }, { authMode: "userPool" })
      .then(({ errors }) => errors && console.error("전달 기록 실패", storyId, errors))
      .catch((e) => console.error("전달 기록 실패", storyId, e));
  },

  /** 로그인 직후(auth.js) 호출 — refreshMyReactions와 같은 패턴. */
  async refreshMySharedIds() {
    try {
      localStorage.removeItem(LEGACY_SHARED_KEY);
    } catch (_) {}
    const ids = new Set();
    if (client) {
      let nextToken = null;
      try {
        do {
          const { data, nextToken: token, errors } = await client.models.StoryShare.list({
            limit: 1000,
            nextToken,
            authMode: "userPool",
          });
          if (errors) {
            console.error("내 전달 기록 조회 실패", errors);
            break;
          }
          data.forEach((r) => ids.add(r.storyId));
          nextToken = token;
        } while (nextToken);
      } catch (e) {
        console.error("내 전달 기록 조회 실패", e);
      }
    }
    _mySharedIds = ids;
  },

  clearMySharedIds() {
    _mySharedIds = null;
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

  // 작성자에게 "N명이 읽었어요"로 보여주는 값이라(2026-10-19, storySheet.js
  // story-read-caption) 대략 "읽은 사람 수"가 되게 센다 — 내 글은 안 세고,
  // 이 브라우저에서 이미 읽은 기억(markStoriesRead)은 다시 안 센다. 그전엔
  // 시트를 열 때마다 무조건 +1이라 작성자 본인 조회·재열람까지 섞여 있었다.
  incrementViewCount(storyId) {
    const target = _cache.find((s) => s.id === storyId);
    if (!target) return null;
    if (this.isMyStory(storyId) || loadReadStoryIds().has(storyId)) return target;
    target.viewCount = (target.viewCount || 0) + 1;
    if (client && !this.isAutomatedBrowser()) {
      client.models.Story.update({ id: storyId, viewCount: target.viewCount })
        .catch((e) => console.error("조회수 반영 실패(백그라운드)", storyId, e));
    }
    return target;
  },

  /**
   * 사람이 아닌 자동화 브라우저인지 — 이런 접속은 방문·이벤트·조회수 통계에
   * 남기지 않는다(2026-10-14). 화면 확인용으로 띄우는 헤드리스 크롬(Claude
   * 세션의 배포 전 점검)이 방문 기록에 9번 찍혀 사람 방문처럼 보였다.
   * 헤드리스 크롬은 navigator.webdriver가 false로 나와서 UA로도 거른다.
   */
  isAutomatedBrowser() {
    return navigator.webdriver === true || /HeadlessChrome/.test(navigator.userAgent);
  },

  /**
   * 방문 로그 기록 — write-only(게스트는 read 권한이 없어 자기가 남긴 것도
   * 못 읽는다). 실패해도 지도 사용에는 영향 없으니 fire-and-forget.
   */
  logPageView(storyId) {
    if (!client || this.isAutomatedBrowser() || this.eventsSuppressed) return;
    let deviceInfo = null;
    try {
      const standalone = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
      deviceInfo = this.describeDevice(navigator.userAgent, navigator.maxTouchPoints || 0, standalone);
    } catch (e) {
      // 기기 요약은 없어도 방문 기록은 남긴다.
    }
    client.models.PageView.create({ storyId: storyId || null, deviceId: this.getDeviceId(), deviceInfo })
      .catch((e) => console.error("방문 로그 기록 실패", e));
  },

  /**
   * userAgent → "모바일 · iPhone · 카카오톡" 같은 기기 요약(2026-10-14) —
   * 어드민 방문현황에서 많이 연 기기가 누구 것인지 가늠하는 용도. 종류·OS·
   * 브라우저까지만 남기고 IP·위치는 남기지 않는다. 카톡/네이버/인스타 등
   * 인앱 브라우저는 UA에 크롬·사파리 표시도 같이 있어서 먼저 확인한다.
   * 아이패드(iPadOS)는 UA가 맥과 같아서 터치 지원 여부로 구분한다.
   */
  describeDevice(ua, maxTouchPoints = 0, standalone = false) {
    let os = "기타";
    if (/iPhone|iPod/.test(ua)) os = "iPhone";
    else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) os = "iPad";
    else if (/Android/.test(ua)) os = "Android";
    else if (/Windows/.test(ua)) os = "Windows";
    else if (/Macintosh|Mac OS X/.test(ua)) os = "Mac";
    else if (/Linux|CrOS/.test(ua)) os = "Linux";

    let type = "PC";
    if (os === "iPad" || (os === "Android" && !/Mobile/.test(ua))) type = "태블릿";
    else if (os === "iPhone" || os === "Android") type = "모바일";

    const browsers = [
      [/KAKAOTALK/i, "카카오톡"],
      [/NAVER\(inapp|NAVER\//, "네이버앱"],
      [/Instagram/, "인스타그램"],
      [/FBAN|FBAV/, "페이스북"],
      [/Line\//, "라인"],
      [/DaumApps/, "다음앱"],
      [/SamsungBrowser/, "삼성인터넷"],
      [/Whale/, "웨일"],
      [/Edg(A|iOS)?\//, "엣지"],
      [/FxiOS|Firefox/, "파이어폭스"],
      [/CriOS|Chrome/, "크롬"],
      [/Safari/, "사파리"],
    ];
    let browser = (browsers.find(([re]) => re.test(ua)) || [null, "기타"])[1];
    if (standalone) browser = "홈 화면 앱";
    return `${type} · ${os} · ${browser}`;
  },

  /**
   * 가벼운 퍼널 이벤트 로그 — "이맘때 기억"/작성 폼 시작·완료처럼, 새
   * 기능이 실제로 쓰이는지 나중에 어드민에서 확인할 수 있게 남긴다.
   * PageView와 같은 write-only/fire-and-forget 패턴(2026-08-21).
   */
  logEvent(type) {
    if (!client || this.isAutomatedBrowser() || this.eventsSuppressed) return;
    client.models.AppEvent.create({ type, deviceId: this.getDeviceId() })
      .catch((e) => console.error("이벤트 로그 기록 실패", type, e));
  },

  /** 어드민 전용 — 이벤트 로그 전체 조회(PageView의 listPageViews와 같은 패턴). */
  async listAppEvents() {
    return fetchAll("AppEvent");
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
   * 관리자 전용 — 방문 통계에서 뺄 기기 ID 목록. 브라우저(localStorage)가
   * 아니라 백엔드에 저장해서, 데스크톱/모바일 등 어느 브라우저로 통계를
   * 보든 동일하게 반영된다(2026-08-25).
   */
  async listExcludedDevices() {
    return fetchAll("AdminExcludedDevice");
  },

  async addExcludedDevice(deviceId) {
    const created = await client.models.AdminExcludedDevice.create({ deviceId });
    return created.data;
  },

  async removeExcludedDevice(id) {
    await client.models.AdminExcludedDevice.delete({ id });
  },

  /**
   * 어드민 계정으로 로그인한 브라우저를 방문 통계 제외 목록에 자동으로
   * 넣는다(2026-10-19). 브라우저 데이터가 지워지면 기기 ID가 새로 생겨
   * 손으로 제외해 둔 ID와 어긋나는 일이 있어서 — 아이폰 크롬이 새 ID로
   * 다시 집계된 사례. 제외는 deviceId 기준이라 로그인 전 방문 기록도
   * 같이 빠진다. 이 브라우저에서 한 번 넣고 나면 다시 넣지 않는다 —
   * 어드민이 칩을 ✕로 지운 경우 그 결정을 존중하기 위함.
   */
  async ensureDeviceExcluded() {
    if (!client) return;
    const deviceId = this.getDeviceId();
    if (localStorage.getItem(ADMIN_DEVICE_EXCLUDED_KEY) === deviceId) return;
    try {
      const { data, errors } = await client.models.AdminExcludedDevice.list({
        filter: { deviceId: { eq: deviceId } },
        authMode: "userPool",
      });
      if (errors?.length) throw errors;
      if (!data?.length) {
        const created = await client.models.AdminExcludedDevice.create({ deviceId }, { authMode: "userPool" });
        if (created.errors?.length) throw created.errors;
      }
      localStorage.setItem(ADMIN_DEVICE_EXCLUDED_KEY, deviceId);
    } catch (e) {
      console.error("어드민 기기 자동 제외 실패", e);
    }
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
   * 로그인한 본인이 "떠올랐어요" 알림 메일을 수신 거부했는지. EmailOptOut은
   * userId(=sub) 기준 본인 읽기만 열려 있어 userPool authMode로 부른다.
   * 조회가 실패하면(권한 미배포, 네트워크 등) 거부 안 한 걸로 본다 — 안내
   * 문구 하나 더 보이는 쪽이 덜 해롭다. GraphQL 에러는 reject가 아니라
   * errors 배열로 오므로 따로 확인한다.
   */
  async isEmailOptedOut(userId) {
    if (!client || !userId) return false;
    try {
      const { data, errors } = await client.models.EmailOptOut.get({ userId }, { authMode: "userPool" });
      if (errors?.length) {
        console.error("수신 거부 여부 조회 실패", errors);
        return false;
      }
      return !!data;
    } catch (e) {
      console.error("수신 거부 여부 조회 실패", e);
      return false;
    }
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
   * 회원 탈퇴(auth.js Auth.deleteAccount) 시, 계정에 연결된 개인정보
   * (email)만 지운다 — StoryAuthor 레코드 자체를 지우는 것뿐, 이미 등록된
   * Story(기억) 본문은 그대로 지도에 남는다(2026-09-02 결정 — 기억은
   * 이미 다른 이용자에게 노출/연결돼 있고 displayAuthorName은 애초에
   * 실명과 분리돼 있어 개인정보가 아니다). create/read와 동일하게 owner
   * 판정이 되려면 delete도 userPool authMode로 호출해야 한다.
   */
  async deleteMyStoryAuthors() {
    if (!client) return;
    const records = await this.listMyStoryAuthors();
    await Promise.all(
      records.map((r) =>
        client.models.StoryAuthor.delete({ id: r.id }, { authMode: "userPool" })
          .catch((e) => console.error("작성자 계정 연결 삭제 실패", r.id, e))
      )
    );
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
  /**
   * 공개된 발자취(코스) 목록 — 장소가 하나 이상인 코스만, 장소는 따라 걷기
   * 순서(seq)대로 붙여서 돌려준다(js/course.js). 스토리 목록과 달리 부팅
   * 크리티컬 경로가 아니라서 캐시 없이 지도가 뜬 뒤에 따로 부른다.
   * 비공개 코스도 API로는 읽히지만(amplify/data/resource.ts Course 주석)
   * 화면에서는 여기서 걸러 숨긴다.
   *
   * 작가 코스(authorId 있음, 2026-10-21)는 isPublished가 "공개 요청"일 뿐이라
   * 관리자 승인(CourseApproval)까지 있어야 보인다. 결과의 isLive가 지도에
   * 실제로 공개된 코스인지다(includeDrafts일 때 시안과 구분하는 용도).
   */
  async fetchPublishedCourses({ includeDrafts = false } = {}) {
    if (!client) return [];
    // 조회가 실패하면 던진다(js/course.js loadPublishedCourses가 재시도·안내) — 빈
    // 목록으로 삼키면 "공개된 발자취가 없음"과 구분이 안 된다.
    const [courses, places, approvals] = await Promise.all([
      fetchAll("Course", { strict: true }),
      fetchAll("CoursePlace", { strict: true }),
      fetchAll("CourseApproval", { strict: true }),
    ]);
    // 좋아요 수는 목록에 곁들이는 숫자라 못 받아도 목록은 그대로 보여준다.
    const likeCounts = client.models.CourseLikeCount
      ? await fetchAll("CourseLikeCount").catch((e) => {
        console.error("발자취 좋아요 수 조회 실패", e);
        return [];
      })
      : [];
    likeCounts.forEach((l) => _courseLikeCounts.set(l.courseId, l.count || 0));
    // 조회수도 곁들이는 숫자라 같은 식으로 받는다.
    const viewCounts = client.models.CourseViewCount
      ? await fetchAll("CourseViewCount").catch((e) => {
        console.error("발자취 조회수 조회 실패", e);
        return [];
      })
      : [];
    viewCounts.forEach((v) => _courseViewCounts.set(v.courseId, v.count || 0));
    const approvedIds = new Set(approvals.map((a) => a.courseId));
    const courseById = Object.fromEntries(courses.map((c) => [c.id, c]));
    const placesByCourse = {};
    places.forEach((p) => {
      // 작가는 아무 courseId로나 장소를 만들 수 있어서, 코스와 authorId가 같은
      // 장소만 붙인다(amplify/data/resource.ts CoursePlace.authorId).
      if ((p.authorId || null) !== (courseById[p.courseId]?.authorId || null)) return;
      (placesByCourse[p.courseId] ||= []).push(p);
    });
    return courses
      .map((c) => ({ ...c, isLive: Storage.isCourseLive(c, approvedIds) }))
      .filter((c) => (includeDrafts || c.isLive) && placesByCourse[c.id]?.length)
      .map((c) => ({ ...c, places: placesByCourse[c.id].sort((a, b) => a.seq - b.seq) }))
      .sort(Storage.compareCourseOrder);
  },

  /**
   * 발자취 목록 순서(2026-10-22) — 정렬 순서(sortOrder)를 1 이상으로 넣은
   * 코스만 "고정"으로 숫자 작은 순 맨 앞에, 나머지(0, 작가 코스는 항상 0)는
   * 최신순. 맨 앞 코스가 목록의 "지금 둘러보세요" 자리라 운영자가 고르고,
   * 새 발자취는 숫자를 다시 매기지 않아도 고정 바로 아래로 올라온다.
   * 예전엔 모두 0이라 사실상 제목 가나다순이었다. 지도·어드민이 같이 쓴다.
   */
  compareCourseOrder(a, b) {
    const pinA = a.sortOrder > 0 ? a.sortOrder : Infinity;
    const pinB = b.sortOrder > 0 ? b.sortOrder : Infinity;
    if (pinA !== pinB) return pinA - pinB;
    return (b.createdAt || "").localeCompare(a.createdAt || "") || a.title.localeCompare(b.title);
  },

  /** 지도에 실제로 공개된 코스인지 — 운영자 코스는 isPublished만, 작가 코스는 승인까지. */
  isCourseLive(course, approvedIds) {
    return !!course.isPublished && (!course.authorId || approvedIds.has(course.id));
  },

  /**
   * 발자취 장소 사진들(최대 COURSE_PLACE_PHOTO_MAX장, 2026-10-16) — 1번(대표)은
   * 예전 필드(photoKey/photoFocusX·Y/description/photoCredit), 2번부터는
   * extraPhotos에 있다(amplify/data/resource.ts CoursePlace). 카드와 어드민이
   * 같은 모양 { key, focusX, focusY, title, credit }으로 다루게 합친다.
   */
  getCoursePlacePhotos(place) {
    if (!place?.photoKey) return [];
    const first = {
      key: place.photoKey,
      focusX: place.photoFocusX ?? 50,
      focusY: place.photoFocusY ?? 50,
      title: place.description || "",
      credit: place.photoCredit || "",
    };
    const extras = (place.extraPhotos || [])
      .filter((p) => p?.key)
      .map((p) => ({ key: p.key, focusX: p.focusX ?? 50, focusY: p.focusY ?? 50, title: p.title || "", credit: p.credit || "" }));
    return [first, ...extras].slice(0, COURSE_PLACE_PHOTO_MAX);
  },

  /**
   * 이 장소 카드를 열 때 처음 보여줄 사진 번호 — 지난번에 마지막으로 본
   * 사진의 다음 장(끝이면 다시 1번). 처음 보는 장소면 1번(0).
   */
  getCoursePhotoStartIndex(placeId, count) {
    if (count <= 1) return 0;
    let seen;
    try {
      seen = JSON.parse(localStorage.getItem(COURSE_PHOTO_SEEN_KEY) || "{}")[placeId];
    } catch (e) {
      return 0;
    }
    return Number.isInteger(seen) ? (seen + 1) % count : 0;
  },

  markCoursePhotoSeen(placeId, index) {
    try {
      const seen = JSON.parse(localStorage.getItem(COURSE_PHOTO_SEEN_KEY) || "{}");
      seen[placeId] = index;
      localStorage.setItem(COURSE_PHOTO_SEEN_KEY, JSON.stringify(seen));
    } catch (e) {
      // 시크릿 창 등 저장이 막혀도 매번 1번부터 보일 뿐이다.
    }
  },

  _readCourseProgressAll() {
    try {
      return JSON.parse(localStorage.getItem(COURSE_PROGRESS_KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  },

  _writeCourseProgressAll(all) {
    try {
      localStorage.setItem(COURSE_PROGRESS_KEY, JSON.stringify(all));
    } catch (e) {
      // 저장이 막혀도 매번 처음부터 걸을 뿐이다.
    }
  },

  /**
   * 코스 진행 요약 — 지금 코스에 남아 있는 장소 기준으로 센다.
   * resumeIndex: 이어 걸을 장소 순서(지난번 마지막으로 보던 장소). 첫 장소였거나,
   *   끝까지 다 봤거나, 그 장소가 지워졌으면 null(처음부터).
   * seenCount: 이번 바퀴에 둘러본 장소 수, finished: 마지막 카드까지 다 봤는지.
   * currentIndex: 마지막으로 보던 장소 순서(없으면 null).
   * completedOnce: 한 번이라도 끝까지 본 적 있는지 — "처음부터 걷기"로 안 지워진다.
   */
  getCourseProgress(course) {
    const progress = this._readCourseProgressAll()[course.id];
    if (!progress) return { resumeIndex: null, seenCount: 0, finished: false, currentIndex: null, completedOnce: false };
    const seen = new Set(progress.seen || []);
    const index = course.places.findIndex((p) => p.id === progress.lastPlaceId);
    return {
      resumeIndex: !progress.finished && index > 0 ? index : null,
      seenCount: course.places.filter((p) => seen.has(p.id)).length,
      finished: Boolean(progress.finished),
      currentIndex: index >= 0 ? index : null,
      // completedOnce가 생기기 전(2026-10-23) 기록은 finished로 대신한다
      completedOnce: Boolean(progress.completedOnce ?? progress.finished),
    };
  },

  /** 한 번이라도 본 장소 id — "처음부터 걷기"로 seen이 비워져도 남는다(everSeen 이전 기록은 seen으로). */
  _everSeenPlaceIds(progress) {
    return new Set([...(progress?.everSeen || []), ...(progress?.seen || [])]);
  },

  /**
   * "NEW" 장소(2026-10-23) — 최근 NEW_PLACE_DAYS일 안에 추가됐고 한 번도 안 본 장소의
   * 순서(index) 배열. 이 코스를 한 곳이라도 본 적 있는 사람에게만 센다 — 처음 오는
   * 사람에겐 모든 장소가 새것이라 중간으로 점프하게 되기 때문. createdAt(생성 시각)만
   * 보므로 기존 장소를 고쳐 저장해도 NEW가 되지 않는다. 기록이 기기별이라 다른
   * 기기에선 이미 본 장소도 NEW로 보일 수 있다.
   * 이번 바퀴 기록(seen)이 아니라 everSeen으로 판정한다 — 다 본 뒤 "처음부터"로 다시
   * 5곳만 보면 seen이 1~5만 남아 6~20도 NEW로 뜨던 문제(2026-10-23).
   */
  getCourseNewPlaceIndices(course) {
    const progress = this._readCourseProgressAll()[course.id];
    const everSeen = this._everSeenPlaceIds(progress);
    if (!everSeen.size) return [];
    const since = Date.now() - NEW_PLACE_DAYS * 24 * 60 * 60 * 1000;
    const indices = [];
    course.places.forEach((p, i) => {
      const created = Date.parse(p.createdAt);
      if (!everSeen.has(p.id) && Number.isFinite(created) && created >= since) indices.push(i);
    });
    return indices;
  },

  markCoursePlaceSeen(courseId, placeId) {
    const all = this._readCourseProgressAll();
    const progress = all[courseId] || { seen: [] };
    all[courseId] = {
      lastPlaceId: placeId,
      seen: [...new Set([...(progress.seen || []), placeId])],
      everSeen: [...new Set([...this._everSeenPlaceIds(progress), placeId])],
      finished: false,
      completedOnce: Boolean(progress.completedOnce ?? progress.finished),
    };
    this._writeCourseProgressAll(all);
  },

  markCourseFinished(courseId) {
    const all = this._readCourseProgressAll();
    all[courseId] = { ...(all[courseId] || { seen: [] }), lastPlaceId: null, finished: true, completedOnce: true };
    this._writeCourseProgressAll(all);
  },

  /**
   * "처음부터 걷기" — 이번 바퀴 기록(둘러본 수·이어 걷기 위치)만 비우고 새로 센다.
   * 한 번이라도 본 장소(everSeen, NEW 판정용)와 완주 여부(completedOnce)는 남긴다.
   */
  resetCourseProgress(courseId) {
    const all = this._readCourseProgressAll();
    const progress = all[courseId];
    if (!progress) return;
    all[courseId] = {
      lastPlaceId: null,
      seen: [],
      everSeen: [...this._everSeenPlaceIds(progress)],
      finished: false,
      completedOnce: Boolean(progress.completedOnce ?? progress.finished),
    };
    this._writeCourseProgressAll(all);
  },

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
   * 도로명까지만(도로명 주소면 "로/길"로 끝나는 토큰까지), 도로명이 없는
   * 지번 주소면 동/읍/면/리/가 레벨까지만 남기고 번지수는 뗀다 — 기억
   * 라디오(js/recall.js openRecallCard)에서 장소 이름을 안 붙인 자유
   * 핀이면 주소 전체("서울 강남구 테헤란로 152", "서울 중구 충무로4가
   * 23-1")가 그대로 노출돼 너무 구체적으로 보인다는 피드백으로 추가
   * (2026-08-21 최초 추가, 2026-08-23 도로명 주소까지 명시적으로 자르도록
   * 보강 — 예전엔 끝 토큰이 순수 번지수 패턴일 때만 잘라내는 간접적인
   * 방식이라, 번지수 표기가 "152,154"처럼 그 패턴을 안 따르면 안 잘렸다).
   * 이 축약은 기억 라디오 전용이라 카드/공유 등 다른 화면의
   * getGroupAddressCaption/getGroupTitle은 그대로 abbreviateAddress를 쓴다.
   */
  getDongLevelAddress(address) {
    if (!address) return address;
    const tokens = this.abbreviateAddress(address).split(/\s+/);
    const roadTokenIdx = tokens.findIndex((t) => /(로|길)$/.test(t));
    if (roadTokenIdx !== -1) return tokens.slice(0, roadTokenIdx + 1).join(" ");
    // 도로명 토큰이 없으면 지번 주소 — 맨 끝에서부터 "산" 또는 숫자(-숫자
    // 포함)로만 된 토큰을 번지로 보고 잘라낸다. "산 123-4"처럼 산지번이
    // 두 토큰으로 쪼개진 경우도 순서대로 둘 다 떨어진다.
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
   * 지도 마커의 "새 글" 표시(2026-08-27) — 브라우저(기기) 단위로 직전
   * 방문 시각을 localStorage에 남겨두고, 그 이후 올라온 기억이 있는
   * 장소를 "안 본 글이 있다"고 표시한다. 계정 기반이 아니라 기기 기반인
   * 것은 의도적 — "내 것" 판정 같은 신원 확인이 아니라 순수 UX 신호(안
   * 읽음 표시)라 기기별로 갈려도 무방하다. 앱 부팅 시 한 번만 호출해
   * 직전 방문 시각을 기준으로 굳혀두고(isUnseen 참고), 동시에 저장값은
   * "지금"으로 갱신해 다음 방문의 기준을 준비해둔다. 처음 방문이면(저장된
   * 값 없음) 아무것도 "새 글"로 표시하지
   * 않는다 — 그 시점의 지도 전체가 다 "새 글"이 되는 건 의미 없는 신호다.
   */
  markVisitAndGetUnseenThreshold() {
    const prevRaw = localStorage.getItem(LAST_VISIT_KEY);
    _unseenSinceTimestamp = prevRaw ? Number(prevRaw) : null;
    localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
    return _unseenSinceTimestamp;
  },

  isUnseen(story) {
    if (_unseenSinceTimestamp === null) return false;
    if (new Date(story.createdAt).getTime() <= _unseenSinceTimestamp) return false;
    return !loadReadStoryIds().has(story.id);
  },

  /**
   * 시트를 열어 기억을 실제로 읽었을 때 호출 — 그 기억들의 "새 글" 점을
   * 다음 방문을 기다리지 않고 바로 꺼준다(isUnseen 참고).
   */
  markStoriesRead(storyIds) {
    const set = loadReadStoryIds();
    storyIds.forEach((id) => set.add(id));
    localStorage.setItem(READ_STORIES_KEY, JSON.stringify([...set]));
  },

  isStoryRead(storyId) {
    return loadReadStoryIds().has(storyId);
  },

  /** 어드민 로그인으로 통계 제외 목록에 자동 등록된 브라우저인지(ensureDeviceExcluded). */
  isExcludedAdminDevice() {
    try {
      return localStorage.getItem(ADMIN_DEVICE_EXCLUDED_KEY) === this.getDeviceId();
    } catch (e) {
      return false;
    }
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
   * "이맘때 예전 기억" — 이 앱은 일(day) 단위 날짜를 안 남겨서(월/계절
   * 까지만) 진짜 "1년 전 오늘"은 못 만든다(2026-08-21 논의) — 대신 이번
   * 달과 월/계절이 겹치고 연도가 올해보다 이전인 기억을 "이맘때"로
   * 뭉뚱그려 찾는다. 후보가 여럿이면 다른 오늘의 미션과 같은 날짜 시드로
   * 하나를 결정론적으로 고른다(같은 날 다시 열어도 항상 같은 기억).
   * myStories는 호출부(js/filters.js)가 isMyStory로 이미 걸러서 넘긴다 —
   * 계정 연결 판단은 여기서 하지 않는다.
   */
  getThrowbackMemory(myStories) {
    const now = new Date();
    const thisMonth = now.getMonth() + 1;
    const thisYear = now.getFullYear();
    const SEASON_MONTHS = { SP: [3, 4, 5], SU: [6, 7, 8], FA: [9, 10, 11], WI: [12, 1, 2] };

    const candidates = myStories.filter((s) => {
      const year = this.getStoryYear(s);
      if (year === null || year >= thisYear) return false;
      const month = this.getStoryMonth(s);
      if (month !== null) return month === thisMonth;
      const seasonCode = this.getStorySeasonCode(s);
      return seasonCode ? SEASON_MONTHS[seasonCode].includes(thisMonth) : false;
    });
    if (candidates.length === 0) return null;
    return candidates[this._missionSeedIndex("throwback", candidates.length)];
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
