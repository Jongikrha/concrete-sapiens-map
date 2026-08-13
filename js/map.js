// ============================================================
// 지도 / 마커 (Memory Dot)
// ============================================================

let map;
let clusterer;
let placesService;
let geocoderService;
let markers = []; // { marker, group }
let highlightedMarker = null;

// ------------------------------------------------------------
// Memory Dot 이미지 — 기억 수에 따라 크기 차등, 선택 시 Signal Orange
// ------------------------------------------------------------
function tierForCount(n) {
  if (n >= 50) return 4;
  if (n >= 10) return 3;
  if (n >= 2) return 2;
  return 1;
}

/**
 * Memory Ripple — 핀이 아니라 "누군가의 기억이 남아 있는 장소 =
 * 도시 위에 켜진 작은 불빛"이라는 컨셉의 마커. 색은 전적으로
 * Signal Orange 계열 하나만 쓰고, 기억 수는 숫자로 노출하지 않고 크기
 * 차이로만 표현한다(SNS 인기 경쟁처럼 보이지 않도록). 평소엔 조용한
 * 빛, 선택되면 살짝 더 커지는 정도의 절제된 변화만 준다.
 *
 * 은은한 방사형 glow(원형 그라디언트) 위에 4방향 sparkle(반짝임) 별
 * 모양을 얹어 "빛" 느낌을 낸다 — 지도 전체를 어둡게 하지 않아도 각
 * 점 자체가 빛나 보이도록(2026-08-13, 참고 이미지 기반).
 */
function dotSvgDataUrl(tier, selected) {
  const coreSizes = { 1: 10, 2: 13, 3: 16, 4: 19 };
  const glowSizes = { 1: 26, 2: 32, 3: 38, 4: 44 };

  const core = selected ? coreSizes[tier] + 3 : coreSizes[tier];
  const glow = selected ? glowSizes[tier] + 8 : glowSizes[tier];
  const glowOpacity = selected ? 0.85 : 0.65;

  const canvas = glow + 10;
  const c = canvas / 2;

  const starOuter = core * 1.1;
  const starInner = starOuter * 0.34;
  const k = starInner / Math.SQRT2;
  const starPoints = [
    [c, c - starOuter],
    [c + k, c - k],
    [c + starOuter, c],
    [c + k, c + k],
    [c, c + starOuter],
    [c - k, c + k],
    [c - starOuter, c],
    [c - k, c - k],
  ]
    .map((p) => p.join(","))
    .join(" ");

  const gradId = `dotGlow-${tier}-${selected ? 1 : 0}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}">
    <defs>
      <radialGradient id="${gradId}" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="#FFF3D6" stop-opacity="0.9"/>
        <stop offset="45%" stop-color="#FFB65C" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="#FF5A36" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle cx="${c}" cy="${c}" r="${glow / 2}" fill="url(#${gradId})" opacity="${glowOpacity}"/>
    <polygon points="${starPoints}" fill="#FFF3D6"/>
    <circle cx="${c}" cy="${c}" r="${core / 2.6}" fill="#FFF8E7"/>
  </svg>`;

  return { url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg), canvas };
}

function makeDotImage(tier, selected) {
  const { url, canvas } = dotSvgDataUrl(tier, selected);
  const c = canvas / 2;
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
    // 뭉친 지점도 개별 Memory Dot과 같은 빛 모양으로 보이도록, 숫자 배지
    // 대신 dotSvgDataUrl의 큰 점(tier 4) 이미지를 배경으로 그대로 재사용한다.
    styles: [
      (() => {
        const { url, canvas } = dotSvgDataUrl(4, false);
        return {
          width: `${canvas}px`,
          height: `${canvas}px`,
          background: `url(${url}) no-repeat center / contain`,
          color: "transparent",
          textAlign: "center",
          lineHeight: `${canvas}px`,
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
      highlightedMarker.setImage(makeDotImage(tierForCount(prevEntry.group.stories.length), false));
    }
  }
  entry.marker.setImage(makeDotImage(tierForCount(entry.group.stories.length), true));
  highlightedMarker = entry.marker;
}

// ------------------------------------------------------------
// 마커 렌더링 (해시태그 / 연도 / 시간 슬라이더 필터 적용)
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
  }

  const kakaoMarkers = [];

  groups.forEach((group) => {
    const tier = tierForCount(group.stories.length);
    const marker = new kakao.maps.Marker({
      position: new kakao.maps.LatLng(group.lat, group.lng),
      title: Storage.getGroupTitle(group),
      image: makeDotImage(tier, false),
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
