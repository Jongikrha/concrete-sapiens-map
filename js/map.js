// ============================================================
// 지도 / 마커 (Memory Light)
// ============================================================

let map;
let clusterer;
let placesService;
let geocoderService;
let markers = []; // { marker, group }
let highlightedMarker = null;
let searchPinMarker = null;
let searchPinInfo = null; // openSearchAreaModal에 그대로 넘길 { lat, lng, placeName, placeId, address }

// 장소 키(group.key) → { tier, selected, isToday, image } — makeDotImage는
// 마커마다 반짝임 애니메이션 위상을 매번 새 난수로 만들어서 캐싱 없이는
// renderMarkers()가 호출될 때마다(검색으로 지도 이동, 필터 전환 등) 화면에
// 있는 모든 마커의 SVG 이미지를 처음부터 다시 생성해야 했다 — 마커가
// 수백 개면 그때마다 눈에 띄게 느려지는 원인이었다(2026-08-19). 이 장소의
// tier/선택/오늘 여부가 실제로 안 바뀌었으면 기존 이미지를 그대로 재사용한다.
const dotImageCache = new Map();

function getDotImage(key, tier, selected, isToday) {
  const cached = dotImageCache.get(key);
  if (cached && cached.tier === tier && cached.selected === selected && cached.isToday === isToday) {
    return cached.image;
  }
  const image = makeDotImage(tier, selected, isToday);
  dotImageCache.set(key, { tier, selected, isToday, image });
  return image;
}

// ------------------------------------------------------------
// Memory Light 이미지 — 기억 수에 따라 크기 차등(makeDotImage 아래 참고)
// ------------------------------------------------------------
function tierForCount(n) {
  if (n >= 50) return 4;
  if (n >= 10) return 3;
  if (n >= 2) return 2;
  return 1;
}

function groupHasTodayStory(group) {
  return group.stories.some((s) => Storage.isToday(s.createdAt));
}

// "Memory Light" 컬러 — UI 전반의 --cs-orange(#FF5A36)와는 별개로,
// 지도 위 점 전용으로 쓰는 더 차분한 톤(2026-08-13, 디자인 가이드
// POINT DESIGN 기준). 중심부/2차 잔광은 MEMORY_CORE, 1차 광원(중간
// 광훈)은 MEMORY_GLOW.
const MEMORY_CORE = "#C9573D";
const MEMORY_GLOW = "#E76D4F";
// 별 도형 전용 — 광훈(MEMORY_CORE/GLOW)보다 한 톤 짙게 잡아서 작은
// tier에서도 색이 옅어 보이지 않게 한다.
const STAR_FILL = "#AB4A34";

// 중심부를 원이 아니라 4각 별(반짝임) 모양으로 그리기 위한 좌표 계산.
// outerR(뾰족한 끝)과 innerR(안쪽으로 파인 지점)을 45도 간격으로 번갈아
// 찍어서 흔한 "sparkle" 별 실루엣을 만든다 — innerR을 작게 잡을수록
// 뾰족하고 가느다란 별이 된다.
function starPoints(cx, cy, outerR, innerR) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const angle = ((-90 + i * 45) * Math.PI) / 180;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

// 가장 큰 tier(4) 전용 — 별 주위로 뻗어나가는 가는 반짝임 선. 별의 꼭짓점
// 사이(22.5도 오프셋)에 그려서 별 실루엣과 겹치지 않게 한다.
function burstRays(cx, cy, innerR, outerR, count, color, opacity) {
  let lines = "";
  for (let i = 0; i < count; i++) {
    const angle = ((i * (360 / count) + 22.5) * Math.PI) / 180;
    const x1 = cx + innerR * Math.cos(angle);
    const y1 = cy + innerR * Math.sin(angle);
    const x2 = cx + outerR * Math.cos(angle);
    const y2 = cy + outerR * Math.sin(angle);
    lines += `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${color}" stroke-width="1.2" stroke-linecap="round" opacity="${opacity}"/>`;
  }
  return lines;
}

/**
 * Memory Light — 핀이 아니라 "장소에 남겨진 기억을 작은 빛의 잔광으로
 * 표현"하는 컨셉의 마커(디자인 가이드 기준, 2026-08-13 개편). 중심부
 * (거의 불투명) → 1차 광원(중간 광훈) → 2차 잔광(옅고 큰 바깥 haze)
 * 3겹의 반투명 원을 겹쳐 빛무리를 만든다. radialGradient(defs)를
 * 한 번 써봤는데 지도가 흐려지는 것과 겹쳐 마커가 거의 안 보이는
 * 문제가 있었다(2026-08-13) — 그라디언트가 카카오 마커 이미지로
 * 래스터라이즈되는 과정에서 옅어지는 것으로 추정, 검증된 방식(단순
 * 반투명 원 겹치기)으로 되돌리고 대신 불투명도를 확실히 올렸다.
 * 기억 수는 크기로(기존 tier), "오늘 남긴 기억이 있는가"는 광원의
 * 선명도로 구분한다(VARIATIONS: 오늘의 기억 = 더 선명·따뜻, 오래된
 * 기억 = 더 희미·부드러움). 선택되지 않은 점만 아주 느리게 커졌다
 * 작아지길 반복한다(BEHAVIOR, 5~7초 주기 — 선택된 점은 이미 크기로
 * 강조되니 정적으로 둔다).
 */
function makeDotImage(tier, selected, isToday) {
  const centerSizes = { 1: 13, 2: 16, 3: 19, 4: 22 };
  const glow1Sizes = { 1: 16, 2: 19, 3: 22, 4: 25 };
  const glow2Sizes = { 1: 26, 2: 30, 3: 34, 4: 38 };

  const center = selected ? centerSizes[tier] + 3 : centerSizes[tier];
  const glow1 = selected ? glow1Sizes[tier] + 5 : glow1Sizes[tier];
  const glow2 = selected ? glow2Sizes[tier] + 7 : glow2Sizes[tier];

  const coreOpacity = selected ? 1 : isToday ? 1 : 0.9;
  const glow1Opacity = selected ? 0.4 : isToday ? 0.34 : 0.24;
  const glow2Opacity = selected ? 0.16 : isToday ? 0.13 : 0.08;

  const canvas = glow2 + 6;
  const c = canvas / 2;

  // 선택되지 않은 점만 숨쉬듯 커졌다 작아진다. 마커마다 주기/시작
  // 위상을 랜덤하게 뽑아서 다 같이 움직이지 않고 제각각 호흡하게 한다
  // (begin을 음수로 줘서 로드 즉시 각자 다른 위상에서 시작).
  let glow2Animate = "";
  let glow1Animate = "";
  if (!selected) {
    const dur = (5 + Math.random() * 2).toFixed(2);
    const begin = (Math.random() * dur).toFixed(2);
    const glow2Peak = (glow2 / 2) * 1.15;
    const glow1PeakOpacity = Math.min(glow1Opacity + 0.08, 0.5);
    glow2Animate = `<animate attributeName="r" values="${glow2 / 2};${glow2Peak.toFixed(2)};${glow2 / 2}" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/>`;
    glow1Animate = `<animate attributeName="opacity" values="${glow1Opacity};${glow1PeakOpacity};${glow1Opacity}" dur="${dur}s" begin="-${begin}s" repeatCount="indefinite"/>`;
  }

  // 가장 큰 tier만 별 주위로 반짝임 선을 추가 — 기억이 가장 많이 쌓인
  // 곳이 "빛을 내뿜는" 느낌이 나도록.
  const rays =
    tier === 4
      ? burstRays(c, c, (center / 2) * 1.15, glow2 / 2, 8, MEMORY_GLOW, selected ? 0.5 : 0.32)
      : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}">
    <circle cx="${c}" cy="${c}" r="${glow2 / 2}" fill="${MEMORY_CORE}" opacity="${glow2Opacity}">${glow2Animate}</circle>
    <circle cx="${c}" cy="${c}" r="${glow1 / 2}" fill="${MEMORY_GLOW}" opacity="${glow1Opacity}">${glow1Animate}</circle>
    ${rays}
    <path d="${starPoints(c, c, center / 2, (center / 2) * 0.5)}" fill="${STAR_FILL}" opacity="${coreOpacity}" stroke="#FFFFFF" stroke-width="1.2" stroke-linejoin="round"/>
  </svg>`;

  const url = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  return new kakao.maps.MarkerImage(
    url,
    new kakao.maps.Size(canvas, canvas),
    { offset: new kakao.maps.Point(c, c) }
  );
}

// 카카오 MarkerClusterer 아이콘 — 개별 Memory Light(makeDotImage)와 같은
// 별+광훈 구성을 SVG 배경 이미지로 만들어 CSS 원(box-shadow)을 대체한다.
// styles 배열 항목은 클러스터러가 생성하는 div에 인라인 CSS로 그대로
// 꽂히므로, background를 data URI로 지정하면 별 모양 그대로 나온다.
function makeClusterBackground() {
  const center = 18;
  const glow1 = 24;
  const glow2 = 36;
  const canvas = glow2 + 6;
  const c = canvas / 2;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}">
    <circle cx="${c}" cy="${c}" r="${glow2 / 2}" fill="${MEMORY_CORE}" opacity="0.12"/>
    <circle cx="${c}" cy="${c}" r="${glow1 / 2}" fill="${MEMORY_GLOW}" opacity="0.3"/>
    <path d="${starPoints(c, c, center / 2, (center / 2) * 0.5)}" fill="${STAR_FILL}" stroke="#FFFFFF" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>`;

  return { canvas, url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg) };
}

function initMap() {
  const container = document.getElementById("map");
  const options = {
    center: new kakao.maps.LatLng(CONFIG.DEFAULT_CENTER.lat, CONFIG.DEFAULT_CENTER.lng),
    level: CONFIG.DEFAULT_LEVEL,
  };
  map = new kakao.maps.Map(container, options);

  clusterer = new kakao.maps.MarkerClusterer({
    map,
    averageCenter: true,
    // 낮을수록 더 확대해야만 클러스터가 풀린다(정확한 위치 노출을 늦추려는
    // 의도). 3이었을 때 동네 수준으로 확대해도 계속 뭉쳐 보인다는 피드백이
    // 있어(2026-08-12) 동네/빌딩 군 정도에서는 풀리도록 5로 올림.
    minLevel: 5,
    disableClickZoom: false,
    // 뭉친 지점도 개별 Memory Light와 같은 별+광훈 구성으로 보이도록
    // makeClusterBackground()가 만든 SVG를 배경 이미지로 꽂는다(숫자
    // 배지 없이, 은은한 빛무리 + 별만).
    styles: [
      (() => {
        const bg = makeClusterBackground();
        return {
          width: `${bg.canvas}px`,
          height: `${bg.canvas}px`,
          background: `url("${bg.url}") no-repeat center / contain`,
          color: "transparent",
          textAlign: "center",
          lineHeight: `${bg.canvas}px`,
          fontSize: "0px",
          fontWeight: "500",
        };
      })(),
    ],
  });

  placesService = new kakao.maps.services.Places();
  geocoderService = new kakao.maps.services.Geocoder();

  kakao.maps.event.addListener(map, "click", (mouseEvent) => {
    if (recallSessionOpen) return;
    clearSearchPin();
    if (sheetOpen) {
      closeSheetToUnfiltered();
      return;
    }
    const latlng = mouseEvent.latLng;
    spawnClickStamp(mouseEvent);
    const promptPrefill = consumePendingDailyPrompt();
    requireLogin(() => startFreePinComposer(latlng.getLat(), latlng.getLng(), promptPrefill));
  });

  // 검색 위치 핀은 "다른 곳을 클릭하는 등 어떠한 액션"을 취하면 바로
  // 사라져야 한다(2026-08-18) — 지도 자체 클릭(위 리스너)과 마커 클릭
  // (renderMarkers)은 각자 clearSearchPin()을 직접 부르고, 그 외
  // 나머지 UI 전반(하단 툴바/해시태그/계정 메뉴 등)은 여기서 한 번에
  // 잡는다. 검색창(.search-box)과 검색으로 연 모달들(#search-area-overlay,
  // #search-nearby-overlay) 안쪽 클릭은 핀을 보여주거나 그 핀을 기준으로
  // 계속 탐색하는 흐름 자체라 제외한다. capture 단계라 지도/마커 자체
  // 클릭이 버블링으로 여기 다시 걸릴 걱정은 없다(카카오 마커 클릭은
  // 지도 click 이벤트로 전파되지 않음).
  document.addEventListener(
    "click",
    (e) => {
      if (!searchPinMarker) return;
      if (e.target.closest("#map, .search-box, #search-area-overlay, #search-nearby-overlay")) return;
      clearSearchPin();
    },
    true
  );
}

function spawnClickStamp(mouseEvent) {
  const mapEl = document.getElementById("map");
  const rect = mapEl.getBoundingClientRect();
  const px = rect.left + mouseEvent.point.x;
  const py = rect.top + mouseEvent.point.y;

  const stamp = document.createElement("div");
  stamp.className = "click-stamp";
  stamp.style.left = `${px}px`;
  stamp.style.top = `${py}px`;
  document.body.appendChild(stamp);
  setTimeout(() => stamp.remove(), 500);
}

// ------------------------------------------------------------
// 검색 위치 핀 — 주소 검색 결과를 고르면 지도가 그 좌표로 이동하는데,
// "이 동네 기억" 카드를 바로 안 쓰고 모달 바깥을 눌러 꺼버리면 방금
// 검색한 위치가 지도 어디였는지 알 수 없어지는 문제가 있었다
// (2026-08-17). 모달을 닫아도 좌표에 꽂힌 채로 남아있다가, 새로
// 검색하거나 그 자리에 실제로 기억을 남기거나(=진짜 마커가 생기면),
// 지도/다른 UI에서 다른 액션을 하나라도 취하면 바로 사라진다(2026-08-18,
// initMap의 전역 클릭 리스너 참고 — 처음엔 어떤 액션을 취해도 안
// 사라지게 했었는데, 오히려 계속 남아있는 게 거슬린다는 피드백으로
// "다음 액션 전까지만" 보이는 걸로 좁혔다). 카카오 기본 파란 마커 대신
// 커스텀 아이콘을 써서 "아직 기억은 없고 검색으로 짚어본 위치"라는 걸
// 시각적으로 구분한다. 예전엔 정적 PNG(assets/search-pin-marker.png)였는데,
// 다른 마커들(makeDotImage 등)과 같은 방식으로 인라인 SVG를 데이터
// URI로 직접 그려서 배율이 달라져도 안 흐려지고 색도 코드에서 바로
// 관리한다(2026-08-19, 별+깃대+바닥링 디자인 시안 반영).
// ------------------------------------------------------------
const SEARCH_PIN_COLOR = "#FF5A36"; // --cs-orange와 동일
const SEARCH_PIN_WIDTH = 28;
const SEARCH_PIN_HEIGHT = 40;
// 실제 좌표가 가리키는 지점 — 기존 PNG는 뾰족한 핀 끝이 좌표였는데, 이
// 디자인은 깃대 끝에 바닥링(과녁 모양)이 있는 구조라 그 중심이 그 역할을
// 한다.
const SEARCH_PIN_ANCHOR_Y = 34;

// makeDotImage의 starPoints()는 4각 반짝임(sparkle)이라 이 디자인의 통통한
// 5각 별과는 다른 모양 — 별도로 표준 5각 별 좌표를 만든다.
function fivePointStarPath(cx, cy, outerR, innerR) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const angle = ((-90 + i * 36) * Math.PI) / 180;
    const r = i % 2 === 0 ? outerR : innerR;
    pts.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`);
  }
  return `M${pts.join("L")}Z`;
}

function buildSearchPinSvg() {
  const cx = SEARCH_PIN_WIDTH / 2;
  const starCy = 8.5;
  const starOuterR = 7.2;
  const starPath = fivePointStarPath(cx, starCy, starOuterR, 3.1);
  // 별 아래쪽과 살짝 겹치게 시작해서 이음매가 안 보이게 한다.
  const poleTop = starCy + starOuterR - 0.5;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SEARCH_PIN_WIDTH}" height="${SEARCH_PIN_HEIGHT}">
    <rect x="${(cx - 1.3).toFixed(2)}" y="${poleTop.toFixed(2)}" width="2.6" height="${(SEARCH_PIN_ANCHOR_Y - poleTop).toFixed(2)}" rx="1.3" fill="${SEARCH_PIN_COLOR}"/>
    <ellipse cx="${cx}" cy="${SEARCH_PIN_ANCHOR_Y}" rx="8" ry="2.6" fill="${SEARCH_PIN_COLOR}" opacity="0.18"/>
    <ellipse cx="${cx}" cy="${SEARCH_PIN_ANCHOR_Y}" rx="5.4" ry="1.9" fill="#FFFFFF" opacity="0.95"/>
    <ellipse cx="${cx}" cy="${SEARCH_PIN_ANCHOR_Y}" rx="2.3" ry="1.05" fill="${SEARCH_PIN_COLOR}"/>
    <path d="${starPath}" fill="${SEARCH_PIN_COLOR}"/>
  </svg>`;

  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

function buildSearchPinImage() {
  return new kakao.maps.MarkerImage(
    buildSearchPinSvg(),
    new kakao.maps.Size(SEARCH_PIN_WIDTH, SEARCH_PIN_HEIGHT),
    { offset: new kakao.maps.Point(SEARCH_PIN_WIDTH / 2, SEARCH_PIN_ANCHOR_Y) }
  );
}

function showSearchPin(lat, lng, info) {
  clearSearchPin();
  searchPinInfo = info;
  searchPinMarker = new kakao.maps.Marker({
    map,
    position: new kakao.maps.LatLng(lat, lng),
    image: buildSearchPinImage(),
    zIndex: 10,
  });
  kakao.maps.event.addListener(searchPinMarker, "click", () => {
    if (searchPinInfo) openSearchAreaModal(searchPinInfo);
  });
}

function clearSearchPin() {
  if (searchPinMarker) {
    searchPinMarker.setMap(null);
    searchPinMarker = null;
  }
  searchPinInfo = null;
}

// address: 도로명/지번 주소 문자열. buildingName: 좌표가 등록된 건물(예: "서울역")
// 위일 때만 채워지는 건물명 — 없는 좌표가 대부분이라 항상 null일 수 있다.
function reverseGeocode(lat, lng) {
  return new Promise((resolve) => {
    if (!geocoderService) {
      resolve({ address: null, buildingName: null });
      return;
    }
    geocoderService.coord2Address(lng, lat, (result, status) => {
      if (status === kakao.maps.services.Status.OK && result[0]) {
        const road = result[0].road_address;
        const jibun = result[0].address;
        resolve({
          address: (road && road.address_name) || (jibun && jibun.address_name) || null,
          buildingName: (road && road.building_name) || null,
        });
      } else {
        resolve({ address: null, buildingName: null });
      }
    });
  });
}

function highlightMarkerForStory(story) {
  const entry = markers.find((m) => m.group.stories.some((s) => s.id === story.id));
  if (!entry) return;

  if (highlightedMarker && highlightedMarker !== entry.marker) {
    const prevEntry = markers.find((m) => m.marker === highlightedMarker);
    if (prevEntry) {
      highlightedMarker.setImage(getDotImage(prevEntry.group.key, tierForCount(prevEntry.group.stories.length), false, groupHasTodayStory(prevEntry.group)));
    }
  }
  entry.marker.setImage(getDotImage(entry.group.key, tierForCount(entry.group.stories.length), true, groupHasTodayStory(entry.group)));
  highlightedMarker = entry.marker;
}

// ------------------------------------------------------------
// 마커 렌더링 (해시태그 / 연도 / 노래 / 시간 슬라이더 / 내 기억 필터 적용)
// ------------------------------------------------------------
function renderMarkers() {
  clusterer.clear();
  markers.forEach((m) => kakao.maps.event.removeListener(m.marker, "click"));
  markers = [];
  highlightedMarker = null;

  let groups = Storage.getGroupedByPlace();

  if (sliderActive && sliderYear !== null) {
    groups = groups
      .map((g) => ({
        ...g,
        stories: g.stories.filter((s) => {
          const y = Storage.getStoryYear(s);
          if (sliderMode === "exact") return y === sliderYear;
          return y === null || y <= sliderYear;
        }),
      }))
      .filter((g) => g.stories.length > 0);
  } else if (activeYearFilter !== null) {
    groups = groups
      .map((g) => ({ ...g, stories: g.stories.filter((s) => Storage.getStoryYear(s) === activeYearFilter) }))
      .filter((g) => g.stories.length > 0);
  } else if (activeHashtagFilter) {
    groups = groups
      .map((g) => ({ ...g, stories: g.stories.filter((s) => s.hashtags.includes(activeHashtagFilter)) }))
      .filter((g) => g.stories.length > 0);
  } else if (activeSongFilter) {
    const songStoryIds = new Set(
      Storage.getStoriesForSong(activeSongFilter.artist, activeSongFilter.title).map((s) => s.id)
    );
    groups = groups
      .map((g) => ({ ...g, stories: g.stories.filter((s) => songStoryIds.has(s.id)) }))
      .filter((g) => g.stories.length > 0);
  } else if (myMemoryModeActive) {
    // 계정(StoryAuthor) 연결만 본다 — 브라우저 기기ID는 안 쓴다(2026-08-14,
    // filters.js startMyMemoryMode 참고).
    groups = groups
      .map((g) => ({ ...g, stories: g.stories.filter((s) => myMemoryAccountStoryIds.has(s.id)) }))
      .filter((g) => g.stories.length > 0);
  }

  const kakaoMarkers = [];

  groups.forEach((group) => {
    const tier = tierForCount(group.stories.length);
    // "내 기억" 모드에서는 선으로 잇는 대신(2026-08-13, 지하철 노선도
    // 같아 보인다는 피드백으로 제거) 남아있는 점 전부를 오늘 남긴
    // 기억과 같은 밝기로 "불이 들어온" 것처럼 보여준다 — 실제로 오늘
    // 쓴 게 아니어도 "내 것"이라는 사실만으로 환하게 켜지는 것.
    const withinSearchArea =
      searchAreaActive &&
      searchAreaCenter &&
      Storage.isNear(searchAreaCenter.lat, searchAreaCenter.lng, group.lat, group.lng, CONFIG.SEARCH_AREA_RADIUS_METERS);
    const lit = myMemoryModeActive || groupHasTodayStory(group) || withinSearchArea;
    const marker = new kakao.maps.Marker({
      position: new kakao.maps.LatLng(group.lat, group.lng),
      title: Storage.getGroupTitle(group),
      image: getDotImage(group.key, tier, false, lit),
    });
    kakao.maps.event.addListener(marker, "click", () => {
      clearSearchPin();
      openSheet(group);
    });
    markers.push({ marker, group });
    kakaoMarkers.push(marker);
  });

  clusterer.addMarkers(kakaoMarkers);
}

function goToMyLocation() {
  if (!navigator.geolocation) {
    alert("이 브라우저에서는 위치 정보를 사용할 수 없습니다.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      map.setCenter(new kakao.maps.LatLng(latitude, longitude));
      map.setLevel(6);
    },
    () => alert("위치 정보를 가져올 수 없습니다. 위치 권한을 확인해주세요.")
  );
}
