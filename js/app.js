// ============================================================
// 콘크리트 사피엔스 지도 — 앱 부트스트랩 / 진입 흐름 / 전역 UI 이벤트
// 지도·마커는 map.js, 작성폼은 composer.js, 이야기 열람은 storySheet.js,
// 해시태그/연도/시간슬라이더는 filters.js, 검색은 search.js로 분리되어
// 있다. 이 파일은 그 조각들을 엮는 core.
// ============================================================

async function initApp() {
  await Storage.init();
  await Auth.init();
  Storage.logPageView(new URLSearchParams(window.location.search).get("story"));
  initMap();
  bindUIEvents();
  renderHashtagChips();
  renderMarkers();
  renderTotalCountBanner();
  handleInitialEntry();
}

function renderTotalCountBanner() {
  const el = document.getElementById("total-count-banner");
  if (!el) return;

  if (activeHashtagFilter || activeYearFilter !== null || sliderActive || myMemoryModeActive) {
    el.classList.add("hidden");
    return;
  }

  const count = Storage.getVisibleStories().length;
  if (count === 0) {
    el.classList.add("hidden");
    return;
  }
  el.innerHTML = `<span class="total-count-num">${count.toLocaleString()}</span><span class="total-count-suffix">개의 기억이 쌓였습니다</span>`;
  el.classList.remove("hidden");
}

// ------------------------------------------------------------
// "지금까지 쌓인 기억"/"오늘의 기억" 목록 모달 — 배너/칩 클릭 시 훑어볼
// 수 있다. 정렬은 기억 카드(스팟/해시태그) 목록과 같은 3가지
// (Storage.sortStoriesForDisplay 참고)를 쓴다. 항목을 누르면 목록은
// 닫히고 지도 이동 + 기억 카드가 바로 열리며, 카드의 뒤로가기(←)를
// 누르면 스크롤 위치까지 복원해서 이 목록으로 돌아온다
// (opts.scrollTop, goBackFromSheet 참고).
// ------------------------------------------------------------
const SORT_TOGGLE_HTML = (activeSort) => `
  <div class="sort-toggle">
    <button class="sort-btn ${activeSort === "latest" ? "sort-btn--active" : ""}" data-sort="latest">최신 등록순</button>
    <button class="sort-btn ${activeSort === "timetravel" ? "sort-btn--active" : ""}" data-sort="timetravel">시간여행순</button>
    <button class="sort-btn ${activeSort === "timetravel-reverse" ? "sort-btn--active" : ""}" data-sort="timetravel-reverse">역시간여행순</button>
  </div>
`;

function renderRecentListItem(story) {
  const year = Storage.getStoryYear(story);
  const title = Storage.getGroupTitle({
    placeId: story.placeId,
    officialPlaceName: story.officialPlaceName,
    customName: story.customName,
    address: story.address,
  });
  return `
    <div class="recent-item" data-id="${story.id}">
      <p class="recent-item-year">${year !== null ? `${year}년` : "시점 미상"}</p>
      <p class="recent-item-content">${escapeHtml(story.content)}</p>
      <p class="recent-item-place">${escapeHtml(title)}</p>
    </div>
  `;
}

// renderItemFn은 호출부마다 다른 카드 마크업(요약 리스트 항목 vs 기억
// 카드 전체)을 그린다. cap은 호출부가 넘길 때만 적용(정렬 모드와
// 무관 — "지금까지 쌓인 기억"의 디폴트가 역시간여행순이 된 뒤로도
// 최대 50개 표시 관행은 그대로 유지해야 해서 정렬별 분기를 없앴다,
// 2026-08-14).
function buildSortedListHtml(stories, sortMode, renderItemFn, { cap } = {}) {
  const { dated, undated } = Storage.sortStoriesForDisplay(stories, sortMode);
  const shown = cap ? dated.slice(0, cap) : dated;
  let html = shown.map(renderItemFn).join("");
  if (undated.length > 0) {
    html += `<div class="timeline-section-label">시점을 알 수 없는 기억들</div>`;
    html += undated.map(renderItemFn).join("");
  }
  return html;
}

// 디폴트를 역시간여행순(현재→과거)으로 — "지금까지 쌓인 기억"이 오늘의
// 기억(실시간 피드)과 대비되는 "전체 역사를 훑어보는" 화면이라는
// 정체성에 맞춘다. 아득한 과거부터 던지기보다 최근 과거부터 보여주고
// 스크롤하며 더 옛날로 들어가는 편이 첫인상이 자연스럽다(2026-08-14).
let recentSort = "timetravel-reverse";

function openRecentMemoriesModal(opts = {}) {
  const panel = document.getElementById("recent-panel");
  const stories = Storage.getVisibleStories();

  const listHtml = stories.length
    ? buildSortedListHtml(stories, recentSort, renderRecentListItem, { cap: 50 })
    : `<p class="recent-empty">아직 등록된 기억이 없습니다.</p>`;

  panel.innerHTML = `
    <div class="recent-header">
      <h2 class="composer-title" style="margin:0;">지금까지 쌓인 기억</h2>
      <button class="recent-close" id="recent-close">✕</button>
    </div>
    ${stories.length > 1 ? SORT_TOGGLE_HTML(recentSort) : ""}
    ${listHtml}
  `;

  panel.querySelector("#recent-close").onclick = closeRecentMemoriesModal;

  panel.querySelectorAll(".sort-btn").forEach((btn) => {
    btn.onclick = () => { recentSort = btn.dataset.sort; openRecentMemoriesModal(); };
  });

  panel.querySelectorAll(".recent-item[data-id]").forEach((item) => {
    item.onclick = () => {
      const scrollTop = panel.scrollTop;
      closeRecentMemoriesModal();
      navigateToStoryFromList(item.dataset.id, { kind: "recent", scrollTop, label: "지금까지 쌓인 기억" });
    };
  });

  document.getElementById("recent-overlay").classList.remove("hidden");
  // 목록에서 기억을 보다가 뒤로 돌아온 경우(opts.scrollTop)에는 보던
  // 위치를 유지하고, 그 외에는 이전에 열었을 때 남은 스크롤 위치가
  // 이어지지 않도록 맨 위로 되돌린다.
  panel.scrollTop = opts.scrollTop || 0;
}

function closeRecentMemoriesModal() {
  document.getElementById("recent-overlay").classList.add("hidden");
}

// 오늘의 기억은 "지금까지 쌓인 기억"과 달리 정렬 토글을 두지 않는다 —
// 하루 안에서는 시간여행순/역시간여행순의 기준(연도·월)이 대부분 동률이라
// (dateMode:"now"면 다 올해) 실질적으로 순서가 안 바뀌는 죽은 옵션이
// 되기 때문. 초 단위까지 갈리는 등록 순서(latest)만 남겨 "지금 뭐가
// 올라오고 있나"에 집중한다(2026-08-14).
function openTodayMemoriesModal(opts = {}) {
  const panel = document.getElementById("today-panel");
  const stories = Storage.getTodayStories();

  const listHtml = stories.length
    ? buildSortedListHtml(stories, "latest", renderRecentListItem)
    : `<p class="recent-empty">오늘 등록된 기억이 아직 없습니다.</p>`;

  panel.innerHTML = `
    <div class="recent-header">
      <h2 class="composer-title" style="margin:0;">오늘의 기억</h2>
      <button class="recent-close" id="today-close">✕</button>
    </div>
    ${listHtml}
  `;

  panel.querySelector("#today-close").onclick = closeTodayMemoriesModal;

  panel.querySelectorAll(".recent-item[data-id]").forEach((item) => {
    item.onclick = () => {
      const scrollTop = panel.scrollTop;
      closeTodayMemoriesModal();
      navigateToStoryFromList(item.dataset.id, { kind: "today", scrollTop, label: "오늘의 기억" });
    };
  });

  document.getElementById("today-overlay").classList.remove("hidden");
  panel.scrollTop = opts.scrollTop || 0;
}

function closeTodayMemoriesModal() {
  document.getElementById("today-overlay").classList.add("hidden");
}

// ------------------------------------------------------------
// 목록(최근 기억 / 오늘의 기억 / 내 기억)에서 항목을 눌러 지도 이동 +
// 카드 오픈까지 한번에 처리하는 공용 흐름. returnTo는 카드의
// 뒤로가기(←)가 어느 목록을 어떤 스크롤 위치로 다시 열어야 하는지를
// 담는다 — { kind: "recent" }, { kind: "today" } 또는
// { kind: "mymemory", listKind: "posted"|"reacted"|"shared" }.
// ------------------------------------------------------------
function navigateToStoryFromList(storyId, returnTo) {
  const story = Storage.getAllStories().find((s) => s.id === storyId);
  if (!story) return;
  map.setLevel(4);
  map.panTo(new kakao.maps.LatLng(story.lat, story.lng));
  highlightMarkerForStory(story);
  const group = buildFilteredGroupContainingStory(story.id);
  if (group && group.stories.length > 0) {
    openSheet(group, { returnTo, highlightStoryId: story.id });
  }
}

function goBackFromSheet() {
  const returnTo = sheetReturnTo;
  closeSheet();
  if (!returnTo) return;
  if (returnTo.kind === "recent") {
    openRecentMemoriesModal({ scrollTop: returnTo.scrollTop });
  } else if (returnTo.kind === "today") {
    openTodayMemoriesModal({ scrollTop: returnTo.scrollTop });
  } else if (returnTo.kind === "mymemory") {
    openMyMemoryList(returnTo.listKind, { scrollTop: returnTo.scrollTop });
  }
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
    const group = buildFilteredGroupContainingStory(story.id);
    if (group && group.stories.length > 0) {
      setTimeout(() => openSheet(group), 250);
    }
  }
}

/**
 * 특정 이야기가 속한 스팟을 찾되, 지금 활성화된 필터(해시태그/연도)가
 * 있으면 그 필터에 맞는 이야기만 담아서 반환한다. 예를 들어 #첫사랑
 * 필터를 타고 이동했는데, 우연히 같은 좌표에 태그와 무관한 다른
 * 이야기가 함께 있다고 해서 그것까지 섞여 보이면 안 되기 때문이다.
 */
function buildFilteredGroupContainingStory(storyId) {
  const rawGroup = Storage.getGroupedByPlace().find((g) => g.stories.some((s) => s.id === storyId));
  if (!rawGroup) return null;
  return applyActiveFilterToGroup(rawGroup);
}

function applyActiveFilterToGroup(rawGroup) {
  if (activeYearFilter !== null) {
    return { ...rawGroup, stories: rawGroup.stories.filter((s) => Storage.getStoryYear(s) === activeYearFilter) };
  }
  if (activeHashtagFilter) {
    return { ...rawGroup, stories: rawGroup.stories.filter((s) => (s.hashtags || []).includes(activeHashtagFilter)) };
  }
  return rawGroup;
}

function showToast(elId, text, duration) {
  const el = document.getElementById(elId);
  el.textContent = text;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), duration);
}

// ------------------------------------------------------------
// 어딘가의 기억
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
      const title = Storage.getGroupTitle({
        placeId: story.placeId,
        officialPlaceName: story.officialPlaceName,
        customName: story.customName,
        address: story.address,
      });
      const label = year ? `${year} · ${title}` : title;
      showToast("entry-toast", label, 1400);
    }, 500);
  }, 650);
}

// ------------------------------------------------------------
// 전역 UI 이벤트 바인딩
// ------------------------------------------------------------
function bindUIEvents() {
  document.getElementById("sheet-close").onclick = closeSheetToUnfiltered;
  document.getElementById("sheet-backdrop").addEventListener("click", closeSheetToUnfiltered);
  document.getElementById("composer-overlay").addEventListener("click", (e) => {
    if (e.target.id === "composer-overlay") closeComposer();
  });
  document.getElementById("total-count-banner").onclick = () => openRecentMemoriesModal();
  document.getElementById("recent-overlay").addEventListener("click", (e) => {
    if (e.target.id === "recent-overlay") closeRecentMemoriesModal();
  });
  document.getElementById("today-overlay").addEventListener("click", (e) => {
    if (e.target.id === "today-overlay") closeTodayMemoriesModal();
  });
  document.getElementById("daily-prompt-overlay").addEventListener("click", (e) => {
    if (e.target.id === "daily-prompt-overlay") closeDailyPrompt();
  });
  // auth-overlay는 배경 클릭으로 안 닫는다 — 가입/인증 도중 실수로 바깥을
  // 눌러서 입력 중이던 내용이 날아가는 걸 막기 위함(명시적으로 취소
  // 버튼이나 ESC를 눌러야 닫힌다).
  bindAccountMenuEvents();

  document.getElementById("btn-my-location").onclick = goToMyLocation;
  document.getElementById("btn-random").onclick = goToRandomStory;
  document.getElementById("btn-timeslider").onclick = toggleSlider;
  document.getElementById("btn-my-memory").onclick = toggleMyMemoryMode;
  document.getElementById("time-slider-close").onclick = closeSlider;
  document.getElementById("time-slider-input").addEventListener("input", (e) => {
    sliderYear = parseInt(e.target.value, 10);
    updateSliderLabel();
    renderMarkers();
  });

  document.addEventListener("click", () => {
    document.querySelectorAll(".story-item-menu-dropdown").forEach((d) => d.classList.add("hidden"));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (sheetOpen) closeSheetToUnfiltered();
      else if (!document.getElementById("auth-overlay").classList.contains("hidden")) closeAuthOverlay();
      else if (!document.getElementById("mymemory-overlay").classList.contains("hidden")) closeMyMemoryList();
      else if (!document.getElementById("composer-overlay").classList.contains("hidden")) closeComposer();
      else if (!document.getElementById("recent-overlay").classList.contains("hidden")) closeRecentMemoriesModal();
      else if (!document.getElementById("today-overlay").classList.contains("hidden")) closeTodayMemoriesModal();
      else if (!document.getElementById("daily-prompt-overlay").classList.contains("hidden")) closeDailyPrompt();
      else if (!document.getElementById("account-menu").classList.contains("hidden")) closeAccountMenu();
    }
  });

  let touchStartY = null;
  const handleRow = document.getElementById("sheet-handle-row");
  handleRow.addEventListener("touchstart", (e) => { touchStartY = e.touches[0].clientY; });
  handleRow.addEventListener("touchend", (e) => {
    if (touchStartY === null) return;
    const diff = e.changedTouches[0].clientY - touchStartY;
    if (diff > 50) closeSheetToUnfiltered();
    touchStartY = null;
  });

  bindSearchEvents();
}

// ------------------------------------------------------------
// 유틸
// ------------------------------------------------------------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

window.startConcreteSapiensApp = function () {
  kakao.maps.load(initApp);
};
