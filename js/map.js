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
 * Signal Orange 하나만 쓰고, 기억 수는 숫자로 노출하지 않고 크기
 * 차이로만 표현한다(SNS 인기 경쟁처럼 보이지 않도록). 평소엔 조용한
 * 점, 선택되면 링이 한 번 커지는 정도의 절제된 변화만 준다.
 */
function makeDotImage(tier, selected) {
  const centerSizes = { 1: 10, 2: 13, 3: 16, 4: 19 };
  const ringSizes = { 1: 22, 2: 26, 3: 30, 4: 34 };

  const center = selected ? centerSizes[tier] + 3 : centerSizes[tier];
  const ring = selected ? ringSizes[tier] + 6 : ringSizes[tier];
  const ringOpacity = selected ? 0.28 : 0.18;

  const canvas = ring + 6;
  const c = canvas / 2;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}">
    <circle cx="${c}" cy="${c}" r="${ring / 2}" fill="#FF5A36" opacity="${ringOpacity}"/>
    <circle cx="${c}" cy="${c}" r="${center / 2}" fill="#FF5A36" stroke="#FFFFFF" stroke-width="2"/>
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
    styles: [
      {
        width: "30px",
        height: "30px",
        background: "rgba(47,48,49,0.92)",
        borderRadius: "50%",
        color: "transparent",
        textAlign: "center",
        lineHeight: "30px",
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
