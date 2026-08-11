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

global.localStorage = createLocalStorageMock();
global.CONFIG = {
  REPORT_HIDE_THRESHOLD: 5,
  RECENT_STORY_POOL_SIZE: 100,
};

const { Storage } = require("../js/storage.js");

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

test("saveStory로 저장한 스토리는 getAllStories로 그대로 조회된다", () => {
  const story = createStory({ id: "s1" });
  Storage.saveStory(story);
  const all = Storage.getAllStories();
  assert.equal(all.length, 1);
  assert.equal(all[0].id, "s1");
});

test("getVisibleStories는 status가 HIDDEN인 스토리를 제외한다", () => {
  Storage.saveAll([createStory({ id: "visible", status: "ACTIVE" }), createStory({ id: "hidden", status: "HIDDEN" })]);
  const visible = Storage.getVisibleStories();
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, "visible");
});

test("reportStory는 신고 누적이 REPORT_HIDE_THRESHOLD에 도달하면 status를 HIDDEN으로 바꾼다", () => {
  Storage.saveAll([createStory({ id: "s1", reportCount: 4, status: "ACTIVE" })]);
  const updated = Storage.reportStory("s1");
  assert.equal(updated.reportCount, 5);
  assert.equal(updated.status, "HIDDEN");
});

test("reportStory는 임계치 미만이면 status를 바꾸지 않는다", () => {
  Storage.saveAll([createStory({ id: "s1", reportCount: 0, status: "ACTIVE" })]);
  const updated = Storage.reportStory("s1");
  assert.equal(updated.reportCount, 1);
  assert.equal(updated.status, "ACTIVE");
});

test("toggleReaction은 처음 호출 시 반응 수를 늘리고 hasReacted를 true로 만든다", () => {
  Storage.saveAll([createStory({ id: "s1", reactionCount: 0 })]);
  const updated = Storage.toggleReaction("s1");
  assert.equal(updated.reactionCount, 1);
  assert.equal(Storage.hasReacted("s1"), true);
});

test("toggleReaction은 두 번째 호출(같은 사람이 다시 누름) 시 반응을 취소한다", () => {
  Storage.saveAll([createStory({ id: "s1", reactionCount: 0 })]);
  Storage.toggleReaction("s1");
  const reverted = Storage.toggleReaction("s1");
  assert.equal(reverted.reactionCount, 0);
  assert.equal(Storage.hasReacted("s1"), false);
});

test("getTopHashtags는 사용 빈도 내림차순으로 정렬하고 limit만큼만 반환한다", () => {
  Storage.saveAll([
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
  Storage.saveAll([
    createStory({ id: "s1", dateMode: "past", referenceDate: "1998-03" }),
    createStory({ id: "s2", dateMode: "past", referenceDate: "2010-07" }),
  ]);
  const range = Storage.getYearRange();
  assert.equal(range.min, 1998);
  assert.equal(range.max, new Date().getFullYear());
});
