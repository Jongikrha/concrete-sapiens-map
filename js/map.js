// ============================================================
// 지도 / 마커 (Memory Light)
// ============================================================

let map;
let clusterer;
let placesService;
let geocoderService;
let markers = []; // { marker, group }
let highlightedMarker = null;

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
    if (sheetOpen) {
      closeSheetToUnfiltered();
      return;
    }
    const latlng = mouseEvent.latLng;
    spawnClickStamp(mouseEvent);
    const promptPrefill = consumePendingDailyPrompt();
    requireLogin(() => startFreePinComposer(latlng.getLat(), latlng.getLng(), promptPrefill));
  });
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
      highlightedMarker.setImage(makeDotImage(tierForCount(prevEntry.group.stories.length), false, groupHasTodayStory(prevEntry.group)));
    }
  }
  entry.marker.setImage(makeDotImage(tierForCount(entry.group.stories.length), true, groupHasTodayStory(entry.group)));
  highlightedMarker = entry.marker;
}

// ------------------------------------------------------------
// 마커 렌더링 (해시태그 / 연도 / 시간 슬라이더 / 내 기억 필터 적용)
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
      image: makeDotImage(tier, false, lit),
    });
    kakao.maps.event.addListener(marker, "click", () => openSheet(group));
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
