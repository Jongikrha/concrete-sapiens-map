// ============================================================
// 데이터 저장 계층 (Storage Layer)
// ============================================================
// v4: 주소 우선 구조 / 년-월 시점 / 태그 별도 입력 반영
//
// Story 스키마 변경 사항:
//  - placeName(단일 필드) 폐기 → officialPlaceName(검색형 장소의 공식 이름,
//    카카오 Places API 결과) / address(항상 시도하는 역지오코딩 결과) /
//    customName(자유 핀에서 작성자가 붙인 개인적 이름, 선택) 로 분리
//  - referenceDate는 "YYYY-MM" 형식으로 저장 (일자 없이 년/월까지만)
// ============================================================

const STORAGE_KEY = "concrete_sapiens_stories_v3";
const REACTED_KEY = "concrete_sapiens_reacted_v1";

// 오늘의 질문 프롬프트 목록 (매일 하나씩 결정론적으로 노출)
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

const Storage = {
  getAllStories() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error("스토리 데이터 파싱 실패", e);
      return [];
    }
  },

  saveAll(stories) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stories));
  },

  saveStory(story) {
    const stories = this.getAllStories();
    stories.push(story);
    this.saveAll(stories);
    return story;
  },

  getVisibleStories() {
    return this.getAllStories().filter((s) => s.status !== "HIDDEN");
  },

  getStoryByPublicId(publicId) {
    return this.getAllStories().find((s) => s.publicId === publicId) || null;
  },

  reportStory(storyId) {
    const stories = this.getAllStories();
    const target = stories.find((s) => s.id === storyId);
    if (!target) return null;
    target.reportCount = (target.reportCount || 0) + 1;
    if (target.reportCount >= CONFIG.REPORT_HIDE_THRESHOLD) {
      target.status = "HIDDEN";
    }
    this.saveAll(stories);
    return target;
  },

  toggleReaction(storyId) {
    const stories = this.getAllStories();
    const target = stories.find((s) => s.id === storyId);
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
    this.saveAll(stories);
    return target;
  },

  hasReacted(storyId) {
    return this._getReactedSet().has(storyId);
  },

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
    const stories = this.getAllStories();
    const target = stories.find((s) => s.id === storyId);
    if (!target) return null;
    target.shareCount = (target.shareCount || 0) + 1;
    this.saveAll(stories);
    return target;
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

  seedIfEmpty() {
    if (this.getAllStories().length > 0) return;

    const seeds = [
      {
        id: crypto.randomUUID(),
        publicId: this.generatePublicId(),
        lat: 37.5274,
        lng: 127.0286,
        placeId: null,
        officialPlaceName: null,
        address: "서울특별시 강남구 압구정로 111",
        customName: "노을바위",
        content: "학교가 끝나면 아무 이유 없이 이 앞을 몇 번씩 지나갔다. 그 애가 혹시 나올까 봐.",
        hashtags: ["#첫사랑", "#그리움"],
        authorMode: "anonymous",
        displayAuthorName: "익명",
        dateMode: "past",
        referenceDate: "1995-05",
        createdAt: new Date().toISOString(),
        reportCount: 0,
        status: "ACTIVE",
        reactionCount: 12,
        shareCount: 3,
      },
      {
        id: crypto.randomUUID(),
        publicId: this.generatePublicId(),
        lat: 37.5665,
        lng: 126.978,
        placeId: "kakao-seoul-cityhall",
        officialPlaceName: "서울시청",
        address: "서울특별시 중구 세종대로 110",
        customName: null,
        content: "이십 년 전 여기서 첫 회사 면접을 봤다. 그날 비가 많이 왔었지.",
        hashtags: ["#이직", "#추억"],
        authorMode: "custom",
        displayAuthorName: "콘크리트사피엔스",
        dateMode: "past",
        referenceDate: "2004-11",
        createdAt: new Date().toISOString(),
        reportCount: 0,
        status: "ACTIVE",
        reactionCount: 3,
        shareCount: 0,
      },
      {
        id: crypto.randomUUID(),
        publicId: this.generatePublicId(),
        lat: 35.1595,
        lng: 129.0756,
        placeId: null,
        officialPlaceName: null,
        address: "부산광역시 해운대구 해운대해변로 264",
        customName: null,
        content: "고향을 떠나기 전 마지막으로 걸었던 해변.",
        hashtags: ["#고향", "#이사"],
        authorMode: "anonymous",
        displayAuthorName: "익명",
        dateMode: "unknown",
        referenceDate: null,
        createdAt: new Date().toISOString(),
        reportCount: 0,
        status: "ACTIVE",
        reactionCount: 0,
        shareCount: 0,
      },
    ];

    this.saveAll(seeds);
  },
};
