// ============================================================
// 해시태그 / 연도 필터, 시간 슬라이더
// ============================================================

let activeHashtagFilter = null;
let activeYearFilter = null;
let sliderActive = false;
let sliderYear = null;
let myMemoryModeActive = false;

// ------------------------------------------------------------
// 해시태그 칩 렌더링 ("오늘의 기억"/"오늘의 질문" + 상위 N개 + 더보기)
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

  // 오늘 등록된 기억이 없어도 칩 자체는 계속 보여준다 — 눌렀을 때
  // 모달 안에서 "오늘 등록된 기억이 아직 없습니다"로 안내한다(비어
  // 있다고 칩까지 사라지면 기능이 없어진 것처럼 보인다는 피드백,
  // 2026-08-14).
  const todayChip = document.createElement("button");
  todayChip.className = "chip chip--today";
  todayChip.textContent = "오늘의 기억";
  todayChip.onclick = openTodayMemoriesModal;
  wrap.appendChild(todayChip);

  // "오늘의 기억" 바로 옆에 같은 칩 크기로 — 예전엔 별도 배너였는데
  // (2026-08-11 추가, 2026-08-12 제거), 해시태그 칩과 같은 자리/크기로
  // 색만 다르게 다시 살렸다(2026-08-14).
  const promptChip = document.createElement("button");
  promptChip.className = "chip chip--prompt";
  promptChip.textContent = "오늘의 질문";
  promptChip.onclick = openDailyPrompt;
  wrap.appendChild(promptChip);

  const allTags = Storage.getAllHashtagsWithCounts();
  // 모바일 화면(<=600px, 다른 반응형 분기와 동일 기준)에서는 칩이 너무
  // 많이 줄바꿈되지 않도록 20개 대신 10개만 먼저 보여주고 나머지는
  // "더보기"로 넘긴다(2026-08-13).
  const topLimit = window.innerWidth <= 600 ? 10 : CONFIG.TOP_HASHTAG_LIMIT;
  const topTags = allTags.slice(0, topLimit);
  topTags.forEach(({ tag }) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = tag;
    chip.onclick = () => exploreHashtag(tag);
    wrap.appendChild(chip);
  });

  if (allTags.length > topTags.length) {
    const moreChip = document.createElement("button");
    moreChip.className = "chip chip--more";
    moreChip.textContent = "더보기";
    moreChip.onclick = openAllTagsSheet;
    wrap.appendChild(moreChip);
  }

  renderTotalCountBanner();
}

/**
 * 오늘의 질문 칩 클릭 — 질문을 확인시키고, 동의하면 지금 보고 있는 지도
 * 중심에 그 질문을 본문 앞머리로 채운 자유 핀 작성폼을 띄운다.
 */
function openDailyPrompt() {
  const prompt = Storage.getDailyPrompt();
  const center = map.getCenter();
  if (confirm(`오늘의 질문\n\n"${prompt}"\n\n이 질문에 답하며 기억을 남겨볼까요?`)) {
    requireLogin(() => startFreePinComposer(center.getLat(), center.getLng(), `${prompt}\n`));
  }
}

/**
 * 해시태그 클릭 — 전국 필터를 걸어 지도 마커도 그 태그로 좁히고, 그 태그를
 * 가진 모든 기억을 한 목록(openHashtagSheet)으로 바로 보여준다.
 */
function exploreHashtag(tag) {
  activeHashtagFilter = tag;
  activeYearFilter = null;
  closeSlider();
  closeMyMemoryMode();
  renderHashtagChips();
  renderMarkers();
  openHashtagSheet(tag);
}

function setYearFilter(year) {
  activeYearFilter = year;
  activeHashtagFilter = null;
  closeSlider();
  closeMyMemoryMode();
  renderHashtagChips();
  renderMarkers();
}

/**
 * "N년의 다른 기억 둘러보기" — 전국 필터를 걸어두는 데서 그치지 않고,
 * 같은 해의 다른 기억으로 바로 날아가 카드를 열어준다 (같은 스팟에
 * 여러 개면 지금 보고 있는 이야기는 제외하고 고른다).
 */
function exploreSameYear(year, excludeStoryId) {
  closeSheet();
  activeYearFilter = year;
  activeHashtagFilter = null;
  closeSlider();
  closeMyMemoryMode();
  renderHashtagChips();
  renderMarkers();

  const sameYear = Storage.getStoriesByYear(year);
  const candidates = sameYear.filter((s) => s.id !== excludeStoryId);
  const pool = candidates.length > 0 ? candidates : sameYear;
  if (pool.length === 0) return;

  const target = pool[Math.floor(Math.random() * pool.length)];
  flyToStory(target, true);
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
// 시간 슬라이더 (누적 보기)
// ------------------------------------------------------------
function toggleSlider() {
  if (sliderActive) {
    closeSlider();
    return;
  }
  clearFilters();
  closeMyMemoryMode();
  const range = Storage.getYearRange();
  sliderActive = true;
  sliderYear = range.max;

  const input = document.getElementById("time-slider-input");
  input.min = range.min;
  input.max = range.max;
  input.value = range.max;
  updateSliderLabel();

  document.getElementById("time-slider-panel").classList.remove("hidden");
  renderMarkers();
  renderTotalCountBanner();
}

function closeSlider() {
  sliderActive = false;
  sliderYear = null;
  document.getElementById("time-slider-panel").classList.add("hidden");
  renderTotalCountBanner();
}

// ------------------------------------------------------------
// 내 기억 — 내가 남긴 기억만 지도에 남기고, 전부 "불이 들어온" 것처럼
// 환하게 밝혀서 보여준다(2026-08-13, 리텐션 아이디어 논의 결과 —
// 처음엔 시간순으로 점선을 이었는데 지하철 노선도 같다는 피드백으로
// 걷어내고 밝기 강조만 남김, map.js renderMarkers 참고). 다른
// 필터/시간슬라이더와는 동시에 켜지지 않는다 — 이 모드를 켤 때
// 그것들을 끄고, 그것들을 켤 때 이 모드를 끈다(위
// exploreHashtag/setYearFilter/exploreSameYear/toggleSlider 참고).
// ------------------------------------------------------------
function toggleMyMemoryMode() {
  if (myMemoryModeActive) {
    closeMyMemoryMode();
    renderMarkers();
    return;
  }
  clearFilters();
  closeSlider();
  myMemoryModeActive = true;
  document.getElementById("btn-my-memory").classList.add("tool-btn--active");
  renderMarkers();
  renderTotalCountBanner();
}

function closeMyMemoryMode() {
  if (!myMemoryModeActive) return;
  myMemoryModeActive = false;
  document.getElementById("btn-my-memory").classList.remove("tool-btn--active");
  renderTotalCountBanner();
}

function updateSliderLabel() {
  document.getElementById("time-slider-year-label").textContent = `~ ${sliderYear}년까지의 기억`;
}
