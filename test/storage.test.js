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

function createFakeClient(storyAuthorRecords = []) {
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
      StoryAuthor: {
        create: async () => ({}),
        list: async () => ({ data: storyAuthorRecords, nextToken: null }),
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
  Storage.clearMyStoryIds();
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

test("getStoriesAtSamePlace는 같은 placeId를 가진 다른 스토리만 반환하고 자기 자신은 뺀다", () => {
  const mine = createStory({ id: "mine", placeId: "kakao-1", lat: 37.5, lng: 127.0 });
  const neighbor = createStory({ id: "neighbor", placeId: "kakao-1", lat: 37.5, lng: 127.0 });
  const elsewhere = createStory({ id: "elsewhere", placeId: "kakao-2", lat: 33.4, lng: 126.5 });
  Storage._setCache([mine, neighbor, elsewhere]);

  const result = Storage.getStoriesAtSamePlace(mine);
  assert.deepEqual(result.map((s) => s.id), ["neighbor"]);
});

test("getStoriesAtSamePlace는 placeId가 없으면 좌표(소수점 4자리)로 같은 장소를 판단한다", () => {
  const mine = createStory({ id: "mine", placeId: null, lat: 37.12341, lng: 127.6789 });
  const samePin = createStory({ id: "same-pin", placeId: null, lat: 37.12344, lng: 127.6789 });
  const otherPin = createStory({ id: "other-pin", placeId: null, lat: 37.9999, lng: 127.6789 });
  Storage._setCache([mine, samePin, otherPin]);

  const result = Storage.getStoriesAtSamePlace(mine);
  assert.deepEqual(result.map((s) => s.id), ["same-pin"]);
});

test("getStoriesAtSamePlace는 HIDDEN/DELETED 상태의 이웃 스토리를 제외한다", () => {
  const mine = createStory({ id: "mine", placeId: "kakao-1" });
  const hiddenNeighbor = createStory({ id: "hidden-neighbor", placeId: "kakao-1", status: "HIDDEN" });
  Storage._setCache([mine, hiddenNeighbor]);

  assert.deepEqual(Storage.getStoriesAtSamePlace(mine), []);
});

test("getNearbySameYearStories는 반경 안 + 같은 해인 다른 장소의 기억만 반환한다", () => {
  // 종로(mine)에서 대략 780m 떨어진 지점(0.007도 ≈ 780m) — 1000m 반경 안
  const mine = createStory({ id: "mine", placeId: "p-jongno", lat: 37.5700, lng: 126.9800, dateMode: "now", createdAt: "2001-05-01T00:00:00.000Z" });
  const nearbySameYear = createStory({ id: "nearby-same-year", placeId: "p-sinchon", lat: 37.5770, lng: 126.9800, dateMode: "now", createdAt: "2001-08-01T00:00:00.000Z" });
  const nearbyDifferentYear = createStory({ id: "nearby-diff-year", placeId: "p-sinchon2", lat: 37.5770, lng: 126.9800, dateMode: "now", createdAt: "2010-01-01T00:00:00.000Z" });
  const farSameYear = createStory({ id: "far-same-year", placeId: "p-busan", lat: 35.1, lng: 129.0, dateMode: "now", createdAt: "2001-03-01T00:00:00.000Z" });
  Storage._setCache([mine, nearbySameYear, nearbyDifferentYear, farSameYear]);

  const result = Storage.getNearbySameYearStories(mine, 1000);
  assert.deepEqual(result.map((s) => s.id), ["nearby-same-year"]);
});

test("getNearbySameYearStories는 연도를 모르는 기억(dateMode unknown)이면 빈 배열을 반환한다", () => {
  const mine = createStory({ id: "mine", dateMode: "unknown", referenceDate: null, lat: 37.57, lng: 126.98 });
  const neighbor = createStory({ id: "neighbor", dateMode: "now", createdAt: "2001-05-01T00:00:00.000Z", lat: 37.57, lng: 126.98 });
  Storage._setCache([mine, neighbor]);

  assert.deepEqual(Storage.getNearbySameYearStories(mine, 1000), []);
});

test("getStoriesNear는 반경 안의 기억을 연도와 무관하게 모두 반환한다", () => {
  // 종로 기준 대략 780m 떨어진 지점(0.007도 ≈ 780m) — 1000m 반경 안
  const near = createStory({ id: "near", lat: 37.5770, lng: 126.9800, dateMode: "now", createdAt: "2010-01-01T00:00:00.000Z" });
  const far = createStory({ id: "far", lat: 35.1, lng: 129.0, dateMode: "now", createdAt: "2001-03-01T00:00:00.000Z" });
  Storage._setCache([near, far]);

  const result = Storage.getStoriesNear(37.57, 126.98, 1000);
  assert.deepEqual(result.map((s) => s.id), ["near"]);
});

test("isNear는 반경 안이면 true, 밖이면 false를 반환한다", () => {
  assert.equal(Storage.isNear(37.57, 126.98, 37.5770, 126.9800, 1000), true);
  assert.equal(Storage.isNear(37.57, 126.98, 35.1, 129.0, 1000), false);
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
  assert.equal(Storage.abbreviateAddress("전남광주통합특별시 동구 1"), "전남광주 동구 1");
});

test("abbreviateAddress는 매칭되는 시/도가 없으면 원본을 그대로 반환한다", () => {
  assert.equal(Storage.abbreviateAddress("서울 종로구 1길 1"), "서울 종로구 1길 1");
  assert.equal(Storage.abbreviateAddress(null), null);
});

test("getDongLevelAddress는 시/도를 축약하고 지번(번지)을 잘라 동/가 레벨까지만 남긴다", () => {
  assert.equal(Storage.getDongLevelAddress("서울특별시 중구 충무로4가 23-1"), "서울 중구 충무로4가");
  assert.equal(Storage.getDongLevelAddress("경기도 성남시 분당구 정자동 178-1"), "경기 성남시 분당구 정자동");
});

test("getDongLevelAddress는 도로명 주소면 로/길로 끝나는 도로명 토큰까지만 남기고 건물번호를 뗀다", () => {
  assert.equal(Storage.getDongLevelAddress("서울 강남구 테헤란로 152"), "서울 강남구 테헤란로");
  assert.equal(Storage.getDongLevelAddress("서울 마포구 양화로6길 10"), "서울 마포구 양화로6길");
  // 건물번호가 "152,154"처럼 순수 숫자 패턴이 아니어도(예전 구현은 이런
  // 경우 못 잘라냈다) 도로명 토큰 뒤는 전부 잘린다.
  assert.equal(Storage.getDongLevelAddress("서울 강남구 테헤란로 152,154"), "서울 강남구 테헤란로");
});

test("getDongLevelAddress는 산지번(토큰이 둘로 쪼개진 경우)도 둘 다 잘라낸다", () => {
  assert.equal(Storage.getDongLevelAddress("서울 종로구 부암동 산 12-3"), "서울 종로구 부암동");
});

test("getDongLevelAddress는 번지 없이 동/가까지만 있으면 그대로 반환하고, null이면 null을 반환한다", () => {
  assert.equal(Storage.getDongLevelAddress("서울 중구 충무로4가"), "서울 중구 충무로4가");
  assert.equal(Storage.getDongLevelAddress(null), null);
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

test("getStoryMonth는 referenceDate의 월 자리가 계절 코드면 null을 반환한다", () => {
  const story = createStory({ dateMode: "past", referenceDate: "1998-SU" });
  assert.equal(Storage.getStoryMonth(story), null);
});

test("getStorySeasonLabel/getStorySeasonCode는 계절 코드가 있을 때만 라벨/코드를 반환한다", () => {
  const summer = createStory({ dateMode: "past", referenceDate: "1998-SU" });
  const withMonth = createStory({ dateMode: "past", referenceDate: "1998-03" });
  assert.equal(Storage.getStorySeasonCode(summer), "SU");
  assert.equal(Storage.getStorySeasonLabel(summer), "여름");
  assert.equal(Storage.getStorySeasonCode(withMonth), null);
  assert.equal(Storage.getStorySeasonLabel(withMonth), null);
});

test("getStoryDateLabel은 정확한 월이 있으면 'N월', 계절만 있으면 계절 이름을 반환한다", () => {
  const withMonth = createStory({ dateMode: "past", referenceDate: "1998-03" });
  const withSeason = createStory({ dateMode: "past", referenceDate: "1998-WI" });
  const withNeither = createStory({ dateMode: "unknown", referenceDate: null });
  assert.equal(Storage.getStoryDateLabel(withMonth), "3월");
  assert.equal(Storage.getStoryDateLabel(withSeason), "겨울");
  assert.equal(Storage.getStoryDateLabel(withNeither), null);
});

test("sortStoriesForDisplay(timetravel)는 계절을 그 계절의 마지막 달 바로 뒤에 끼워 넣는다", () => {
  const mar = createStory({ id: "mar", dateMode: "past", referenceDate: "2000-03" });
  const spring = createStory({ id: "spring", dateMode: "past", referenceDate: "2000-SP" });
  const jun = createStory({ id: "jun", dateMode: "past", referenceDate: "2000-06" });
  const { dated } = Storage.sortStoriesForDisplay([jun, spring, mar], "timetravel");
  assert.deepEqual(dated.map((s) => s.id), ["mar", "spring", "jun"]);
});

test("getStoryMonthSortValue는 월/계절이 둘 다 없이 연도만 있으면 12.6(그 해 맨 마지막)을 반환한다", () => {
  const yearOnly = createStory({ dateMode: "past", referenceDate: "2000" });
  assert.equal(Storage.getStoryMonthSortValue(yearOnly), 12.6);
});

test("sortStoriesForDisplay(timetravel)는 월/계절 없이 연도만 있는 기억을 그 해의 맨 마지막(12월 뒤)에 둔다", () => {
  const dec = createStory({ id: "dec", dateMode: "past", referenceDate: "2000-12" });
  const yearOnly = createStory({ id: "year-only", dateMode: "past", referenceDate: "2000" });
  const nextYear = createStory({ id: "next-year", dateMode: "past", referenceDate: "2001-01" });
  const { dated } = Storage.sortStoriesForDisplay([nextYear, yearOnly, dec], "timetravel");
  assert.deepEqual(dated.map((s) => s.id), ["dec", "year-only", "next-year"]);
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

test("toggleReaction은 자기 글(isMyStory)에는 반응 수를 늘리지 않는다", async () => {
  Storage._setClient(createFakeClient([{ storyId: "s1" }]));
  Storage._setCache([createStory({ id: "s1", reactionCount: 0 })]);
  await Storage.refreshMyStoryIds();
  const result = Storage.toggleReaction("s1");
  assert.equal(result.reactionCount, 0);
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

test("_missionTypeForDay는 요일 숫자를 4종 미션으로 매핑한다(월목=질문,화금=시간,수토=장소,일=이번 주)", () => {
  assert.equal(Storage._missionTypeForDay(1), "question");
  assert.equal(Storage._missionTypeForDay(4), "question");
  assert.equal(Storage._missionTypeForDay(2), "year");
  assert.equal(Storage._missionTypeForDay(5), "year");
  assert.equal(Storage._missionTypeForDay(3), "place");
  assert.equal(Storage._missionTypeForDay(6), "place");
  assert.equal(Storage._missionTypeForDay(0), "week");
});

test("getTodayMissionYear는 실제 기억이 있는 연도 중에서만, 매번 같은 값을 반환한다", () => {
  Storage._setCache([
    createStory({ id: "a", dateMode: "past", referenceDate: "1998-03" }),
    createStory({ id: "b", dateMode: "past", referenceDate: "2010-07" }),
    createStory({ id: "c", dateMode: "unknown", referenceDate: null }),
  ]);
  const first = Storage.getTodayMissionYear();
  const second = Storage.getTodayMissionYear();
  assert.ok([1998, 2010].includes(first));
  assert.equal(first, second);
});

test("getTodayMissionYear는 연도 정보가 있는 기억이 없으면 null을 반환한다", () => {
  Storage._setCache([createStory({ id: "a", dateMode: "unknown", referenceDate: null })]);
  assert.equal(Storage.getTodayMissionYear(), null);
});

test("getTodayMissionPlace는 기억이 3개 이상인 스팟이 있으면 그 안에서만 고른다", () => {
  Storage._setCache([
    createStory({ id: "a1", placeId: "p1", lat: 37.1, lng: 127.1 }),
    createStory({ id: "a2", placeId: "p1", lat: 37.1, lng: 127.1 }),
    createStory({ id: "a3", placeId: "p1", lat: 37.1, lng: 127.1 }),
    createStory({ id: "b1", placeId: "p2", lat: 37.2, lng: 127.2 }),
  ]);
  const place = Storage.getTodayMissionPlace();
  assert.equal(place.placeId, "p1");
  assert.equal(place.stories.length, 3);
});

test("getTodayMissionPlace는 3개 이상인 스팟이 없으면 아무 스팟이나 고른다", () => {
  Storage._setCache([
    createStory({ id: "a1", placeId: "p1", lat: 37.1, lng: 127.1 }),
    createStory({ id: "b1", placeId: "p2", lat: 37.2, lng: 127.2 }),
  ]);
  const place = Storage.getTodayMissionPlace();
  assert.ok(["p1", "p2"].includes(place.placeId));
});

test("getTodayMissionPlace는 등록된 기억이 없으면 null을 반환한다", () => {
  Storage._setCache([]);
  assert.equal(Storage.getTodayMissionPlace(), null);
});

test("getWeekOldestStory는 이번 주(월요일 0시~) 등록된 기억 중 연도가 가장 오래된 것을 반환한다", () => {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
  weekStart.setHours(0, 0, 0, 0);
  const thisWeekIso = new Date(weekStart.getTime() + 60 * 60 * 1000).toISOString();
  Storage._setCache([
    createStory({ id: "old", dateMode: "past", referenceDate: "1974-01", createdAt: thisWeekIso }),
    createStory({ id: "recent", dateMode: "past", referenceDate: "2020-01", createdAt: thisWeekIso }),
    createStory({ id: "lastWeek", dateMode: "past", referenceDate: "1900-01", createdAt: "2000-01-01T00:00:00.000Z" }),
  ]);
  const result = Storage.getWeekOldestStory();
  assert.equal(result.id, "old");
});

test("getWeekOldestStory는 이번 주 등록된 기억이 없으면 null을 반환한다", () => {
  Storage._setCache([
    createStory({ id: "old", dateMode: "past", referenceDate: "1974-01", createdAt: "2000-01-01T00:00:00.000Z" }),
  ]);
  assert.equal(Storage.getWeekOldestStory(), null);
});

test("getThrowbackMemory는 이번 달과 월이 같고 연도가 올해보다 이전인 기억만 후보로 삼는다", () => {
  const now = new Date();
  const thisMonth = String(now.getMonth() + 1).padStart(2, "0");
  const thisYear = now.getFullYear();
  const matching = createStory({ id: "match", dateMode: "past", referenceDate: `${thisYear - 3}-${thisMonth}` });
  const wrongMonth = createStory({
    id: "wrong-month", dateMode: "past",
    referenceDate: `${thisYear - 3}-${String(((now.getMonth() + 6) % 12) + 1).padStart(2, "0")}`,
  });
  const thisYearSameMonth = createStory({ id: "this-year", dateMode: "past", referenceDate: `${thisYear}-${thisMonth}` });
  const result = Storage.getThrowbackMemory([matching, wrongMonth, thisYearSameMonth]);
  assert.equal(result.id, "match");
});

test("getThrowbackMemory는 계절이 이번 달을 포함하면 후보로 삼는다(겨울=12,1,2)", () => {
  const now = new Date();
  const thisMonth = now.getMonth() + 1;
  const winterMonths = [12, 1, 2];
  const thisYear = now.getFullYear();
  const winterStory = createStory({ id: "winter", dateMode: "past", referenceDate: `${thisYear - 5}-WI` });
  const result = Storage.getThrowbackMemory([winterStory]);
  if (winterMonths.includes(thisMonth)) {
    assert.equal(result.id, "winter");
  } else {
    assert.equal(result, null);
  }
});

test("getThrowbackMemory는 후보가 없으면 null을 반환한다", () => {
  assert.equal(Storage.getThrowbackMemory([]), null);
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

test("markVisitAndGetUnseenThreshold는 첫 방문(저장된 값 없음)이면 null을 반환하고, isUnseen은 항상 false다", () => {
  const prev = Storage.markVisitAndGetUnseenThreshold();
  assert.equal(prev, null);
  assert.equal(Storage.isUnseen({ id: "s1", createdAt: "2030-01-01T00:00:00.000Z" }), false);
});

test("markVisitAndGetUnseenThreshold는 두 번째 호출부터 직전 방문 시각(숫자)을 반환한다", () => {
  const first = Storage.markVisitAndGetUnseenThreshold();
  assert.equal(first, null);
  const second = Storage.markVisitAndGetUnseenThreshold();
  assert.equal(typeof second, "number");
  assert.ok(second <= Date.now());
});

test("isUnseen은 직전 방문 시각 이후에 생성된 기억만 true를 반환한다", () => {
  Storage.markVisitAndGetUnseenThreshold();
  Storage.markVisitAndGetUnseenThreshold();
  const threshold = Date.now();
  assert.equal(Storage.isUnseen({ id: "s1", createdAt: new Date(threshold - 5000).toISOString() }), false);
  assert.equal(Storage.isUnseen({ id: "s2", createdAt: new Date(threshold + 5000).toISOString() }), true);
});

test("markStoriesRead로 읽음 처리한 기억은, 방문 시각 기준으로는 안 읽음이어도 isUnseen이 false다", () => {
  Storage.markVisitAndGetUnseenThreshold();
  Storage.markVisitAndGetUnseenThreshold();
  const story = { id: "s3", createdAt: new Date(Date.now() + 5000).toISOString() };
  assert.equal(Storage.isUnseen(story), true);
  Storage.markStoriesRead([story.id]);
  assert.equal(Storage.isUnseen(story), false);
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

test("sortStoriesForDisplay는 같은 연도·월끼리는 등록 시각으로 한 번 더 정렬한다(timetravel-reverse=최근 등록이 위)", () => {
  const stories = [
    createStory({ id: "olderPost", dateMode: "past", referenceDate: "2026-08", createdAt: "2026-08-01T00:00:00.000Z" }),
    createStory({ id: "newerPost", dateMode: "past", referenceDate: "2026-08", createdAt: "2026-08-15T00:00:00.000Z" }),
  ];
  const reverse = Storage.sortStoriesForDisplay(stories, "timetravel-reverse").dated;
  assert.deepEqual(reverse.map((s) => s.id), ["newerPost", "olderPost"]);

  const forward = Storage.sortStoriesForDisplay(stories, "timetravel").dated;
  assert.deepEqual(forward.map((s) => s.id), ["olderPost", "newerPost"]);
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

test("isMyStory는 refreshMyStoryIds 전에는 항상 false다(로딩 전/비로그인)", () => {
  assert.equal(Storage.isMyStory("s1"), false);
});

test("refreshMyStoryIds는 계정 연결(StoryAuthor)된 storyId만 isMyStory를 true로 만든다 — 브라우저 기기ID는 안 본다", async () => {
  Storage._setClient(createFakeClient([{ storyId: "s1" }, { storyId: "s2" }]));
  await Storage.refreshMyStoryIds();
  assert.equal(Storage.isMyStory("s1"), true);
  assert.equal(Storage.isMyStory("s2"), true);
  assert.equal(Storage.isMyStory("s3"), false);
});

test("clearMyStoryIds는 캐시를 비워 로그아웃 후 isMyStory가 전부 false가 되게 한다", async () => {
  Storage._setClient(createFakeClient([{ storyId: "s1" }]));
  await Storage.refreshMyStoryIds();
  assert.equal(Storage.isMyStory("s1"), true);
  Storage.clearMyStoryIds();
  assert.equal(Storage.isMyStory("s1"), false);
});

test("addMyStoryId는 방금 쓴 글을 재조회 없이 바로 isMyStory에 반영한다", async () => {
  Storage._setClient(createFakeClient([]));
  await Storage.refreshMyStoryIds();
  assert.equal(Storage.isMyStory("new-story"), false);
  Storage.addMyStoryId("new-story");
  assert.equal(Storage.isMyStory("new-story"), true);
});

test("addMyStoryId는 refreshMyStoryIds가 아직 한 번도 안 불린 상태(캐시 null)면 조용히 무시한다", () => {
  Storage.addMyStoryId("orphan-story");
  assert.equal(Storage.isMyStory("orphan-story"), false);
});

test("extractYoutubeVideoId는 watch/youtu.be/shorts/embed 형태에서 11자리 video ID를 뽑아낸다", () => {
  assert.equal(Storage.extractYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(Storage.extractYoutubeVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(Storage.extractYoutubeVideoId("https://youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(Storage.extractYoutubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(Storage.extractYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s"), "dQw4w9WgXcQ");
});

test("extractYoutubeVideoId는 못 알아보는 형태/빈 값이면 null을 반환한다", () => {
  assert.equal(Storage.extractYoutubeVideoId(""), null);
  assert.equal(Storage.extractYoutubeVideoId(null), null);
  assert.equal(Storage.extractYoutubeVideoId("https://example.com/song"), null);
});

test("parseYoutubeMusicTitle은 \"아티스트 - 곡명\" 형태에서 둘을 분리하고 괄호/비괄호 노이즈를 제거한다", () => {
  assert.deepEqual(
    Storage.parseYoutubeMusicTitle("Brown Eyes - 벌써 일년 (Already One Year) Official MV"),
    { artist: "Brown Eyes", title: "벌써 일년 (Already One Year)" }
  );
  assert.deepEqual(
    Storage.parseYoutubeMusicTitle("아이유(IU) - 밤편지 [Official Music Video]"),
    { artist: "아이유(IU)", title: "밤편지" }
  );
  assert.deepEqual(Storage.parseYoutubeMusicTitle("BTS - Dynamite"), { artist: "BTS", title: "Dynamite" });
});

test("parseYoutubeMusicTitle은 구분자가 없으면 아티스트 없이 정리된 제목만 반환한다", () => {
  assert.deepEqual(Storage.parseYoutubeMusicTitle("좋은 노래 모음 (Lyrics)"), {
    artist: null,
    title: "좋은 노래 모음",
  });
});

test("parseYoutubeMusicTitle은 빈 값이면 둘 다 null을 반환한다", () => {
  assert.deepEqual(Storage.parseYoutubeMusicTitle(""), { artist: null, title: null });
  assert.deepEqual(Storage.parseYoutubeMusicTitle(null), { artist: null, title: null });
});

test("parseYoutubeMusicTitle은 제목에 구분자가 없으면 채널명(Topic/VEVO 꼬리표 제거)을 아티스트로 쓴다", () => {
  assert.deepEqual(Storage.parseYoutubeMusicTitle("Dynamite", "BTS - Topic"), {
    artist: "BTS",
    title: "Dynamite",
  });
  assert.deepEqual(Storage.parseYoutubeMusicTitle("Way Back Home", "SHAUN VEVO"), {
    artist: "SHAUN",
    title: "Way Back Home",
  });
  assert.deepEqual(Storage.parseYoutubeMusicTitle("좋은 노래 모음 (Lyrics)", null), {
    artist: null,
    title: "좋은 노래 모음",
  });
});

test("parseYoutubeMusicTitle은 「」/『』로 곡명을 감싼 제목에서 앞부분을 아티스트로 분리한다", () => {
  assert.deepEqual(Storage.parseYoutubeMusicTitle("아이유 「밤편지」 M/V"), {
    artist: "아이유",
    title: "밤편지",
  });
});

test("parseYoutubeMusicTitle은 \":\"/\"|\" 구분자도 인식한다", () => {
  assert.deepEqual(Storage.parseYoutubeMusicTitle("아이유 : 밤편지"), { artist: "아이유", title: "밤편지" });
  assert.deepEqual(Storage.parseYoutubeMusicTitle("아이유 | 밤편지"), { artist: "아이유", title: "밤편지" });
});

test("parseYoutubeMusicTitle은 채널명이 곡명 자리와 일치하면 \"곡명 - 아티스트\" 순서를 바로잡는다", () => {
  assert.deepEqual(Storage.parseYoutubeMusicTitle("밤편지 - 아이유", "아이유"), {
    artist: "아이유",
    title: "밤편지",
  });
});

test("normalizeSongKey는 대소문자/공백을 무시하고 같은 곡이면 같은 키를 만든다", () => {
  assert.equal(
    Storage.normalizeSongKey("Brown Eyes", "벌써 일년"),
    Storage.normalizeSongKey("brown eyes", " 벌써  일년 ")
  );
  assert.notEqual(Storage.normalizeSongKey("Brown Eyes", "벌써 일년"), Storage.normalizeSongKey("IU", "밤편지"));
});

test("getStoriesForSong은 같은 아티스트·곡명(정규화 기준)을 가진 공개 스토리만 반환한다", () => {
  Storage._setCache([
    createStory({ id: "a", musicArtist: "Brown Eyes", musicTitle: "벌써 일년" }),
    createStory({ id: "b", musicArtist: "brown eyes", musicTitle: " 벌써 일년 " }),
    createStory({ id: "c", musicArtist: "IU", musicTitle: "밤편지" }),
    createStory({ id: "d", musicArtist: "Brown Eyes", musicTitle: "벌써 일년", status: "HIDDEN" }),
  ]);
  const result = Storage.getStoriesForSong("Brown Eyes", "벌써 일년");
  assert.deepEqual(result.map((s) => s.id).sort(), ["a", "b"]);
});

test("getStoriesForSong은 곡명이 없으면 빈 배열을 반환한다", () => {
  assert.deepEqual(Storage.getStoriesForSong("Artist", ""), []);
  assert.deepEqual(Storage.getStoriesForSong("Artist", null), []);
});

test("getTopSongs는 같은 곡(아티스트+곡명 정규화 기준)을 하나로 묶어 기억 개수 내림차순으로 반환한다", () => {
  Storage._setCache([
    createStory({ id: "s1", musicArtist: "아이유", musicTitle: "밤편지" }),
    createStory({ id: "s2", musicArtist: " 아이유 ", musicTitle: "밤편지" }),
    createStory({ id: "s3", musicArtist: "성시경", musicTitle: "두 사람" }),
    createStory({ id: "s4", musicArtist: null, musicTitle: null }),
  ]);
  assert.deepEqual(Storage.getTopSongs(), [
    { artist: "아이유", title: "밤편지", count: 2 },
    { artist: "성시경", title: "두 사람", count: 1 },
  ]);
});

test("getTopSongs는 limit만큼만 반환하고, getAllSongsWithCounts는 제한 없이 전체를 반환한다", () => {
  Storage._setCache([
    createStory({ id: "s1", musicArtist: "A", musicTitle: "1" }),
    createStory({ id: "s2", musicArtist: "B", musicTitle: "2" }),
    createStory({ id: "s3", musicArtist: "C", musicTitle: "3" }),
  ]);
  assert.equal(Storage.getTopSongs(2).length, 2);
  assert.equal(Storage.getAllSongsWithCounts().length, 3);
});

test("suggestSongMatch는 아티스트 표기가 갈려도 곡명이 겹치면 기존 곡을 제안한다", () => {
  Storage._setCache([
    createStory({ id: "s1", musicArtist: "성시경", musicTitle: "거리에서" }),
  ]);
  assert.deepEqual(
    Storage.suggestSongMatch("Sung si kyoun", "성시경(거리에서)"),
    { artist: "성시경", title: "거리에서" }
  );
});

test("suggestSongMatch는 이미 정확히 같은 곡이면(정규화 키 일치) 제안하지 않는다", () => {
  Storage._setCache([createStory({ id: "s1", musicArtist: "성시경", musicTitle: "거리에서" })]);
  assert.equal(Storage.suggestSongMatch("성시경", "거리에서"), null);
  assert.equal(Storage.suggestSongMatch(" 성시경 ", " 거리에서 "), null);
});

test("suggestSongMatch는 곡명이 2자 미만이거나 겹치는 게 없으면 null을 반환한다", () => {
  Storage._setCache([createStory({ id: "s1", musicArtist: "성시경", musicTitle: "거리에서" })]);
  assert.equal(Storage.suggestSongMatch("누군가", "봄"), null);
  assert.equal(Storage.suggestSongMatch("누군가", "전혀다른곡"), null);
  assert.equal(Storage.suggestSongMatch(null, ""), null);
});

test("groupStoriesByPlace는 인자로 받은 스토리 배열만 장소 단위로 묶는다(getVisibleStories 전체가 아님)", () => {
  const included = createStory({ id: "included", placeId: "p1", lat: 37.1, lng: 127.1 });
  const excluded = createStory({ id: "excluded", placeId: "p1", lat: 37.1, lng: 127.1 });
  Storage._setCache([included, excluded]);

  const groups = Storage.groupStoriesByPlace([included]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].stories.map((s) => s.id), ["included"]);
});

test("getGroupedByPlace는 groupStoriesByPlace(getVisibleStories())와 동일한 결과를 준다", () => {
  Storage._setCache([
    createStory({ id: "a", placeId: "p1", lat: 37.1, lng: 127.1 }),
    createStory({ id: "b", placeId: "p2", lat: 37.2, lng: 127.2 }),
  ]);
  assert.deepEqual(Storage.getGroupedByPlace(), Storage.groupStoriesByPlace(Storage.getVisibleStories()));
});

test("getCityLabel은 광역시/특별시/세종이면 그 축약형 자체를 도시명으로 반환한다", () => {
  assert.equal(Storage.getCityLabel("서울특별시 마포구 잔다리로 24"), "서울");
  assert.equal(Storage.getCityLabel("부산광역시 해운대구 1"), "부산");
  assert.equal(Storage.getCityLabel("세종특별자치시 1"), "세종");
});

test("getCityLabel은 도(道) 단위 주소면 다음 토큰(시/군)에서 접미사를 뗀 걸 도시명으로 반환한다", () => {
  assert.equal(Storage.getCityLabel("경상북도 경주시 1"), "경주");
  assert.equal(Storage.getCityLabel("경기도 성남시 분당구 판교역로 1"), "성남");
  assert.equal(Storage.getCityLabel("강원도 춘천시 1"), "춘천");
  assert.equal(Storage.getCityLabel("제주특별자치도 서귀포시 1"), "서귀포");
});

test("getCityLabel은 매칭되는 시/도가 없거나 주소가 없으면 null을 반환한다", () => {
  assert.equal(Storage.getCityLabel("어딘가 1길 1"), null);
  assert.equal(Storage.getCityLabel(null), null);
  assert.equal(Storage.getCityLabel(""), null);
});
