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

// 오늘의 질문 프롬프트 목록 (매일 하나씩 결정론적으로 노출) — 데이터 의존 없음
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

async function fetchAllStories() {
  const items = [];
  let nextToken = null;
  do {
    const { data, nextToken: token, errors } = await client.models.Story.list({
      limit: 1000,
      nextToken,
    });
    if (errors) {
      console.error("스토리 목록 조회 실패", errors);
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
      _cache = await fetchAllStories();
    } catch (e) {
      console.error("백엔드 연결 실패 — 빈 지도로 시작합니다", e);
      _cache = [];
    }
  },

  // 테스트 전용 — client/_cache를 직접 주입한다.
  _setClient(c) {
    client = c;
  },
  _setCache(c) {
    _cache = c;
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

  getVisibleStories() {
    return this.getAllStories().filter((s) => s.status !== "HIDDEN");
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

  /**
   * 백업 파일 가져오기 전용 — 이미 없는 id만 추가한다(additive-only).
   * 공유 DB에서는 로컬 백업으로 전체를 덮어쓰는 saveAll류 동작이 파괴적이라
   * 의도적으로 없앴다.
   */
  async importStories(stories) {
    const existingIds = new Set(_cache.map((s) => s.id));
    const toAdd = stories.filter((s) => s.id && !existingIds.has(s.id));
    for (const story of toAdd) {
      try {
        await client.models.Story.create(story);
        _cache.push(story);
      } catch (e) {
        console.error("가져오기 실패", story.id, e);
      }
    }
    return toAdd.length;
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
    if (group.stories && group.stories.length) {
      const withCustomName = group.stories.find((s) => s.customName);
      if (withCustomName) return withCustomName.customName;
    }
    return group.address || "주소를 확인할 수 없는 곳";
  },

  /**
   * 제목이 이미 주소 자체가 아닐 때만(즉 공식명/개인 이름을 제목으로
   * 쓰고 있을 때만) 주소를 작은 캡션으로 별도 노출한다. 제목이 곧
   * 주소인 경우(둘 다 정보가 없는 자유 핀) 중복 표시를 피한다.
   */
  getGroupAddressCaption(group) {
    const title = this.getGroupTitle(group);
    if (group.address && group.address !== title) return group.address;
    return null;
  },

  getTopHashtags(limit = 30) {
    const counts = {};
    this.getVisibleStories().forEach((s) => {
      (s.hashtags || []).forEach((tag) => {
        counts[tag] = (counts[tag] || 0) + 1;
      });
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([tag]) => tag);
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

  getDailyFeaturedStory() {
    const visible = this.getVisibleStories();
    if (visible.length === 0) return null;

    const sorted = [...visible].sort((a, b) => a.id.localeCompare(b.id));
    const seed = new Date().toISOString().split("T")[0];
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash * 31 + seed.charCodeAt(i)) % sorted.length;
    }
    return sorted[Math.abs(hash) % sorted.length];
  },

  getDailyPrompt() {
    const seed = new Date().toISOString().split("T")[0];
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash * 31 + seed.charCodeAt(i)) % DAILY_PROMPTS.length;
    }
    return DAILY_PROMPTS[Math.abs(hash) % DAILY_PROMPTS.length];
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
