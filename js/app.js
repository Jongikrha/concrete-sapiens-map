// ============================================================
// 콘크리트 사피엔스 지도 — 메인 앱 로직
// Concrete Archive 디자인 스펙 v1.0 / 통합 개발기획서 v1.0 반영
//
// ⚠️ 아직 반영되지 않은 것 (별도 백엔드 필요, 프론트 프로토타입 한계):
//   - 회원가입/로그인/이메일 인증 (Cognito 등 실제 인증 서비스 필요)
//   - 관리자 시스템(/admin), 신고 검토 큐, 금칙어 관리
//   - Story별 영구 공유 URL의 실제 서버 조회 (지금은 같은 브라우저의
//     localStorage에만 저장되므로, 다른 사람에게 링크를 보내도 그
//     사람 브라우저에는 데이터가 없어 정상 동작하지 않습니다)
//   - OG 이미지 자동 생성 (서버 렌더링 필요)
// ============================================================

let map;
let clusterer;
let placesService;
let geocoderService;
let markers = []; // { marker, group }
let activeHashtagFilter = null;
let pendingPin = null;
let currentSort = "latest";
let highlightedMarker = null;
let sheetOpen = false;

// ------------------------------------------------------------
// Memory Dot 이미지 (핀 대신 점)
// ------------------------------------------------------------
function makeDotImage(selected) {
  const size = selected ? 20 : 15;
  const fill = selected ? "#FF5A36" : "#2F3031";
  const stroke = "#F4F3EF";
  const r = size / 2 - 1.8;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2"/></svg>`;
  const url = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  return new kakao.maps.MarkerImage(
    url,
    new kakao.maps.Size(size, size),
    { offset: new kakao.maps.Point(size / 2, size / 2) }
  );
}

function initApp() {
  Storage.seedIfEmpty();
  initMap();
  bindUIEvents();
  renderHashtagChips();
  renderMarkers();
  handleInitialEntry();
}

// ------------------------------------------------------------
// 지도 초기화
// ------------------------------------------------------------
function initMap() {
  const container = document.getElementById("map");
  const options = {
    center: new kakao.maps.LatLng(
      CONFIG.DEFAULT_CENTER.lat,
      CONFIG.DEFAULT_CENTER.lng
    ),
    level: CONFIG.DEFAULT_LEVEL,
  };
  map = new kakao.maps.Map(container, options);

  clusterer = new kakao.maps.MarkerClusterer({
    map,
    averageCenter: true,
    minLevel: 8,
    disableClickZoom: false,
    styles: [
      {
        width: "30px",
        height: "30px",
        background: "rgba(47,48,49,0.92)",
        borderRadius: "50%",
        color: "#F4F3EF",
        textAlign: "center",
        lineHeight: "30px",
        fontSize: "12px",
        fontWeight: "500",
      },
    ],
  });

  placesService = new kakao.maps.services.Places();
  geocoderService = new kakao.maps.services.Geocoder();

  // 지도 클릭:
  // - Bottom Sheet가 열려 있으면 지도 빈 공간 클릭으로 우선 닫기
  // - 닫혀 있으면 자유 핀 작성 플로우 시작 (클릭 지점에 스탬프 효과 + 주소 조회)
  kakao.maps.event.addListener(map, "click", (mouseEvent) => {
    if (sheetOpen) {
      closeSheet();
      return;
    }
    const latlng = mouseEvent.latLng;
    spawnClickStamp(mouseEvent);
    startFreePinComposer(latlng.getLat(), latlng.getLng());
  });
}

// ------------------------------------------------------------
// 클릭 스탬프 효과 (지도를 찍었다는 시각적 피드백)
// ------------------------------------------------------------
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
// 자유 핀 작성 시작 — 주소를 먼저 조회한 뒤 작성 화면을 연다
// ------------------------------------------------------------
function startFreePinComposer(lat, lng) {
  openComposer({
    lat,
    lng,
    placeName: null,
    placeId: null,
    address: "주소 확인 중...",
    isFreePin: true,
  });

  reverseGeocode(lat, lng).then((address) => {
    const addrEl = document.getElementById("composer-address-value");
    if (addrEl) {
      addrEl.textContent = address || "주소를 확인할 수 없습니다";
    }
    if (pendingPin) pendingPin.address = address || null;
  });
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
        resolve(
          (road && road.address_name) ||
            (jibun && jibun.address_name) ||
            null
        );
      } else {
        resolve(null);
      }
    });
  });
}
// ------------------------------------------------------------
// 최초 진입: 최근 이야기 랜덤 랜딩 (개발기획서 §4~5 / 디자인 스펙 §4)
// ------------------------------------------------------------
function handleInitialEntry() {
  const params = new URLSearchParams(window.location.search);
  const storyPublicId = params.get("story");

  if (storyPublicId) {
    const story = Storage.getStoryByPublicId(storyPublicId);
    if (story) {
      flyToStory(story, true);
      return;
    }
    // 삭제되었거나 존재하지 않는 Story
    showGoneState();
    return;
  }

  // fallback 체인: 최근 이야기 풀 랜덤 → 전체 ACTIVE 랜덤 → 기본 지도
  const recent = Storage.getRandomRecentStory();
  const fallback = recent || Storage.getRandomStory();

  if (!fallback) {
    return; // Story가 하나도 없으면 기본 대한민국 지도 그대로 둠
  }

  flyToStory(fallback, false);
  showEntryToast("오늘 올라온 기억에서 시작했습니다");
}

function flyToStory(story, openSheetAfter) {
  map.setLevel(4);
  map.panTo(new kakao.maps.LatLng(story.lat, story.lng));
  highlightMarkerForStory(story);

  if (openSheetAfter) {
    const group = Storage.getGroupedByPlace().find((g) =>
      g.stories.some((s) => s.id === story.id)
    );
    if (group) {
      setTimeout(() => openSheet(group), 250);
    }
  }
}

function highlightMarkerForStory(story) {
  const entry = markers.find((m) =>
    m.group.stories.some((s) => s.id === story.id)
  );
  if (!entry) return;

  if (highlightedMarker && highlightedMarker !== entry.marker) {
    highlightedMarker.setImage(makeDotImage(false));
  }
  entry.marker.setImage(makeDotImage(true));
  highlightedMarker = entry.marker;
}

function showEntryToast(text) {
  const el = document.getElementById("entry-toast");
  el.textContent = text;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3500);
}

function showShareToast(text) {
  const el = document.getElementById("share-toast");
  el.textContent = text;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2000);
}

// ------------------------------------------------------------
// 마커 렌더링 (스팟 단위로 그룹핑, Memory Dot 사용)
// ------------------------------------------------------------
function renderMarkers() {
  clusterer.clear();
  markers.forEach((m) => kakao.maps.event.removeListener(m.marker, "click"));
  markers = [];
  highlightedMarker = null;

  let groups = Storage.getGroupedByPlace();

  if (activeHashtagFilter) {
    groups = groups
      .map((g) => ({
        ...g,
        stories: g.stories.filter((s) =>
          s.hashtags.includes(activeHashtagFilter)
        ),
      }))
      .filter((g) => g.stories.length > 0);
  }

  const kakaoMarkers = [];

  groups.forEach((group) => {
    const marker = new kakao.maps.Marker({
      position: new kakao.maps.LatLng(group.lat, group.lng),
      title: group.placeName,
      image: makeDotImage(false),
    });
    kakao.maps.event.addListener(marker, "click", () => {
      openSheet(group);
    });
    markers.push({ marker, group });
    kakaoMarkers.push(marker);
  });

  clusterer.addMarkers(kakaoMarkers);
}

// ------------------------------------------------------------
// 해시태그 칩 렌더링 (많이 쓰인 순 상위 N개)
// ------------------------------------------------------------
function renderHashtagChips() {
  const wrap = document.getElementById("hashtag-chips");
  wrap.innerHTML = "";

  if (activeHashtagFilter) {
    const clearChip = document.createElement("button");
    clearChip.className = "chip chip--active";
    clearChip.textContent = `${activeHashtagFilter} ✕`;
    clearChip.onclick = () => {
      activeHashtagFilter = null;
      renderHashtagChips();
      renderMarkers();
    };
    wrap.appendChild(clearChip);
    return;
  }

  const topTags = Storage.getTopHashtags(CONFIG.TOP_HASHTAG_LIMIT);
  if (topTags.length === 0) return;

  topTags.forEach((tag) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = tag;
    chip.onclick = () => {
      activeHashtagFilter = tag;
      renderHashtagChips();
      renderMarkers();
    };
    wrap.appendChild(chip);
  });
}

// ------------------------------------------------------------
// Bottom Sheet — 이야기 열람
// ------------------------------------------------------------
function openSheet(group) {
  currentSort = "latest";
  renderSheetContent(group);
  document.getElementById("sheet-backdrop").classList.remove("hidden");
  document.getElementById("bottom-sheet").classList.remove("hidden");
  sheetOpen = true;
}

function closeSheet() {
  document.getElementById("sheet-backdrop").classList.add("hidden");
  document.getElementById("bottom-sheet").classList.add("hidden");
  sheetOpen = false;
}

function showGoneState() {
  const content = document.getElementById("sheet-content");
  content.innerHTML = `
    <div class="gone-state-content">
      <p>이 기억은 더 이상<br />지도에 남아 있지 않습니다.</p>
      <button class="btn-primary" id="btn-find-another">어딘가의 기억 발견하기</button>
    </div>
  `;
  document.getElementById("sheet-backdrop").classList.remove("hidden");
  document.getElementById("bottom-sheet").classList.remove("hidden");
  sheetOpen = true;

  content.querySelector("#btn-find-another").onclick = () => {
    closeSheet();
    goToRandomStory();
  };
}

function renderSheetContent(group) {
  const content = document.getElementById("sheet-content");

  const sorted = [...group.stories].sort((a, b) => {
    if (currentSort === "latest") {
      return new Date(b.createdAt) - new Date(a.createdAt);
    }
    const da = a.referenceDate ? new Date(a.referenceDate) : new Date(8640000000000000);
    const db = b.referenceDate ? new Date(b.referenceDate) : new Date(8640000000000000);
    return da - db;
  });

  content.innerHTML = `
    <div class="story-spot-header">
      <div>
        <div class="story-spot-name">${escapeHtml(group.placeName || "이름 없는 곳")}</div>
        ${group.address ? `<div class="story-spot-address">${escapeHtml(group.address)}</div>` : ""}
      </div>
      <span class="story-spot-count">${sorted.length}개의 기억</span>
    </div>
    <div class="sort-toggle">
      <button class="sort-btn ${currentSort === "latest" ? "sort-btn--active" : ""}" data-sort="latest">최신순</button>
      <button class="sort-btn ${currentSort === "timetravel" ? "sort-btn--active" : ""}" data-sort="timetravel">시간여행순</button>
    </div>
    <div class="story-list">
      ${sorted.map(renderStoryItem).join("")}
    </div>
    <button class="btn-primary btn-add-story" id="btn-add-story">기억 남기기</button>
  `;

  content.querySelectorAll(".sort-btn").forEach((btn) => {
    btn.onclick = () => {
      currentSort = btn.dataset.sort;
      renderSheetContent(group);
    };
  });

  content.querySelectorAll(".hashtag-link").forEach((link) => {
    link.onclick = () => {
      activeHashtagFilter = link.dataset.tag;
      closeSheet();
      renderHashtagChips();
      renderMarkers();
    };
  });

  content.querySelectorAll(".reaction-btn").forEach((btn) => {
    btn.onclick = () => {
      Storage.toggleReaction(btn.dataset.id);
      renderSheetContent(group);
    };
  });

  content.querySelectorAll(".share-btn").forEach((btn) => {
    btn.onclick = () => handleShare(btn.dataset.id, btn.dataset.publicid, btn.dataset.place);
  });

  content.querySelectorAll(".report-link").forEach((btn) => {
    btn.onclick = () => {
      if (confirm("이 기록을 신고하시겠습니까?")) {
        Storage.reportStory(btn.dataset.id);
        alert("신고가 접수되었습니다.");
        const refreshed = Storage.getGroupedByPlace().find((g) => g.key === group.key);
        if (refreshed && refreshed.stories.length > 0) {
          renderSheetContent(refreshed);
        } else {
          closeSheet();
        }
        renderMarkers();
      }
    };
  });

  content.querySelector("#btn-add-story").onclick = () => {
    closeSheet();
    openComposer({
      lat: group.lat,
      lng: group.lng,
      placeName: group.placeName,
      placeId: group.stories[0]?.placeId || null,
    });
  };
}

function renderStoryItem(story) {
  const year = getStoryYear(story);
  const eyebrow = getStoryEyebrow(story, year);
  const tagsHtml = story.hashtags
    .map((t) => `<button class="hashtag-link" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`)
    .join(" ");
  const reacted = Storage.hasReacted(story.id);
  const shareUrl = buildStoryUrl(story.publicId);

  return `
    <div class="story-item">
      <p class="story-year">${year}</p>
      <p class="story-eyebrow">${eyebrow}</p>
      <p class="story-content">${escapeHtml(story.content)}</p>
      ${tagsHtml ? `<div class="story-tags">${tagsHtml}</div>` : ""}
      <p class="story-author">${escapeHtml(story.displayAuthorName || "익명")}</p>
      <div class="story-actions">
        <button class="reaction-btn ${reacted ? "reaction-btn--active" : ""}" data-id="${story.id}">
          <span class="dot-icon">${reacted ? "●" : "○"}</span>
          나도 이 기억이 떠올랐어요
        </button>
        <button class="share-btn" data-id="${story.id}" data-publicid="${story.publicId}" data-place="${escapeHtml(story.placeName || "")}">
          ↗ 기억 전달하기
        </button>
        <button class="report-link" data-id="${story.id}">이 기록 신고하기</button>
      </div>
    </div>
  `;
}

function getStoryYear(story) {
  if (story.dateMode === "past" && story.referenceDate) {
    return new Date(story.referenceDate).getFullYear();
  }
  if (story.dateMode === "now") {
    return new Date(story.createdAt).getFullYear();
  }
  return "· · ·"; // 기억나지 않음
}

function getStoryEyebrow(story, year) {
  const place = (story.placeName || "").toUpperCase();
  if (story.dateMode === "past" && story.referenceDate) {
    return `${year} · ${place}`.trim();
  }
  if (story.dateMode === "now") {
    return `NOW · ${place}`.trim();
  }
  return `기억나지 않음 · ${place}`.trim();
}

// ------------------------------------------------------------
// 기억 전달하기 (공유)
// ------------------------------------------------------------
function buildStoryUrl(publicId) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?story=${publicId}`;
}

async function handleShare(storyId, publicId, placeName) {
  const url = buildStoryUrl(publicId);
  const shareData = {
    title: "콘크리트 사피엔스 지도",
    text: `여기 이런 기억이 남아 있었어. ${placeName ? placeName + " · " : ""}`,
    url,
  };

  Storage.incrementShareCount(storyId);

  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch (e) {
      // 사용자가 공유를 취소한 경우 등 - 무시
    }
    return;
  }

  try {
    await navigator.clipboard.writeText(url);
    showShareToast("링크가 복사되었습니다.");
  } catch (e) {
    showShareToast("링크 복사에 실패했습니다.");
  }
}

// ------------------------------------------------------------
// 기억 남기기 (작성 화면)
// ------------------------------------------------------------
function openComposer(pin) {
  pendingPin = pin;
  const panel = document.getElementById("composer-panel");

  const whereHtml = pin.isFreePin
    ? `
      <input type="text" id="input-place-name" class="input-field" placeholder="이 장소에 이름을 붙여주세요 (선택)" maxlength="40" />
      <div class="field-address" id="composer-address-value">${escapeHtml(pin.address || "주소 확인 중...")}</div>
    `
    : `
      <div class="field-value">${escapeHtml(pin.placeName || "이름 없는 장소")}</div>
      ${pin.address ? `<div class="field-address">${escapeHtml(pin.address)}</div>` : ""}
    `;

  panel.innerHTML = `
    <h2 class="composer-title">기억 남기기</h2>

    <label class="field-label">WHERE</label>
    ${whereHtml}

    <label class="field-label">WHEN</label>
    <div class="date-mode-toggle">
      <button class="mode-btn" data-mode="now">지금</button>
      <button class="mode-btn" data-mode="past">과거</button>
      <button class="mode-btn mode-btn--active" data-mode="unknown">기억나지 않음</button>
    </div>
    <input type="date" id="input-refdate" class="input-field hidden" style="margin-top:8px;" max="${todayStr()}" />

    <label class="field-label">MEMORY</label>
    <textarea id="input-content" class="input-field textarea" maxlength="${CONFIG.MAX_CONTENT_LENGTH}" placeholder="이곳에 남아 있는 기억을 적어주세요."></textarea>
    <div class="char-count"><span id="char-count-num">0</span> / ${CONFIG.MAX_CONTENT_LENGTH}</div>

    <label class="field-label">NAME</label>
    <div class="author-mode-toggle">
      <button class="mode-btn mode-btn--active" data-author-mode="anonymous">익명</button>
      <button class="mode-btn" data-author-mode="custom">이름 또는 닉네임</button>
    </div>
    <input type="text" id="input-author" class="input-field hidden" style="margin-top:8px;" placeholder="이 기억을 어떤 이름으로 남길까요?" maxlength="30" />

    <button class="btn-primary" id="btn-submit">기억 남기기</button>
    <button class="btn-secondary" id="btn-cancel">취소</button>
  `;

  let dateMode = "unknown";
  let authorMode = "anonymous";

  panel.querySelector("#input-content").addEventListener("input", (e) => {
    document.getElementById("char-count-num").textContent = e.target.value.length;
  });

  panel.querySelectorAll(".date-mode-toggle .mode-btn").forEach((btn) => {
    btn.onclick = () => {
      dateMode = btn.dataset.mode;
      panel.querySelectorAll(".date-mode-toggle .mode-btn").forEach((b) => b.classList.remove("mode-btn--active"));
      btn.classList.add("mode-btn--active");
      document.getElementById("input-refdate").classList.toggle("hidden", dateMode !== "past");
    };
  });

  panel.querySelectorAll(".author-mode-toggle .mode-btn").forEach((btn) => {
    btn.onclick = () => {
      authorMode = btn.dataset.authorMode;
      panel.querySelectorAll(".author-mode-toggle .mode-btn").forEach((b) => b.classList.remove("mode-btn--active"));
      btn.classList.add("mode-btn--active");
      document.getElementById("input-author").classList.toggle("hidden", authorMode !== "custom");
    };
  });

  function resolvePlaceName() {
    if (pendingPin.isFreePin) {
      const nameInput = document.getElementById("input-place-name");
      const custom = nameInput ? nameInput.value.trim() : "";
      return custom || pendingPin.address || "이름 없는 곳";
    }
    return pendingPin.placeName || "이름 없는 곳";
  }

  document.getElementById("btn-cancel").onclick = closeComposer;

  document.getElementById("btn-submit").onclick = () => {
    const content = document.getElementById("input-content").value.trim();
    const authorInput = document.getElementById("input-author").value.trim();
    const refDateInput = document.getElementById("input-refdate").value;

    if (!content) {
      alert("기억을 적어주세요.");
      return;
    }
    if (dateMode === "past" && !refDateInput) {
      alert("기억의 시점을 선택해주세요.");
      return;
    }
    if (authorMode === "custom" && !authorInput) {
      alert("이름 또는 닉네임을 입력해주세요.");
      return;
    }

    const story = {
      id: crypto.randomUUID(),
      publicId: Storage.generatePublicId(),
      lat: pendingPin.lat,
      lng: pendingPin.lng,
      placeName: resolvePlaceName(),
      placeId: pendingPin.placeId,
      address: pendingPin.address || null,
      content,
      hashtags: extractHashtags(content),
      authorMode,
      displayAuthorName: authorMode === "custom" ? authorInput : "익명",
      dateMode,
      referenceDate: dateMode === "past" ? refDateInput : null,
      createdAt: new Date().toISOString(),
      reportCount: 0,
      status: "ACTIVE",
      reactionCount: 0,
      shareCount: 0,
    };

    Storage.saveStory(story);
    closeComposer();
    renderMarkers();
    map.setCenter(new kakao.maps.LatLng(story.lat, story.lng));

    const group = Storage.getGroupedByPlace().find(
      (g) => g.lat === story.lat && g.lng === story.lng
    );
    if (group) openSheet(group);
  };

  document.getElementById("composer-overlay").classList.remove("hidden");
}

function closeComposer() {
  document.getElementById("composer-overlay").classList.add("hidden");
  pendingPin = null;
}

function extractHashtags(text) {
  const matches = text.match(/#[^\s#]+/g);
  return matches ? [...new Set(matches)] : [];
}

// ------------------------------------------------------------
// 상단 검색 (카카오 장소 검색)
// ------------------------------------------------------------
function bindUIEvents() {
  document.getElementById("sheet-close").onclick = closeSheet;
  document.getElementById("sheet-backdrop").addEventListener("click", closeSheet);
  document.getElementById("composer-overlay").addEventListener("click", (e) => {
    if (e.target.id === "composer-overlay") closeComposer();
  });

  document.getElementById("btn-my-location").onclick = goToMyLocation;
  document.getElementById("btn-random").onclick = goToRandomStory;
  document.getElementById("fab-add").onclick = () => {
    const center = map.getCenter();
    startFreePinComposer(center.getLat(), center.getLng());
  };

  // ESC로 Bottom Sheet 닫기 (Desktop)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (sheetOpen) closeSheet();
      else if (!document.getElementById("composer-overlay").classList.contains("hidden")) closeComposer();
    }
  });

  // Swipe Down으로 Bottom Sheet 닫기 (Mobile)
  let touchStartY = null;
  const handleRow = document.getElementById("sheet-handle-row");
  handleRow.addEventListener("touchstart", (e) => {
    touchStartY = e.touches[0].clientY;
  });
  handleRow.addEventListener("touchend", (e) => {
    if (touchStartY === null) return;
    const diff = e.changedTouches[0].clientY - touchStartY;
    if (diff > 50) closeSheet();
    touchStartY = null;
  });

  const searchInput = document.getElementById("search-input");
  const searchResults = document.getElementById("search-results");

  document.getElementById("search-btn").onclick = () => runSearch();
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });

  function runSearch() {
    const keyword = searchInput.value.trim();
    if (!keyword) return;

    placesService.keywordSearch(keyword, (data, status) => {
      if (status !== kakao.maps.services.Status.OK) {
        searchResults.innerHTML = `<li class="search-empty">검색 결과가 없습니다.</li>`;
        searchResults.classList.remove("hidden");
        return;
      }

      searchResults.innerHTML = data
        .slice(0, 6)
        .map(
          (place) => `
        <li class="search-result-item" data-lat="${place.y}" data-lng="${place.x}" data-name="${escapeHtml(place.place_name)}" data-id="${place.id}" data-address="${escapeHtml(place.road_address_name || place.address_name || "")}">
          <strong>${escapeHtml(place.place_name)}</strong>
          <span>${escapeHtml(place.road_address_name || place.address_name)}</span>
        </li>
      `
        )
        .join("");
      searchResults.classList.remove("hidden");

      searchResults.querySelectorAll(".search-result-item").forEach((item) => {
        item.onclick = () => {
          const lat = parseFloat(item.dataset.lat);
          const lng = parseFloat(item.dataset.lng);
          map.setCenter(new kakao.maps.LatLng(lat, lng));
          map.setLevel(4);
          searchResults.classList.add("hidden");
          searchInput.value = "";

          openComposer({
            lat,
            lng,
            placeName: item.dataset.name,
            placeId: item.dataset.id,
            address: item.dataset.address || null,
            isFreePin: false,
          });
        };
      });
    });
  }
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

function goToRandomStory() {
  const story = Storage.getRandomStory();
  if (!story) {
    alert("아직 등록된 기억이 없습니다.");
    return;
  }
  map.setLevel(5);
  map.panTo(new kakao.maps.LatLng(story.lat, story.lng));
  highlightMarkerForStory(story);
}

// ------------------------------------------------------------
// 유틸
// ------------------------------------------------------------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

window.startConcreteSapiensApp = function () {
  kakao.maps.load(initApp);
};
