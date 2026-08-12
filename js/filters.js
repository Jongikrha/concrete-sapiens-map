// ============================================================
// 해시태그 / 연도 필터, 시간 슬라이더
// ============================================================

let activeHashtagFilter = null;
let activeYearFilter = null;
let sliderActive = false;
let sliderYear = null;

// ------------------------------------------------------------
// 해시태그 칩 렌더링 ("오늘의 기억" + 상위 N개 + 더보기)
// "오늘의 질문"은 칩 사이에 묻히지 않도록 renderDailyPromptBanner로 분리.
// ------------------------------------------------------------
function renderHashtagChips() {
  renderDailyPromptBanner();

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

  const allTags = Storage.getAllHashtagsWithCounts();
  const topTags = allTags.slice(0, CONFIG.TOP_HASHTAG_LIMIT);
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
 * 오늘의 질문 배너 — 해시태그 칩(작은 라벨) 대신 실제 질문 문구를 그대로
 * 노출해서(더 감성적이고, 클릭 없이도 바로 읽힌다) 눈에 띄게 만든다.
 * 필터/시간슬라이더가 걸려 있을 땐 다른 오버레이 요소들과 마찬가지로 숨긴다.
 */
function renderDailyPromptBanner() {
  const el = document.getElementById("daily-prompt-banner");
  if (!el) return;

  if (activeHashtagFilter || activeYearFilter !== null || sliderActive) {
    el.classList.add("hidden");
    return;
  }

  const prompt = Storage.getDailyPrompt();
  el.innerHTML = `
    <span class="daily-prompt-eyebrow">오늘의 질문 ✉</span>
    <p class="daily-prompt-text">${escapeHtml(prompt)}</p>
  `;
  el.onclick = openDailyPrompt;
  el.classList.remove("hidden");
}

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
  renderHashtagChips();
  renderMarkers();
  openHashtagSheet(tag);
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
  renderDailyPromptBanner();
}

function closeSlider() {
  sliderActive = false;
  sliderYear = null;
  document.getElementById("time-slider-panel").classList.add("hidden");
  renderTotalCountBanner();
  renderDailyPromptBanner();
}

function updateSliderLabel() {
  document.getElementById("time-slider-year-label").textContent = `~ ${sliderYear}년까지의 기억`;
}
