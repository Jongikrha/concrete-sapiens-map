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
  const centerSizes = { 1: 10, 2: 13, 3: 16, 4: 19 };
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

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}">
    <circle cx="${c}" cy="${c}" r="${glow2 / 2}" fill="${MEMORY_CORE}" opacity="${glow2Opacity}">${glow2Animate}</circle>
    <circle cx="${c}" cy="${c}" r="${glow1 / 2}" fill="${MEMORY_GLOW}" opacity="${glow1Opacity}">${glow1Animate}</circle>
    <circle cx="${c}" cy="${c}" r="${center / 2}" fill="${MEMORY_CORE}" opacity="${coreOpacity}" stroke="#FFFFFF" stroke-width="1.5"/>
  </svg>`;

  const url = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  return new kakao.maps.MarkerImage(
    url,
    new kakao.maps.Size(canvas, canvas),
    { offset: new kakao.maps.Point(c, c) }
  );
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
    // 뭉친 지점도 개별 Memory Light와 같은 톤(MEMORY_CORE/MEMORY_GLOW)의
    // 은은한 빛무리로 보이도록, 숫자 배지 대신 box-shadow로 광원을
    // 흉내낸다(MarkerClusterer의 styles는 생성되는 div에 그대로 꽂히는
    // 인라인 CSS라 box-shadow도 그대로 먹는다).
    styles: [
      {
        width: "19px",
        height: "19px",
        background: "#C9573D",
        borderRadius: "50%",
        boxShadow: "0 0 8px 4px rgba(231,109,79,0.34), 0 0 24px 12px rgba(201,87,61,0.1)",
        color: "transparent",
        textAlign: "center",
        lineHeight: "19px",
        fontSize: "0px",
        fontWeight: "500",
      },
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
    requireLogin(() => startFreePinComposer(latlng.getLat(), latlng.getLng()));
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

function reverseGeocode(lat, lng) {
  return new Promise((resolve) => {
    if (!geocoderService) {
      resolve(null);
      return;
    }
    geocoderService.coord2Address(lng, lat, (result, status) => {
      if (status === kakao.maps.services.Status.OK && result[0]) {
        const road = result[0].road_address;
        const jibun = result[0].address;
        resolve((road && road.address_name) || (jibun && jibun.address_name) || null);
      } else {
        resolve(null);
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
    const deviceId = Storage.getDeviceId();
    groups = groups
      .map((g) => ({ ...g, stories: g.stories.filter((s) => s.authorDeviceId === deviceId) }))
      .filter((g) => g.stories.length > 0);
  }

  const kakaoMarkers = [];

  groups.forEach((group) => {
    const tier = tierForCount(group.stories.length);
    // "내 기억" 모드에서는 선으로 잇는 대신(2026-08-13, 지하철 노선도
    // 같아 보인다는 피드백으로 제거) 남아있는 점 전부를 오늘 남긴
    // 기억과 같은 밝기로 "불이 들어온" 것처럼 보여준다 — 실제로 오늘
    // 쓴 게 아니어도 "내 것"이라는 사실만으로 환하게 켜지는 것.
    const lit = myMemoryModeActive || groupHasTodayStory(group);
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
