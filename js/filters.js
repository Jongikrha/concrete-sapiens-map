// ============================================================
// 해시태그 / 연도 필터, 시간 슬라이더
// ============================================================

let activeHashtagFilter = null;
let activeYearFilter = null;
let sliderActive = false;
let sliderYear = null;

// ------------------------------------------------------------
// 해시태그 칩 렌더링 ("오늘의 기억" + "오늘의 질문" + 상위 N개)
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

  const promptChip = document.createElement("button");
  promptChip.className = "chip chip--prompt";
  promptChip.textContent = "오늘의 질문 ✉";
  promptChip.onclick = openDailyPrompt;
  wrap.appendChild(promptChip);

  const topTags = Storage.getTopHashtags(CONFIG.TOP_HASHTAG_LIMIT);
  topTags.forEach((tag) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = tag;
    chip.onclick = () => exploreHashtag(tag);
    wrap.appendChild(chip);
  });

  renderTotalCountBanner();
}

function openDailyPrompt() {
  const prompt = Storage.getDailyPrompt();
  const center = map.getCenter();
  if (confirm(`오늘의 질문\n\n"${prompt}"\n\n이 질문에 답하며 기억을 남겨볼까요?`)) {
    requireLogin(() => startFreePinComposer(center.getLat(), center.getLng(), `${prompt}\n`));
  }
}

/**
 * 해시태그 클릭 — 전국 필터를 걸어두는 데서 그치지 않고, 그 태그를 가진
 * 기억 중 하나로 바로 날아가 카드를 열어준다. "N년의 다른 기억
 * 둘러보기"와 동일한 문법으로, 눌렀을 때 즉각적인 보상을 준다.
 */
function exploreHashtag(tag, excludeStoryId) {
  closeSheet();
  activeHashtagFilter = tag;
  activeYearFilter = null;
  closeSlider();
  renderHashtagChips();
  renderMarkers();

  const all = Storage.getVisibleStories().filter((s) => (s.hashtags || []).includes(tag));
  const candidates = all.filter((s) => s.id !== excludeStoryId);
  const pool = candidates.length > 0 ? candidates : all;
  if (pool.length === 0) return;

  const target = pool[Math.floor(Math.random() * pool.length)];
  flyToStory(target, true);
}

function setYearFilter(year) {
  activeYearFilter = year;
  activeHashtagFilter = null;
  closeSlider();
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

function updateSliderLabel() {
  document.getElementById("time-slider-year-label").textContent = `~ ${sliderYear}년까지의 기억`;
}
