// ============================================================
// 데이터 저장 계층 (Storage Layer)
// ============================================================
// 지금은 localStorage로 동작하는 MVP 데모용 구현입니다.
// 나중에 AWS Amplify + DynamoDB로 붙일 때는 이 파일의 함수들만
// 동일한 시그니처(입출력 형태)로 API 호출로 바꿔주면 나머지 코드는
// 수정할 필요가 없도록 설계했습니다.
//
// 예: getAllStories() 는 로컬에선 localStorage.getItem, 나중엔
//     fetch('/api/stories') 로 바뀌면 됩니다.
// ============================================================

const STORAGE_KEY = "concrete_sapiens_stories_v1";

const Storage = {
  /**
   * 모든 이야기를 불러옵니다.
   * @returns {Array<Story>}
   */
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

  /**
   * 이야기 하나를 저장합니다.
   * @param {Story} story
   */
  saveStory(story) {
    const stories = this.getAllStories();
    stories.push(story);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stories));
    return story;
  },

  /**
   * 특정 이야기를 신고 처리합니다.
   * @param {string} storyId
   */
  reportStory(storyId) {
    const stories = this.getAllStories();
    const target = stories.find((s) => s.id === storyId);
    if (!target) return null;
    target.reportCount = (target.reportCount || 0) + 1;
    if (target.reportCount >= CONFIG.REPORT_HIDE_THRESHOLD) {
      target.isHidden = true;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stories));
    return target;
  },

  /**
   * 좋아요 토글 (누르면 +1, 다시 누르면 -1). 브라우저 단위로 who-liked를 기억해
   * 같은 사람이 여러 번 누르는 걸 막습니다. (로그인이 없는 MVP 특성상 완벽한
   * 중복 방지는 아니며, 추후 서버 연동 시 유저 단위로 교체 필요)
   * @param {string} storyId
   */
  toggleLike(storyId) {
    const stories = this.getAllStories();
    const target = stories.find((s) => s.id === storyId);
    if (!target) return null;

    const likedSet = this._getLikedSet();
    target.likes = target.likes || 0;

    if (likedSet.has(storyId)) {
      target.likes = Math.max(0, target.likes - 1);
      likedSet.delete(storyId);
    } else {
      target.likes += 1;
      likedSet.add(storyId);
    }

    this._saveLikedSet(likedSet);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stories));
    return target;
  },

  isLikedByMe(storyId) {
    return this._getLikedSet().has(storyId);
  },

  _getLikedSet() {
    const raw = localStorage.getItem("concrete_sapiens_liked_v1");
    try {
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (e) {
      return new Set();
    }
  },

  _saveLikedSet(set) {
    localStorage.setItem("concrete_sapiens_liked_v1", JSON.stringify([...set]));
  },

  /**
   * 댓글을 추가합니다.
   * @param {string} storyId
   * @param {{authorName: string, content: string}} comment
   */
  addComment(storyId, comment) {
    const stories = this.getAllStories();
    const target = stories.find((s) => s.id === storyId);
    if (!target) return null;

    target.comments = target.comments || [];
    target.comments.push({
      id: crypto.randomUUID(),
      authorName: comment.authorName || "익명",
      content: comment.content,
      createdAt: new Date().toISOString(),
    });

    localStorage.setItem(STORAGE_KEY, JSON.stringify(stories));
    return target;
  },

  /**
   * 전체 이야기에서 해시태그 빈도를 집계해 상위 N개를 반환합니다.
   * (많이 쓰인 순 정렬)
   * @param {number} limit
   */
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

  /**
   * 비노출 처리되지 않은 이야기만 반환
   */
  getVisibleStories() {
    return this.getAllStories().filter((s) => !s.isHidden);
  },

  /**
   * 좌표 근처(같은 장소)의 이야기를 그룹핑합니다.
   * placeId가 있으면 placeId 기준, 없으면 좌표를 반올림해 근접 좌표를 하나의 스팟으로 취급합니다.
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
          stories: [],
        };
      }
      groups[key].stories.push(story);
    });

    return Object.values(groups);
  },

  /**
   * 개발용: 초기 시드 데이터가 없으면 예시 몇 개를 심어둡니다.
   */
  seedIfEmpty() {
    if (this.getAllStories().length > 0) return;

    const seeds = [
      {
        id: crypto.randomUUID(),
        lat: 37.5274,
        lng: 127.0286,
        placeName: "압구정현대아파트",
        placeId: null,
        content: "여기 첫사랑이 살았다. 아직도 그 창문을 올려다보게 된다. #첫사랑 #그리움",
        hashtags: ["#첫사랑", "#그리움"],
        authorName: "익명",
        dateMode: "past",
        referenceDate: "1995-05-01",
        createdAt: new Date().toISOString(),
        reportCount: 0,
        isHidden: false,
        likes: 12,
        comments: [
          { id: crypto.randomUUID(), authorName: "지나가던사람", content: "저도 이 동네였는데 반가워요", createdAt: new Date().toISOString() },
        ],
      },
      {
        id: crypto.randomUUID(),
        lat: 37.5665,
        lng: 126.978,
        placeName: "서울시청 앞",
        placeId: null,
        content: "이십 년 전 여기서 첫 회사 면접을 봤다. 그날 비가 많이 왔었지. #이직 #추억",
        hashtags: ["#이직", "#추억"],
        authorName: "콘크리트사피엔스",
        dateMode: "past",
        referenceDate: "2004-11-03",
        createdAt: new Date().toISOString(),
        reportCount: 0,
        isHidden: false,
        likes: 3,
        comments: [],
      },
      {
        id: crypto.randomUUID(),
        lat: 35.1595,
        lng: 129.0756,
        placeName: "부산 haeundae",
        placeId: null,
        content: "고향을 떠나기 전 마지막으로 걸었던 해변. #고향 #이사",
        hashtags: ["#고향", "#이사"],
        authorName: "익명",
        dateMode: "none",
        referenceDate: null,
        createdAt: new Date().toISOString(),
        reportCount: 0,
        isHidden: false,
        likes: 0,
        comments: [],
      },
    ];

    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeds));
  },
};
