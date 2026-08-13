// ============================================================
// 콘크리트 사피엔스 지도 — 앱 부트스트랩 / 진입 흐름 / 전역 UI 이벤트
// 지도·마커는 map.js, 작성폼은 composer.js, 이야기 열람은 storySheet.js,
// 해시태그/연도/시간슬라이더는 filters.js, 검색은 search.js, 백업은
// backup.js로 분리되어 있다. 이 파일은 그 조각들을 엮는 core.
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

  if (activeHashtagFilter || activeYearFilter !== null || sliderActive) {
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
// 최근 기억 목록 모달 — 배너 클릭 시 최신순으로 쭉 훑어볼 수 있다.
// 항목을 누르면 목록은 닫히고 지도 이동 + 기억 카드가 바로 열리며,
// 카드의 뒤로가기(←)를 누르면 스크롤 위치까지 복원해서 이 목록으로
// 돌아온다 (opts.scrollTop, goBackFromSheet 참고).
// ------------------------------------------------------------
function openRecentMemoriesModal(opts = {}) {
  const panel = document.getElementById("recent-panel");
  const recent = [...Storage.getVisibleStories()]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50);

  const listHtml = recent.length
    ? recent.map((story) => {
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
      }).join("")
    : `<p class="recent-empty">아직 등록된 기억이 없습니다.</p>`;

  panel.innerHTML = `
    <div class="recent-header">
      <h2 class="composer-title" style="margin:0;">최근 기억</h2>
      <button class="recent-close" id="recent-close">✕</button>
    </div>
    ${listHtml}
    <div class="backup-row">
      <button class="backup-link" id="btn-export-backup">⭳ 데이터 내보내기 (백업)</button>
      <button class="backup-link" id="btn-import-backup">⭱ 백업 파일 가져오기</button>
      <input type="file" id="import-file-input" accept="application/json" class="hidden" />
    </div>
  `;

  panel.querySelector("#recent-close").onclick = closeRecentMemoriesModal;
  panel.querySelector("#btn-export-backup").onclick = exportBackup;
  panel.querySelector("#btn-import-backup").onclick = () => {
    document.getElementById("import-file-input").click();
  };
  panel.querySelector("#import-file-input").addEventListener("change", handleImportFile);

  panel.querySelectorAll(".recent-item[data-id]").forEach((item) => {
    item.onclick = () => {
      const scrollTop = panel.scrollTop;
      closeRecentMemoriesModal();
      navigateToStoryFromList(item.dataset.id, { kind: "recent", scrollTop, label: "최근 기억" });
    };
  });

  document.getElementById("recent-overlay").classList.remove("hidden");
  if (opts.scrollTop) panel.scrollTop = opts.scrollTop;
}

function closeRecentMemoriesModal() {
  document.getElementById("recent-overlay").classList.add("hidden");
}

// ------------------------------------------------------------
// 목록(최근 기억 / 내 기억)에서 항목을 눌러 지도 이동 + 카드 오픈까지
// 한번에 처리하는 공용 흐름. returnTo는 카드의 뒤로가기(←)가 어느
// 목록을 어떤 스크롤 위치로 다시 열어야 하는지를 담는다 —
// { kind: "recent" } 또는 { kind: "mymemory", listKind: "posted"|"reacted"|"shared" }.
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
  } else if (returnTo.kind === "mymemory") {
    openMyMemoryList(returnTo.listKind, { scrollTop: returnTo.scrollTop });
  }
}

// 데이터 백업(내보내기/가져오기)은 js/backup.js로 분리됨 (exportBackup, handleImportFile)

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
  // auth-overlay는 배경 클릭으로 안 닫는다 — 가입/인증 도중 실수로 바깥을
  // 눌러서 입력 중이던 내용이 날아가는 걸 막기 위함(명시적으로 취소
  // 버튼이나 ESC를 눌러야 닫힌다).
  bindAccountMenuEvents();

  document.getElementById("btn-my-location").onclick = goToMyLocation;
  document.getElementById("btn-random").onclick = goToRandomStory;
  document.getElementById("btn-timeslider").onclick = toggleSlider;
  document.getElementById("time-slider-close").onclick = closeSlider;
  document.getElementById("time-slider-input").addEventListener("input", (e) => {
    sliderYear = parseInt(e.target.value, 10);
    updateSliderLabel();
    renderMarkers();
  });

  document.getElementById("fab-add").onclick = () => {
    const center = map.getCenter();
    requireLogin(() => startFreePinComposer(center.getLat(), center.getLng()));
  };

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
