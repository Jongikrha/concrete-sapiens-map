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

function getDotImage(key, tier, selected, isToday, hasUnseen, hasPhoto) {
  const cached = dotImageCache.get(key);
  if (
    cached &&
    cached.tier === tier &&
    cached.selected === selected &&
    cached.isToday === isToday &&
    cached.hasUnseen === hasUnseen &&
    cached.hasPhoto === hasPhoto
  ) {
    return cached.image;
  }
  const image = makeDotImage(tier, selected, isToday, hasUnseen, hasPhoto);
  dotImageCache.set(key, { tier, selected, isToday, hasUnseen, hasPhoto, image });
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

// 직전 방문 이후 새로 올라온 기억이 있는지(2026-08-27, Storage.isUnseen
// 참고) — isToday와 별개 신호라 마커에도 별개 배지(NEW_BADGE_COLOR)로 그린다.
function groupHasUnseenStory(group) {
  return group.stories.some((s) => Storage.isUnseen(s));
}

// 사진이 있는 기억이 하나라도 있으면 마커에 표시 — 지도를 훑어보다가
// 사진 있는 기억도 자연스럽게 눈에 띄게 하려는 목적(2026-09-01).
function groupHasPhoto(group) {
  return group.stories.some((s) => s.photoKey);
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
// "새 글" 배지 — 계정 메뉴/아바타 알림 점(css .account-notif-dot)과 같은
// --cs-orange(#FF5A36) 계열로 맞춰서 "새 소식" 신호를 서비스 전반에서
// 일관되게 읽히게 한다.
const NEW_BADGE_COLOR = "#FF5A36";

// "사진 있음" 배지 이미지 — 카카오 마커는 data:image/svg+xml URL을 그대로
// <img>로 그리는데, 이렇게 "이미지 컨텍스트"로 로드된 SVG는 브라우저가
// 보안상 내부의 외부 리소스 참조(<image href="https://...">)를 아예
// 막아버린다 — assets/photo-badge.png를 절대경로로 참조했을 때 실제
// 배포 후 깨진 이미지로 나온 게 이 제약 때문이었다(2026-09-01 확인).
// 그래서 외부 참조 대신 이미지 바이트 자체를 data URI로 인라인한다.
// 원본 그림/재생성 스크립트는 assets/photo-badge.png로 남겨두고, 여기
// 쓰는 건 그걸 48x48로 축소한 것 — 배지 표시 크기(14px 안팎)보다
// 넉넉히 커서 레티나에서도 흐려 보이지 않으면서 문자열은 최대한 짧게.
const PHOTO_BADGE_DATA_URI = "data:image/png;base64,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";

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
function makeDotImage(tier, selected, isToday, hasUnseen, hasPhoto) {
  const centerSizes = { 1: 13, 2: 16, 3: 19, 4: 22 };
  const glow1Sizes = { 1: 16, 2: 19, 3: 22, 4: 25 };
  const glow2Sizes = { 1: 26, 2: 30, 3: 34, 4: 38 };

  const center = selected ? centerSizes[tier] + 3 : centerSizes[tier];
  const glow1 = selected ? glow1Sizes[tier] + 5 : glow1Sizes[tier];
  const glow2 = selected ? glow2Sizes[tier] + 7 : glow2Sizes[tier];

  const coreOpacity = selected ? 1 : isToday ? 1 : 0.9;
  // 지도를 어둡게 하면서(2026-08-26) 별이 더 잘 보이면 좋겠다는 요청 —
  // 크기는 그대로 두고 광훈 불투명도만 살짝 올려서 더 또렷하게 빛나
  // 보이게 한다.
  const glow1Opacity = selected ? 0.46 : isToday ? 0.39 : 0.28;
  const glow2Opacity = selected ? 0.19 : isToday ? 0.15 : 0.1;

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

  // "새 글" 배지 — 별의 북동쪽 꼭짓점 옆에 작은 점을 하나 더 찍는다.
  // tier로 이미 크기 차등이 있으니 배지 자체는 tier와 무관하게 고정
  // 크기로 둬서, 가장 큰 tier에서도 파묻히지 않으면서 작은 tier에서도
  // 별을 가리지 않게 한다.
  const badge = hasUnseen
    ? (() => {
        const r = 3.4;
        const offset = (center / 2) * 0.92;
        const bx = c + offset * 0.7071;
        const by = c - offset * 0.7071;
        return `<circle cx="${bx.toFixed(2)}" cy="${by.toFixed(2)}" r="${r}" fill="${NEW_BADGE_COLOR}" stroke="#FFFFFF" stroke-width="1.4"/>`;
      })()
    : "";

  // "사진 있음" 배지 — "새 글" 배지(북동쪽)와 겹치지 않게 반대쪽
  // 남서쪽에 찍는다. 손으로 그린 카메라 도형 대신, 사용자가 골라준
  // 일러스트(카메라+반짝이는 별 플래시, assets/photo-badge.png)를
  // 그대로 쓴다(2026-09-01) — 축소된 크기에서도 원본 그림 그대로
  // 라스터라이즈되니 직접 그린 도형보다 디테일이 살아있다.
  const photoBadge = hasPhoto
    ? (() => {
        const r = 7;
        const offset = (center / 2) * 0.95;
        const bx = c - offset * 0.7071;
        const by = c + offset * 0.7071;
        return `<image href="${PHOTO_BADGE_DATA_URI}" x="${(bx - r).toFixed(2)}" y="${(by - r).toFixed(2)}" width="${(r * 2).toFixed(2)}" height="${(r * 2).toFixed(2)}"/>`;
      })()
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}">
    <circle cx="${c}" cy="${c}" r="${glow2 / 2}" fill="${MEMORY_CORE}" opacity="${glow2Opacity}">${glow2Animate}</circle>
    <circle cx="${c}" cy="${c}" r="${glow1 / 2}" fill="${MEMORY_GLOW}" opacity="${glow1Opacity}">${glow1Animate}</circle>
    ${rays}
    <path d="${starPoints(c, c, center / 2, (center / 2) * 0.5)}" fill="${STAR_FILL}" opacity="${coreOpacity}" stroke="#FFFFFF" stroke-width="1.8" stroke-linejoin="round"/>
    ${badge}
    ${photoBadge}
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
    <path d="${starPoints(c, c, center / 2, (center / 2) * 0.5)}" fill="${STAR_FILL}" stroke="#FFFFFF" stroke-width="1.8" stroke-linejoin="round"/>
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
      highlightedMarker.setImage(getDotImage(prevEntry.group.key, tierForCount(prevEntry.group.stories.length), false, groupHasTodayStory(prevEntry.group), groupHasUnseenStory(prevEntry.group), groupHasPhoto(prevEntry.group)));
    }
  }
  entry.marker.setImage(getDotImage(entry.group.key, tierForCount(entry.group.stories.length), true, groupHasTodayStory(entry.group), groupHasUnseenStory(entry.group), groupHasPhoto(entry.group)));
  highlightedMarker = entry.marker;
}

// 시트를 열어 기억을 읽고 나면(Storage.markStoriesRead) "새 글" 점이
// 다음 방문을 기다리지 않고 바로 꺼지도록, 해당 장소 마커의 이미지를
// 그 자리에서 다시 그린다(2026-08-31). storySheet.js의 openSheet에서 호출.
function refreshMarkerDotForGroup(group) {
  const entry = markers.find((m) => m.group.key === group.key);
  if (!entry) return;
  const selected = entry.marker === highlightedMarker;
  entry.marker.setImage(getDotImage(entry.group.key, tierForCount(entry.group.stories.length), selected, groupHasTodayStory(entry.group), groupHasUnseenStory(entry.group), groupHasPhoto(entry.group)));
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
      image: getDotImage(group.key, tier, false, lit, groupHasUnseenStory(group), groupHasPhoto(group)),
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
