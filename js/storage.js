// ============================================================
// 데이터 저장 계층 (Storage Layer)
// ============================================================
// 지금은 localStorage로 동작하는 MVP 데모용 구현입니다.
// 나중에 AWS Amplify + DynamoDB(+ Cognito 인증)로 붙일 때는 이 파일의
// 함수들만 동일한 시그니처(입출력 형태)로 API 호출로 바꿔주면 나머지
// 코드는 수정할 필요가 없도록 설계했습니다.
//
// 주의: 회원가입/로그인/관리자 기능(개발기획서 §30~§52)은 이 파일에
// 아직 반영되지 않았습니다. 실제 서비스에는 Cognito 인증과 서버 측
// userId 연결이 반드시 필요합니다. 지금은 프론트엔드 프로토타입 단계로,
// authorMode/displayAuthorName만 저장하고 실제 계정 시스템은 없습니다.
// ============================================================

const STORAGE_KEY = "concrete_sapiens_stories_v2";
const REACTED_KEY = "concrete_sapiens_reacted_v1";

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

  /**
   * 반응 토글: "나도 이 기억이 떠올랐어요"
   * 좋아요가 아니라 서비스만의 반응 시스템 (design spec §19~§21)
   */
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
          placeName: story.placeName,
          address: story.address || null,
          stories: [],
        };
      }
      groups[key].stories.push(story);
    });

    return Object.values(groups);
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

  getStoryYear(story) {
    if (story.dateMode === "past" && story.referenceDate) {
      return new Date(story.referenceDate).getFullYear();
    }
    if (story.dateMode === "now") {
      return new Date(story.createdAt).getFullYear();
    }
    return null;
  },

  getStoriesByYear(year) {
    return this.getVisibleStories().filter((s) => this.getStoryYear(s) === year);
  },

  /**
   * 오늘의 기억 — 매일 하나, 날짜를 시드로 결정론적 선정
   * (같은 날 접속한 모든 사람에게 동일한 이야기가 노출됨)
   */
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

  /**
   * 최초 진입 랜덤 랜딩용 — 최근 이야기 풀 중 무작위 1개
   * (개발기획서 §4, §5 / 디자인 스펙 §4.1)
   */
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

  /**
   * 사람이 읽기 좋은 짧은 Public ID 생성 (예: A8FD72KC)
   * 실제 서비스에서는 서버에서 충돌 검사와 함께 생성해야 합니다.
   */
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
        placeName: "압구정현대아파트",
        placeId: null,
        content: "학교가 끝나면 아무 이유 없이 이 앞을 몇 번씩 지나갔다. 그 애가 혹시 나올까 봐. #첫사랑 #그리움",
        hashtags: ["#첫사랑", "#그리움"],
        authorMode: "anonymous",
        displayAuthorName: "익명",
        dateMode: "past",
        referenceDate: "1995-05-01",
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
        placeName: "서울시청 앞",
        placeId: null,
        content: "이십 년 전 여기서 첫 회사 면접을 봤다. 그날 비가 많이 왔었지. #이직 #추억",
        hashtags: ["#이직", "#추억"],
        authorMode: "custom",
        displayAuthorName: "콘크리트사피엔스",
        dateMode: "past",
        referenceDate: "2004-11-03",
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
        placeName: "부산 해운대",
        placeId: null,
        content: "고향을 떠나기 전 마지막으로 걸었던 해변. #고향 #이사",
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
