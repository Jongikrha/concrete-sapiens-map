// ============================================================
// 콘크리트 사피엔스 지도 — 메인 앱 로직
// v3: 시간연대표 / 같은 해의 기억 / 오늘의 기억 / 공유 카드 반영
// ============================================================

let map;
let clusterer;
let placesService;
let geocoderService;
let markers = []; // { marker, group }
let activeHashtagFilter = null;
let activeYearFilter = null;
let pendingPin = null;
let currentSort = "latest";
let highlightedMarker = null;
let sheetOpen = false;
let spotTimelineOpen = {}; // groupKey -> boolean
let spotTimelineFocusYear = {}; // groupKey -> year|null

// ------------------------------------------------------------
// Memory Dot 이미지 — 기억 수에 따라 크기 차등, 선택 시 Signal Orange
// ------------------------------------------------------------
function tierForCount(n) {
  if (n >= 10) return 3;
  if (n >= 2) return 2;
  return 1;
}

function makeDotImage(tier, selected) {
  const sizes = { 1: 12, 2: 16, 3: 20 };
  const size = selected ? sizes[tier] + 3 : sizes[tier];
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
// 클릭 스탬프 효과
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
// 최초 진입: 최근 이야기 랜덤 랜딩
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
    showGoneState();
    return;
  }

  const recent = Storage.getRandomRecentStory();
  const fallback = recent || Storage.getRandomStory();
  if (!fallback) return;

  flyToStory(fallback, false);
  showToast("entry-toast", "오늘 올라온 기억에서 시작했습니다", 3500);
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
    const prevEntry = markers.find((m) => m.marker === highlightedMarker);
    if (prevEntry) {
      highlightedMarker.setImage(makeDotImage(tierForCount(prevEntry.group.stories.length), false));
    }
  }
  entry.marker.setImage(makeDotImage(tierForCount(entry.group.stories.length), true));
  highlightedMarker = entry.marker;
}

function showToast(elId, text, duration) {
  const el = document.getElementById(elId);
  el.textContent = text;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), duration);
}

// ------------------------------------------------------------
// 어딘가의 기억 — 짧은 탐색 연출 후 부드럽게 착지
// ------------------------------------------------------------
function goToRandomStory() {
  const story = Storage.getRandomStory();
  if (!story) {
    alert("아직 등록된 기억이 없습니다.");
    return;
  }

  showToast("entry-toast", "어딘가에 남겨진 기억을 찾는 중…", 900);

  setTimeout(() => {
    document.getElementById("entry-toast").classList.remove("show");
    map.setLevel(5);
    map.panTo(new kakao.maps.LatLng(story.lat, story.lng));
    highlightMarkerForStory(story);

    setTimeout(() => {
      const year = Storage.getStoryYear(story);
      const label = year
        ? `${year} · ${story.placeName}`
        : `${story.placeName}`;
      showToast("entry-toast", label, 1400);
    }, 500);
  }, 650);
}

// ------------------------------------------------------------
// 마커 렌더링 (해시태그 또는 연도 필터 적용)
// ------------------------------------------------------------
function renderMarkers() {
  clusterer.clear();
  markers.forEach((m) => kakao.maps.event.removeListener(m.marker, "click"));
  markers = [];
  highlightedMarker = null;

  let groups = Storage.getGroupedByPlace();

  if (activeYearFilter !== null) {
    groups = groups
      .map((g) => ({
        ...g,
        stories: g.stories.filter((s) => Storage.getStoryYear(s) === activeYearFilter),
      }))
      .filter((g) => g.stories.length > 0);
  } else if (activeHashtagFilter) {
    groups = groups
      .map((g) => ({
        ...g,
        stories: g.stories.filter((s) => s.hashtags.includes(activeHashtagFilter)),
      }))
      .filter((g) => g.stories.length > 0);
  }

  const kakaoMarkers = [];

  groups.forEach((group) => {
    const tier = tierForCount(group.stories.length);
    const marker = new kakao.maps.Marker({
      position: new kakao.maps.LatLng(group.lat, group.lng),
      title: group.placeName,
      image: makeDotImage(tier, false),
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
// 해시태그 칩 렌더링 ("오늘의 기억" + 많이 쓰인 순 상위 N개)
// ------------------------------------------------------------
function renderHashtagChips() {
  const wrap = document.getElementById("hashtag-chips");
  wrap.innerHTML = "";

  if (activeYearFilter !== null || activeHashtagFilter) {
    const label = activeYearFilter !== null ? `${activeYearFilter}년` : activeHashtagFilter;
    const clearChip = document.createElement("button");
    clearChip.className = "chip chip--active";
    clearChip.textContent = `${label} ✕`;
    clearChip.onclick = clearFilters;
    wrap.appendChild(clearChip);
    renderFilterBanner();
    return;
  }

  document.getElementById("filter-banner").classList.add("hidden");

  const daily = Storage.getDailyFeaturedStory();
  if (daily) {
    const todayChip = document.createElement("button");
    todayChip.className = "chip chip--today";
    todayChip.textContent = "오늘의 기억";
    todayChip.onclick = () => flyToStory(daily, true);
    wrap.appendChild(todayChip);
  }

  const topTags = Storage.getTopHashtags(CONFIG.TOP_HASHTAG_LIMIT);
  topTags.forEach((tag) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = tag;
    chip.onclick = () => setHashtagFilter(tag);
    wrap.appendChild(chip);
  });
}

function setHashtagFilter(tag) {
  activeHashtagFilter = tag;
  activeYearFilter = null;
  renderHashtagChips();
  renderMarkers();
}

function setYearFilter(year) {
  activeYearFilter = year;
  activeHashtagFilter = null;
  renderHashtagChips();
  renderMarkers();
}

function clearFilters() {
  activeHashtagFilter = null;
  activeYearFilter = null;
  renderHashtagChips();
  renderMarkers();
}

function renderFilterBanner() {
  const banner = document.getElementById("filter-banner");
  let text = "";

  if (activeYearFilter !== null) {
    const count = Storage.getStoriesByYear(activeYearFilter).length;
    text = `${activeYearFilter}년, 대한민국에 남겨진 기억 ${count.toLocaleString()}개`;
  } else if (activeHashtagFilter) {
    const count = Storage.getHashtagCount(activeHashtagFilter);
    text = `대한민국에 남겨진 ${activeHashtagFilter} 기억 ${count.toLocaleString()}개`;
  }

  banner.innerHTML = `<span>${escapeHtml(text)}</span><button class="filter-banner-clear" id="filter-banner-clear">지우기 ✕</button>`;
  banner.classList.remove("hidden");
  document.getElementById("filter-banner-clear").onclick = clearFilters;
}

// ------------------------------------------------------------
// Bottom Sheet — 이야기 열람
// ------------------------------------------------------------
function openSheet(group) {
  currentSort = "latest";
  spotTimelineOpen[group.key] = false;
  spotTimelineFocusYear[group.key] = null;
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

  let displayStories = group.stories;
  const focusYear = spotTimelineFocusYear[group.key];
  if (focusYear !== null && focusYear !== undefined) {
    displayStories = group.stories.filter((s) => Storage.getStoryYear(s) === focusYear);
  }

  const sorted = [...displayStories].sort((a, b) => {
    if (currentSort === "latest") {
      return new Date(b.createdAt) - new Date(a.createdAt);
    }
    const da = a.referenceDate ? new Date(a.referenceDate) : new Date(8640000000000000);
    const db = b.referenceDate ? new Date(b.referenceDate) : new Date(8640000000000000);
    return da - db;
  });

  const distinctYears = [...new Set(
    group.stories.map((s) => Storage.getStoryYear(s)).filter((y) => y !== null)
  )].sort((a, b) => a - b);

  const isTimelineOpen = !!spotTimelineOpen[group.key];
  const spotCountLabel = group.stories.length > 1
    ? `이곳에 ${group.stories.length}개의 기억이 쌓여 있습니다`
    : `${group.stories.length}개의 기억`;

  const timelineHtml = isTimelineOpen && distinctYears.length > 0
    ? `
      <div class="spot-timeline">
        <button class="timeline-pill ${focusYear === null || focusYear === undefined ? "timeline-pill--active" : ""}" data-year="">전체</button>
        ${distinctYears.map((y) => `<button class="timeline-pill ${focusYear === y ? "timeline-pill--active" : ""}" data-year="${y}">${y}</button>`).join("")}
      </div>
    `
    : "";

  content.innerHTML = `
    <div class="story-spot-header">
      <div>
        <div class="story-spot-name">${escapeHtml(group.placeName || "이름 없는 곳")}</div>
        ${group.address ? `<div class="story-spot-address">${escapeHtml(group.address)}</div>` : ""}
      </div>
      <span class="story-spot-count">${group.stories.length}개의 기억</span>
    </div>
    <div class="sort-toggle">
      <button class="sort-btn ${currentSort === "latest" ? "sort-btn--active" : ""}" data-sort="latest">최신순</button>
      <button class="sort-btn ${currentSort === "timetravel" ? "sort-btn--active" : ""}" data-sort="timetravel">시간여행순</button>
    </div>
    <div class="story-list">
      ${sorted.map(renderStoryItem).join("")}
    </div>
    ${distinctYears.length > 1 ? `<button class="spot-timeline-toggle" id="spot-timeline-toggle">${isTimelineOpen ? "시간연대표 접기" : spotCountLabel + " · 연대표 보기"} →</button>` : ""}
    ${timelineHtml}
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
      closeSheet();
      setHashtagFilter(link.dataset.tag);
    };
  });

  content.querySelectorAll(".year-explore-link").forEach((link) => {
    link.onclick = () => {
      closeSheet();
      setYearFilter(parseInt(link.dataset.year, 10));
    };
  });

  content.querySelectorAll(".reaction-btn").forEach((btn) => {
    btn.onclick = () => {
      Storage.toggleReaction(btn.dataset.id);
      renderSheetContent(group);
    };
  });

  content.querySelectorAll(".share-btn").forEach((btn) => {
    btn.onclick = () => handleShare(btn.dataset.id);
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

  const timelineToggle = content.querySelector("#spot-timeline-toggle");
  if (timelineToggle) {
    timelineToggle.onclick = () => {
      spotTimelineOpen[group.key] = !spotTimelineOpen[group.key];
      renderSheetContent(group);
    };
  }

  content.querySelectorAll(".timeline-pill").forEach((pill) => {
    pill.onclick = () => {
      const y = pill.dataset.year;
      spotTimelineFocusYear[group.key] = y === "" ? null : parseInt(y, 10);
      renderSheetContent(group);
    };
  });

  content.querySelector("#btn-add-story").onclick = () => {
    closeSheet();
    openComposer({
      lat: group.lat,
      lng: group.lng,
      placeName: group.placeName,
      placeId: group.stories[0]?.placeId || null,
      address: group.address || null,
    });
  };
}

function renderStoryItem(story) {
  const year = getStoryYearLabel(story);
  const tagsHtml = story.hashtags
    .map((t) => `<button class="hashtag-link" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`)
    .join(" ");
  const reacted = Storage.hasReacted(story.id);
  const numericYear = Storage.getStoryYear(story);

  return `
    <div class="story-item">
      <p class="story-year">${year}</p>
      <p class="story-place-line">${escapeHtml(story.placeName || "")}</p>
      <p class="story-content">${escapeHtml(story.content)}</p>
      <p class="story-author">${escapeHtml(story.displayAuthorName || "익명")}</p>
      ${tagsHtml ? `<div class="story-tags">${tagsHtml}</div>` : ""}
      <div class="story-actions">
        <button class="reaction-btn ${reacted ? "reaction-btn--active" : ""}" data-id="${story.id}">
          <span class="dot-icon">${reacted ? "●" : "○"}</span>
          나도 이 기억이 떠올랐어요
        </button>
        <button class="share-btn share-btn--emphasized" data-id="${story.id}">
          ↗ 이 기억, 누군가에게 전달하기
        </button>
        <button class="report-link" data-id="${story.id}">이 기록 신고하기</button>
      </div>
      ${numericYear !== null ? `<button class="year-explore-link" data-year="${numericYear}">${numericYear}년의 다른 기억 둘러보기 →</button>` : ""}
    </div>
  `;
}

function getStoryYearLabel(story) {
  const y = Storage.getStoryYear(story);
  if (y !== null) return y;
  return "· · ·";
}

// ------------------------------------------------------------
// 기억 전달하기 — 공유 카드 이미지 생성 + Web Share API
// ------------------------------------------------------------
function buildStoryUrl(publicId) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?story=${publicId}`;
}

function wrapCanvasText(ctx, text, maxWidth) {
  const words = text.split("");
  const lines = [];
  let line = "";
  words.forEach((ch) => {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line = test;
    }
  });
  if (line) lines.push(line);
  return lines;
}

function generateShareCard(story) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#2F3031";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#FF5A36";
  ctx.beginPath();
  ctx.arc(90, 90, 10, 0, Math.PI * 2);
  ctx.fill();

  const year = Storage.getStoryYear(story);
  ctx.fillStyle = "#F4F3EF";
  ctx.font = "700 96px sans-serif";
  ctx.fillText(year !== null ? String(year) : "· · ·", 80, 220);

  ctx.font = "400 32px sans-serif";
  ctx.fillStyle = "#B9B9B5";
  ctx.fillText(story.placeName || "", 84, 270);

  ctx.font = "400 34px serif";
  ctx.fillStyle = "#F4F3EF";
  const lines = wrapCanvasText(ctx, `“${story.content}”`, 1020).slice(0, 5);
  lines.forEach((line, i) => {
    ctx.fillText(line, 84, 360 + i * 48);
  });

  ctx.font = "700 24px sans-serif";
  ctx.fillStyle = "#F4F3EF";
  ctx.fillText("CONCRETE SAPIENS", 84, 560);
  ctx.font = "400 20px sans-serif";
  ctx.fillStyle = "#B9B9B5";
  ctx.fillText("MEMORY MAP", 84, 588);

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/png");
  });
}

async function handleShare(storyId) {
  const story = Storage.getAllStories().find((s) => s.id === storyId);
  if (!story) return;

  const url = buildStoryUrl(story.publicId);
  const shareText = `여기 이런 기억이 남아 있었어.\n${story.placeName || ""}${Storage.getStoryYear(story) ? " · " + Storage.getStoryYear(story) : ""}`;

  Storage.incrementShareCount(storyId);

  try {
    const blob = await generateShareCard(story);
    const file = new File([blob], "concrete-sapiens-memory.png", { type: "image/png" });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title: "콘크리트 사피엔스 지도",
        text: shareText,
        url,
        files: [file],
      });
      return;
    }
  } catch (e) {
    // 카드 생성/공유 실패 시 아래 폴백으로 진행
  }

  if (navigator.share) {
    try {
      await navigator.share({ title: "콘크리트 사피엔스 지도", text: shareText, url });
      return;
    } catch (e) {
      // 취소 등 - 무시
      return;
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    showToast("share-toast", "링크가 복사되었습니다.", 2000);
  } catch (e) {
    showToast("share-toast", "링크 복사에 실패했습니다.", 2000);
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
// 상단 검색 (카카오 장소 검색) / 기타 UI 이벤트
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

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (sheetOpen) closeSheet();
      else if (!document.getElementById("composer-overlay").classList.contains("hidden")) closeComposer();
    }
  });

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
