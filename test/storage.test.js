const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");

function createLocalStorageMock() {
  let store = {};
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
}

function createFakeClient() {
  return {
    models: {
      Story: {
        create: async () => ({}),
        update: async () => ({}),
        delete: async () => ({}),
        list: async () => ({ data: [], nextToken: null }),
      },
      BannedWord: {
        create: async ({ word }) => ({ data: { id: `bw-${word}`, word } }),
        delete: async () => ({}),
        list: async () => ({ data: [], nextToken: null }),
      },
      PageView: {
        create: async () => ({}),
      },
    },
  };
}

global.localStorage = createLocalStorageMock();
global.CONFIG = {
  REPORT_HIDE_THRESHOLD: 5,
  RECENT_STORY_POOL_SIZE: 100,
};

const { Storage, DAILY_PROMPTS } = require("../js/storage.js");

function createStory(overrides = {}) {
  return {
    id: `story-${Math.random().toString(36).slice(2)}`,
    publicId: "ABCD1234",
    lat: 37.5,
    lng: 127.0,
    placeId: null,
    officialPlaceName: null,
    address: "서울 어딘가",
    customName: null,
    content: "테스트 기억",
    hashtags: [],
    dateMode: "now",
    referenceDate: null,
    createdAt: "2024-05-01T00:00:00.000Z",
    status: "ACTIVE",
    reportCount: 0,
    reactionCount: 0,
    displayAuthorName: "익명",
    ...overrides,
  };
}

beforeEach(() => {
  global.localStorage.clear();
  Storage._setClient(createFakeClient());
  Storage._setCache([]);
  Storage._setBannedWords([]);
});

test("generatePublicId는 허용된 문자로 8자리 문자열을 생성한다", () => {
  const id = Storage.generatePublicId();
  assert.equal(id.length, 8);
  assert.match(id, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
});

test("getGroupTitle은 검색형 장소(placeId + officialPlaceName)일 때 공식 이름을 우선한다", () => {
  const group = {
    placeId: "kakao-1",
    officialPlaceName: "동네 카페",
    address: "서울 종로구 1길 1",
    stories: [createStory({ address: "서울 종로구 1길 1", customName: "우리 아지트" })],
  };
  assert.equal(Storage.getGroupTitle(group), "동네 카페");
});

test("getGroupTitle은 자유 핀에서 누군가 붙인 customName이 있으면 그것을 쓴다", () => {
  const group = {
    placeId: null,
    officialPlaceName: null,
    address: "서울 종로구 1길 1",
    stories: [createStory({ address: "서울 종로구 1길 1", customName: "우리 아지트" })],
  };
  assert.equal(Storage.getGroupTitle(group), "우리 아지트");
});

test("getGroupTitle은 공식 이름도 customName도 없으면 주소로 대체한다", () => {
  const group = {
    placeId: null,
    officialPlaceName: null,
    address: "서울 종로구 1길 1",
    stories: [createStory({ address: "서울 종로구 1길 1" })],
  };
  assert.equal(Storage.getGroupTitle(group), "서울 종로구 1길 1");
});

test("getGroupTitle은 주소 정보조차 없으면 안내 문구를 반환한다", () => {
  const group = { placeId: null, officialPlaceName: null, address: null, stories: [] };
  assert.equal(Storage.getGroupTitle(group), "주소를 확인할 수 없는 곳");
});

test("getGroupAddressCaption은 제목이 주소와 다를 때만 주소를 캡션으로 반환한다", () => {
  const group = {
    placeId: "kakao-1",
    officialPlaceName: "동네 카페",
    address: "서울 종로구 1길 1",
    stories: [],
  };
  assert.equal(Storage.getGroupAddressCaption(group), "서울 종로구 1길 1");
});

test("getGroupAddressCaption은 제목이 곧 주소일 때(자유 핀, 이름 없음) null을 반환한다", () => {
  const group = { placeId: null, officialPlaceName: null, address: "서울 종로구 1길 1", stories: [] };
  assert.equal(Storage.getGroupAddressCaption(group), null);
});

test("abbreviateAddress는 시/도 풀네임만 축약하고 나머지는 그대로 둔다", () => {
  assert.equal(Storage.abbreviateAddress("서울특별시 마포구 잔다리로 24"), "서울 마포구 잔다리로 24");
  assert.equal(Storage.abbreviateAddress("경기도 성남시 분당구 판교역로 1"), "경기 성남시 분당구 판교역로 1");
  assert.equal(Storage.abbreviateAddress("제주특별자치도 제주시 1100로 1"), "제주 제주시 1100로 1");
  assert.equal(Storage.abbreviateAddress("전북특별자치도 전주시 완산구 1"), "전북 전주시 완산구 1");
  assert.equal(Storage.abbreviateAddress("강원도 춘천시 1"), "강원 춘천시 1");
});

test("abbreviateAddress는 매칭되는 시/도가 없으면 원본을 그대로 반환한다", () => {
  assert.equal(Storage.abbreviateAddress("서울 종로구 1길 1"), "서울 종로구 1길 1");
  assert.equal(Storage.abbreviateAddress(null), null);
});

test("getGroupAddressCaption은 캡션으로 쓸 때 시/도 풀네임을 축약한다", () => {
  const group = {
    placeId: "kakao-1",
    officialPlaceName: "동네 카페",
    address: "서울특별시 종로구 1길 1",
    stories: [],
  };
  assert.equal(Storage.getGroupAddressCaption(group), "서울 종로구 1길 1");
});

test("getGroupTitle은 주소로 폴백할 때도 시/도 풀네임을 축약한다", () => {
  const group = { placeId: null, officialPlaceName: null, address: "서울특별시 종로구 1길 1", stories: [] };
  assert.equal(Storage.getGroupTitle(group), "서울 종로구 1길 1");
});

test("getStoryYear는 dateMode가 past일 때 referenceDate(YYYY-MM)에서 연도를 뽑는다", () => {
  const story = createStory({ dateMode: "past", referenceDate: "1998-03" });
  assert.equal(Storage.getStoryYear(story), 1998);
});

test("getStoryYear는 dateMode가 now일 때 createdAt에서 연도를 뽑는다", () => {
  const story = createStory({ dateMode: "now", createdAt: "2024-05-01T00:00:00.000Z" });
  assert.equal(Storage.getStoryYear(story), 2024);
});

test("getStoryYear는 dateMode가 unknown(기억나지 않음)이면 null을 반환한다", () => {
  const story = createStory({ dateMode: "unknown", referenceDate: null });
  assert.equal(Storage.getStoryYear(story), null);
});

test("getStoryMonth는 dateMode가 past이고 referenceDate에 월이 있으면 월을 반환한다", () => {
  const story = createStory({ dateMode: "past", referenceDate: "1998-03" });
  assert.equal(Storage.getStoryMonth(story), 3);
});

test("getStoryMonth는 referenceDate가 없으면 null을 반환한다", () => {
  const story = createStory({ dateMode: "past", referenceDate: null });
  assert.equal(Storage.getStoryMonth(story), null);
});

test("getStoryMonth는 dateMode가 now일 때 createdAt에서 월을 뽑는다", () => {
  const story = createStory({ dateMode: "now", createdAt: "2024-05-01T00:00:00.000Z" });
  assert.equal(Storage.getStoryMonth(story), 5);
});

test("saveStory는 캐시에 즉시 반영되고 저장한 값을 그대로 반환한다", () => {
  const story = createStory({ id: "s1" });
  const saved = Storage.saveStory(story);
  assert.equal(saved.id, "s1");
  assert.equal(Storage.getAllStories().length, 1);
  assert.equal(Storage.getAllStories()[0].id, "s1");
});

test("updateStory는 캐시를 즉시 반영하고 넘기지 않은 필드는 그대로 유지한다", () => {
  Storage._setCache([createStory({ id: "s1", content: "원본", reportCount: 3 })]);
  const updated = Storage.updateStory("s1", { content: "수정됨" });
  assert.equal(updated.content, "수정됨");
  assert.equal(updated.reportCount, 3);
  assert.equal(Storage.getAllStories()[0].content, "수정됨");
});

test("updateStory는 존재하지 않는 id면 null을 반환한다", () => {
  Storage._setCache([createStory({ id: "s1" })]);
  const updated = Storage.updateStory("no-such-id", { content: "x" });
  assert.equal(updated, null);
});

test("getVisibleStories는 status가 HIDDEN 또는 DELETED인 스토리를 제외한다", () => {
  Storage._setCache([
    createStory({ id: "visible", status: "ACTIVE" }),
    createStory({ id: "hidden", status: "HIDDEN" }),
    createStory({ id: "deleted", status: "DELETED" }),
  ]);
  const visible = Storage.getVisibleStories();
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, "visible");
});

test("softDeleteStory는 status를 DELETED로 바꿔 캐시에서 즉시 안 보이게 한다", async () => {
  Storage._setCache([createStory({ id: "s1", status: "ACTIVE" })]);
  const updated = await Storage.softDeleteStory("s1");
  assert.equal(updated.status, "DELETED");
  assert.equal(Storage.getVisibleStories().length, 0);
  assert.equal(Storage.getAllStories().length, 1);
});

test("reportStory는 신고 누적이 REPORT_HIDE_THRESHOLD에 도달하면 status를 HIDDEN으로 바꾼다", () => {
  Storage._setCache([createStory({ id: "s1", reportCount: 4, status: "ACTIVE" })]);
  const updated = Storage.reportStory("s1");
  assert.equal(updated.reportCount, 5);
  assert.equal(updated.status, "HIDDEN");
});

test("reportStory는 임계치 미만이면 status를 바꾸지 않는다", () => {
  Storage._setCache([createStory({ id: "s1", reportCount: 0, status: "ACTIVE" })]);
  const updated = Storage.reportStory("s1");
  assert.equal(updated.reportCount, 1);
  assert.equal(updated.status, "ACTIVE");
});

test("toggleReaction은 처음 호출 시 반응 수를 늘리고 hasReacted를 true로 만든다", () => {
  Storage._setCache([createStory({ id: "s1", reactionCount: 0 })]);
  const updated = Storage.toggleReaction("s1");
  assert.equal(updated.reactionCount, 1);
  assert.equal(Storage.hasReacted("s1"), true);
});

test("toggleReaction은 두 번째 호출(같은 사람이 다시 누름) 시 반응을 취소한다", () => {
  Storage._setCache([createStory({ id: "s1", reactionCount: 0 })]);
  Storage.toggleReaction("s1");
  const reverted = Storage.toggleReaction("s1");
  assert.equal(reverted.reactionCount, 0);
  assert.equal(Storage.hasReacted("s1"), false);
});

test("getTopHashtags는 사용 빈도 내림차순으로 정렬하고 limit만큼만 반환한다", () => {
  Storage._setCache([
    createStory({ id: "s1", hashtags: ["회사", "카페"] }),
    createStory({ id: "s2", hashtags: ["회사"] }),
    createStory({ id: "s3", hashtags: ["학교"] }),
  ]);
  assert.deepEqual(Storage.getTopHashtags(2), ["회사", "카페"]);
});

test("getYearRange는 연도 정보가 있는 스토리가 없으면 최근 10년을 기본값으로 준다", () => {
  const thisYear = new Date().getFullYear();
  const range = Storage.getYearRange();
  assert.deepEqual(range, { min: thisYear - 10, max: thisYear });
});

test("getYearRange는 스토리들의 최소/최대 연도를 계산한다", () => {
  Storage._setCache([
    createStory({ id: "s1", dateMode: "past", referenceDate: "1998-03" }),
    createStory({ id: "s2", dateMode: "past", referenceDate: "2010-07" }),
  ]);
  const range = Storage.getYearRange();
  assert.equal(range.min, 1998);
  assert.equal(range.max, new Date().getFullYear());
});

test("getDailyPrompt는 항상 DAILY_PROMPTS 중 하나를, 같은 날엔 같은 값을 반환한다", () => {
  const first = Storage.getDailyPrompt();
  const second = Storage.getDailyPrompt();
  assert.ok(DAILY_PROMPTS.includes(first));
  assert.equal(first, second);
});

test("getTodayStories는 오늘 createdAt인 기억만 반환한다", () => {
  const now = new Date();
  const todayIso = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0).toISOString();
  Storage._setCache([
    createStory({ id: "today", createdAt: todayIso }),
    createStory({ id: "yesterday", createdAt: "2020-01-01T00:00:00.000Z" }),
  ]);
  const result = Storage.getTodayStories();
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "today");
});

test("sortStoriesForDisplay는 latest 모드에서 createdAt 내림차순으로 정렬하고 undated는 비운다", () => {
  const stories = [
    createStory({ id: "a", createdAt: "2024-01-01T00:00:00.000Z" }),
    createStory({ id: "b", createdAt: "2024-06-01T00:00:00.000Z" }),
  ];
  const { dated, undated } = Storage.sortStoriesForDisplay(stories, "latest");
  assert.deepEqual(dated.map((s) => s.id), ["b", "a"]);
  assert.equal(undated.length, 0);
});

test("sortStoriesForDisplay는 timetravel 모드에서 연도·월 오름차순으로 정렬하고 시점 모르는 건 따로 뺀다", () => {
  const stories = [
    createStory({ id: "recent", dateMode: "past", referenceDate: "2020-05" }),
    createStory({ id: "old", dateMode: "past", referenceDate: "1998-03" }),
    createStory({ id: "unknown", dateMode: "unknown", referenceDate: null }),
  ];
  const { dated, undated } = Storage.sortStoriesForDisplay(stories, "timetravel");
  assert.deepEqual(dated.map((s) => s.id), ["old", "recent"]);
  assert.deepEqual(undated.map((s) => s.id), ["unknown"]);
});

test("sortStoriesForDisplay는 timetravel-reverse 모드에서 연도·월 내림차순(지금→과거)으로 정렬한다", () => {
  const stories = [
    createStory({ id: "old", dateMode: "past", referenceDate: "1998-03" }),
    createStory({ id: "recent", dateMode: "past", referenceDate: "2020-05" }),
  ];
  const { dated } = Storage.sortStoriesForDisplay(stories, "timetravel-reverse");
  assert.deepEqual(dated.map((s) => s.id), ["recent", "old"]);
});

test("incrementViewCount는 조회수를 1 늘린다", () => {
  Storage._setCache([createStory({ id: "s1", viewCount: 2 })]);
  const updated = Storage.incrementViewCount("s1");
  assert.equal(updated.viewCount, 3);
});

test("hideStory는 신고 카운트를 건드리지 않고 바로 status를 HIDDEN으로 바꾼다", async () => {
  Storage._setCache([createStory({ id: "s1", status: "ACTIVE", reportCount: 0 })]);
  const hidden = await Storage.hideStory("s1");
  assert.equal(hidden.status, "HIDDEN");
  assert.equal(hidden.reportCount, 0);
});

test("deleteStory는 캐시에서 해당 스토리를 제거한다", async () => {
  Storage._setCache([createStory({ id: "s1" }), createStory({ id: "s2" })]);
  await Storage.deleteStory("s1");
  const remaining = Storage.getAllStories();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, "s2");
});

test("restoreStory는 status를 ACTIVE로, reportCount를 0으로 되돌린다", async () => {
  Storage._setCache([createStory({ id: "s1", status: "HIDDEN", reportCount: 5 })]);
  const restored = await Storage.restoreStory("s1");
  assert.equal(restored.status, "ACTIVE");
  assert.equal(restored.reportCount, 0);
});

test("containsBannedWord는 캐시된 금칙어가 본문에 포함되면 true를 반환한다", () => {
  Storage._setBannedWords([{ id: "bw-1", word: "나쁜말" }]);
  assert.equal(Storage.containsBannedWord("이건 나쁜말이 섞인 문장"), true);
  assert.equal(Storage.containsBannedWord("이건 깨끗한 문장"), false);
});

test("addBannedWord/removeBannedWord는 캐시에 즉시 반영된다", async () => {
  await Storage.addBannedWord("금지어");
  assert.equal(Storage.getBannedWords().length, 1);
  const id = Storage.getBannedWords()[0].id;
  await Storage.removeBannedWord(id);
  assert.equal(Storage.getBannedWords().length, 0);
});
