// ============================================================
// 해시태그 / 연도 필터, 시간 슬라이더
// ============================================================

let activeHashtagFilter = null;
let activeYearFilter = null;
// { artist, title } | null — 해시태그/연도 필터와 상호 배타적으로 켜진다
// (exploreSong 참고). artist는 파싱 실패 시 null일 수 있다.
let activeSongFilter = null;
let sliderActive = false;
let sliderYear = null;
// "cumulative"(누적, ~이 해까지) | "exact"(이 해만) — toggleSlider가 열 때마다
// 누적으로 초기화한다(2026-08-18, 기존 기본 동작 유지).
let sliderMode = "cumulative";
let myMemoryModeActive = false;
// 로그인 계정으로 연결된(기기 무관) storyId 집합 — startMyMemoryMode가
// 켤 때 한 번 채워서 map.js renderMarkers()가 동기적으로 읽는다
// (mymemory.js의 "내가 남긴 기억"과 같은 이유, 2026-08-14).
let myMemoryAccountStoryIds = new Set();
// "오늘의 질문"에 확인을 누르면 여기 담아둔다 — 지도 중심 같은 임의
// 좌표로 바로 기억 남기기를 띄우면 나와 무관한 장소에 남기게 되는
// 문제가 있어(2026-08-14 논의), 대신 사용자가 다음에 지도를 클릭하거나
// 검색 결과를 고르는(=장소를 직접 정하는) 순간까지 기다렸다가 그
// 작성폼에 미리 채워 넣는다. map.js 클릭 핸들러/search.js 결과 클릭
// 둘 다 consumePendingDailyPrompt()를 거친다.
let pendingDailyPrompt = null;

function consumePendingDailyPrompt() {
  if (!pendingDailyPrompt) return "";
  const text = `${pendingDailyPrompt}\n`;
  pendingDailyPrompt = null;
  return text;
}

// ------------------------------------------------------------
// "이맘때 예전 기억" — 로그인한 유저가 이번 달(계절)에 해당하는 지난
// 기억을 남긴 적 있으면, 요일별 오늘의 미션 로테이션보다 우선해서
// "오늘의 미션" 칩/모달에 보여준다(2026-08-21). 이 서비스만 줄 수 있는
// 유일한 재방문 트리거라 일반 로테이션보다 우선순위를 둔다.
// 한 달에 한 번 "확인"할 때까지만 계속 노출하고(반복돼 보인다는 이유로
// "근처 기억 발견 토스트"를 뺐던 것과 같은 원칙, mymemory.js 참고),
// 확인하면 이번 달 안에는 다시 안 뜬다.
// ------------------------------------------------------------
const THROWBACK_SEEN_KEY = "concrete_sapiens_throwback_seen_month";

function _currentYearMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function markThrowbackSeenThisMonth() {
  localStorage.setItem(THROWBACK_SEEN_KEY, _currentYearMonth());
}

// 로그인 안 했거나, 이번 달에 이미 확인했거나, 해당하는 기억이 없으면
// null — 세 경우 모두 평소 "오늘의 미션" 로테이션으로 조용히 돌아간다.
function getEligibleThrowbackStory() {
  if (!Auth.getCurrentUser()) return null;
  if (localStorage.getItem(THROWBACK_SEEN_KEY) === _currentYearMonth()) return null;
  const myStories = Storage.getAllStories().filter((s) => Storage.isMyStory(s.id) && s.status !== "DELETED");
  return Storage.getThrowbackMemory(myStories);
}

// 모바일(기존 CSS 브레이크포인트 600px와 동일)에서는 해시태그/곡 칩이
// 너무 많아 여러 줄로 넘치는 게 부담스럽다는 피드백(2026-08-19) — 데스크톱
// 노출 개수(CONFIG.TOP_HASHTAG_LIMIT/TOP_SONG_LIMIT)와 별개로 좁은 화면만
// 3개로 줄이고, 나머지는 기존처럼 "더보기" 칩으로 빠진다.
const MOBILE_CHIP_LIMIT = 3;
function isMobileViewport() {
  return window.matchMedia("(max-width: 600px)").matches;
}

// ------------------------------------------------------------
// 해시태그 칩 렌더링 ("오늘의 기억"/"오늘의 미션" + 상위 N개 + 더보기)
// ------------------------------------------------------------
function renderHashtagChips() {
  const wrap = document.getElementById("hashtag-chips");
  const songWrap = document.getElementById("song-chips");
  wrap.innerHTML = "";
  songWrap.innerHTML = "";

  if (activeYearFilter !== null || activeHashtagFilter || activeSongFilter) {
    const label = activeYearFilter !== null
      ? `${activeYearFilter}년`
      : activeHashtagFilter
        ? activeHashtagFilter
        : `🎧 ${buildSongLabel(activeSongFilter)}`;
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
  // "이맘때 예전 기억"이 있으면 평소 로테이션 라벨 대신 이걸 먼저 보여준다
  // — 클릭했을 때 열리는 내용(openTodayMission)도 이 판단과 똑같은
  // 기준(getEligibleThrowbackStory)을 다시 거쳐서 라벨과 항상 일치한다.
  promptChip.textContent = getEligibleThrowbackStory() ? "이맘때 기억" : "오늘의 미션";
  promptChip.onclick = openTodayMission;
  wrap.appendChild(promptChip);

  // 모바일은 "오늘의 기억/미션" 다음 줄에 해시태그가 오길 원해서
  // (2026-08-20), flex-wrap이 폭에 따라 제멋대로 줄바꿈하지 않도록
  // flex-basis:100%짜리 빈 요소로 강제로 줄을 바꾼다. 데스크톱은 기존
  // 그대로 폭에 맞춰 자연스럽게 흐른다.
  if (isMobileViewport()) {
    const lineBreak = document.createElement("span");
    lineBreak.className = "hashtag-bar-break";
    lineBreak.setAttribute("aria-hidden", "true");
    wrap.appendChild(lineBreak);
  }

  const allTags = Storage.getAllHashtagsWithCounts();
  const tagLimit = isMobileViewport() ? MOBILE_CHIP_LIMIT : CONFIG.TOP_HASHTAG_LIMIT;
  const topTags = allTags.slice(0, tagLimit);
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

  // 해시태그 줄과 별도의 줄 — 곡 정보가 담긴 기억이 아직 없으면(자동 추출
  // 기능 이전 기억이 많음) 조용히 아무것도 안 보여준다, 해시태그처럼 빈
  // 칩까지 노출할 이유는 없다(2026-08-19).
  const allSongs = Storage.getAllSongsWithCounts();
  const songLimit = isMobileViewport() ? MOBILE_CHIP_LIMIT : CONFIG.TOP_SONG_LIMIT;
  const topSongs = allSongs.slice(0, songLimit);
  topSongs.forEach(({ artist, title }) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = `🎧 ${buildSongLabel({ artist, title })}`;
    chip.onclick = () => exploreSong(artist, title);
    songWrap.appendChild(chip);
  });

  if (allSongs.length > topSongs.length) {
    const moreSongChip = document.createElement("button");
    moreSongChip.className = "chip chip--more";
    moreSongChip.textContent = "🎧 더보기";
    moreSongChip.onclick = openAllSongsSheet;
    songWrap.appendChild(moreSongChip);
  }

  renderTotalCountBanner();
}

/**
 * 오늘의 미션 칩 클릭 — 요일별로 4종(질문/시간/장소/이번 주) 중 하나를
 * 같은 모달에 보여준다(2026-08-17, Storage.getTodayMissionType 참고).
 * 매일 같은 형식이면 설문조사처럼 지겨워진다는 이유로 도입 — "질문"만
 * 응답을 작성폼에 프리필하는 기존 흐름(pendingDailyPrompt)을 그대로
 * 쓰고, 나머지 3종은 눌렀을 때 그 연도/장소/기억으로 바로 데려간다.
 * 해당 종류를 보여줄 데이터가 없는 날(예: 이번 주 등록된 기억이 없는
 * 일요일)은 항상 답을 줄 수 있는 "질문"으로 조용히 대체한다.
 *
 * "이맘때 예전 기억"(throwback)이 있으면 이 요일별 로테이션보다 먼저
 * 확인해서 덮어쓴다(2026-08-21) — 개인화된 회고 콘텐츠가 일반 로테이션
 * 보다 훨씬 이 서비스다운 리마인더라 우선순위를 둔다.
 */
function openTodayMission() {
  const panel = document.getElementById("daily-prompt-panel");
  const throwbackStory = getEligibleThrowbackStory();
  let type = throwbackStory ? "throwback" : Storage.getTodayMissionType();
  // 확인(CTA) 여부와 무관하게 이 모달을 한 번 열어서 보여준 순간
  // "이번 달엔 확인했다"로 친다 — 클릭 안 하고 닫아도 칩이 매번 다시
  // "이맘때 기억"으로 뜨면서 은근히 신경 쓰이는 걸 막는다.
  if (throwbackStory) {
    markThrowbackSeenThisMonth();
    Storage.logEvent("throwback_opened");
  }

  let year = null, place = null, weekStory = null;
  if (type === "year") {
    year = Storage.getTodayMissionYear();
    if (year === null) type = "question";
  } else if (type === "place") {
    place = Storage.getTodayMissionPlace();
    if (!place) type = "question";
  } else if (type === "week") {
    weekStory = Storage.getWeekOldestStory();
    if (!weekStory) type = "question";
  }

  let label, bodyHtml, hintHtml, ctaLabel, onConfirm;

  if (type === "throwback") {
    const tYear = Storage.getStoryYear(throwbackStory);
    const tDateLabel = Storage.getStoryDateLabel(throwbackStory);
    const title = Storage.getGroupTitle({
      placeId: throwbackStory.placeId,
      officialPlaceName: throwbackStory.officialPlaceName,
      customName: throwbackStory.customName,
      address: throwbackStory.address,
    });
    const preview = throwbackStory.content.length > 60 ? `${throwbackStory.content.slice(0, 60)}…` : throwbackStory.content;
    label = "이맘때의 기억";
    bodyHtml = `<p class="daily-prompt-quote">${tYear}년 ${tDateLabel || ""}, 당신은<br>${escapeHtml(title)}에 이런 기억을 남겼어요.</p>`;
    hintHtml = `<p class="daily-prompt-hint">&ldquo;${escapeHtml(preview)}&rdquo;</p>`;
    ctaLabel = "다시 만나러 가기";
    onConfirm = () => {
      Storage.logEvent("throwback_confirmed");
      closeTodayMission();
      clearFilters();
      closeSlider();
      closeMyMemoryMode();
      flyToStory(throwbackStory, true);
    };
  } else if (type === "year") {
    label = "오늘의 시간";
    bodyHtml = `<p class="daily-prompt-quote">오늘은 ${year}년의 기억을<br>열어봅니다.</p>`;
    hintHtml = `<p class="daily-prompt-hint">그 해에 남겨진 기억들을 만나보세요.</p>`;
    ctaLabel = "그 해로 가기";
    onConfirm = () => {
      closeTodayMission();
      exploreSameYear(year, null);
    };
  } else if (type === "place") {
    const title = Storage.getGroupTitle(place);
    bodyHtml = `<p class="daily-prompt-quote">오늘은 ${escapeHtml(title)}에 남은<br>${place.stories.length}개의 기억을 만나보세요.</p>`;
    label = "오늘의 장소";
    hintHtml = `<p class="daily-prompt-hint">그 장소에 쌓인 기억들을 둘러보세요.</p>`;
    ctaLabel = "만나러 가기";
    onConfirm = () => {
      closeTodayMission();
      clearFilters();
      closeSlider();
      closeMyMemoryMode();
      flyToStory(place.stories[0], true);
    };
  } else if (type === "week") {
    const year2 = Storage.getStoryYear(weekStory);
    const title = Storage.getGroupTitle({
      placeId: weekStory.placeId,
      officialPlaceName: weekStory.officialPlaceName,
      customName: weekStory.customName,
      address: weekStory.address,
    });
    label = "이번 주의 기억";
    bodyHtml = `
      <p class="daily-prompt-hint" style="margin-bottom:6px;">이번 주 가장 오래된 기억</p>
      <p class="daily-prompt-quote">${year2} · ${escapeHtml(title)}</p>
    `;
    hintHtml = "";
    ctaLabel = "만나러 가기";
    onConfirm = () => {
      closeTodayMission();
      clearFilters();
      closeSlider();
      closeMyMemoryMode();
      flyToStory(weekStory, true);
    };
  } else {
    const prompt = Storage.getDailyPrompt();
    label = "오늘의 질문";
    bodyHtml = `<p class="daily-prompt-quote">&ldquo;${escapeHtml(prompt)}&rdquo;</p>`;
    hintHtml = `<p class="daily-prompt-hint">이 질문에 답한 기억을 남겨보세요.</p>`;
    ctaLabel = "확인";
    onConfirm = () => {
      pendingDailyPrompt = prompt;
      closeTodayMission();
      showToast("entry-toast", "지도에서 장소를 눌러 이 질문에 답해보세요", 3200);
    };
  }

  panel.innerHTML = `
    <div class="daily-prompt-header">
      <span class="daily-prompt-label"><span class="daily-prompt-dot"></span>${label}</span>
      <button class="daily-prompt-close" id="daily-prompt-close" aria-label="닫기">✕</button>
    </div>
    ${bodyHtml}
    ${hintHtml}
    <div class="daily-prompt-divider"></div>
    <button class="btn-primary" id="daily-prompt-confirm">${ctaLabel}</button>
  `;
  panel.querySelector("#daily-prompt-close").onclick = closeTodayMission;
  panel.querySelector("#daily-prompt-confirm").onclick = onConfirm;
  document.getElementById("daily-prompt-overlay").classList.remove("hidden");
}

function closeTodayMission() {
  document.getElementById("daily-prompt-overlay").classList.add("hidden");
}

/**
 * 해시태그 클릭 — 전국 필터를 걸어 지도 마커도 그 태그로 좁히고, 그 태그를
 * 가진 모든 기억을 한 목록(openHashtagSheet)으로 바로 보여준다.
 */
function exploreHashtag(tag) {
  activeHashtagFilter = tag;
  activeYearFilter = null;
  activeSongFilter = null;
  closeSlider();
  closeMyMemoryMode();
  renderHashtagChips();
  renderMarkers();
  openHashtagSheet(tag);
}

function setYearFilter(year) {
  activeYearFilter = year;
  activeHashtagFilter = null;
  activeSongFilter = null;
  closeSlider();
  closeMyMemoryMode();
  renderHashtagChips();
  renderMarkers();
}

function buildSongLabel(songFilter) {
  return songFilter.artist ? `${songFilter.artist} · ${songFilter.title}` : songFilter.title;
}

/**
 * 카드의 "이 노래와 함께 남겨진 기억" 배너 — exploreHashtag와 같은 패턴으로
 * 전국 필터를 걸어 지도 마커도 같은 곡으로 좁히고, 목록(openSongSheet)을 바로
 * 보여준다. 아티스트/곡명은 작성 시 사용자가 확인/수정한 값을 그대로 키로
 * 쓴다(Storage.normalizeSongKey로 대소문자/공백만 무시하고 비교).
 */
function exploreSong(artist, title) {
  activeSongFilter = { artist: artist || null, title };
  activeHashtagFilter = null;
  activeYearFilter = null;
  closeSlider();
  closeMyMemoryMode();
  renderHashtagChips();
  renderMarkers();
  openSongSheet(artist, title);
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
  activeSongFilter = null;
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
  activeSongFilter = null;
  renderHashtagChips();
  renderMarkers();
}

function renderFilterBanner() {
  const banner = document.getElementById("filter-banner");

  // 곡 필터는 위 칩("🎧 곡명 ✕")이 이미 지우기 역할을 하고, 곡이 재생
  // 중이면 바로 아래 미니 플레이어가 뜨기 때문에 별도 집계 배너가
  // 내용이 겹쳤다 — 곡 필터일 때만 이 배너를 숨긴다(2026-08-23 피드백).
  if (activeSongFilter) {
    banner.classList.add("hidden");
    return;
  }

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
  sliderMode = "cumulative";

  const input = document.getElementById("time-slider-input");
  input.min = range.min;
  input.max = range.max;
  input.value = range.max;
  updateSliderModeButtons();
  updateSliderLabel();
  updateSliderInfoBox();
  updateSliderFillStyle();
  updateSliderValueLabel();

  document.getElementById("time-slider-panel").classList.remove("hidden");
  renderMarkers();
  renderTotalCountBanner();
}

// 트랙 위 현재 값 — 썸 위치를 따라다니는 숫자 하나만 보여준다(2026-08-22
// 디자인 레퍼런스 반영, 기존 min~max 여러 눈금 줄은 모바일에서 패널이
// 너무 커져 기억 라디오 버튼과 겹치는 문제로 걷어냈다). 양 끝 근처에서는
// 텍스트가 트랙 밖으로 잘리지 않도록 정렬 기준을 바꾼다.
function updateSliderValueLabel() {
  const label = document.getElementById("time-slider-value");
  const input = document.getElementById("time-slider-input");
  if (!label || !input) return;
  const min = Number(input.min);
  const max = Number(input.max);
  const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 100;
  label.textContent = input.value;
  label.style.left = `${pct}%`;
  label.style.transform = pct < 8 ? "translateX(0)" : pct > 92 ? "translateX(-100%)" : "translateX(-50%)";
}

function closeSlider() {
  sliderActive = false;
  sliderYear = null;
  document.getElementById("time-slider-panel").classList.add("hidden");
  renderTotalCountBanner();
}

function setSliderMode(mode) {
  if (sliderMode === mode) return;
  sliderMode = mode;
  updateSliderModeButtons();
  updateSliderLabel();
  updateSliderInfoBox();
  renderMarkers();
}

function updateSliderModeButtons() {
  document.getElementById("time-slider-mode-cumulative").classList.toggle("time-slider-mode-btn--active", sliderMode === "cumulative");
  document.getElementById("time-slider-mode-exact").classList.toggle("time-slider-mode-btn--active", sliderMode === "exact");
}

// 현재 슬라이더 값/모드에 맞는 기억 개수 — map.js renderMarkers의 필터
// 조건과 동일한 기준(누적: null 포함 y<=sliderYear, 이 해만: y===sliderYear)
// 으로 센다. 목록은 getSliderMatchStories 참고.
function getSliderMatchCount() {
  return getSliderMatchStories().length;
}

function updateSliderInfoBox() {
  const box = document.getElementById("time-slider-info");
  if (!box || sliderYear === null) return;
  const count = getSliderMatchCount();
  const desc = sliderMode === "exact" ? `${sliderYear}년의 기억은` : `${sliderYear}년까지의 기억은`;
  box.innerHTML = `<span class="time-slider-info-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.6c.6.5 1 1.3 1 2.4h6c0-1.1.4-1.9 1-2.4A7 7 0 0 0 12 2z"/></svg></span><span>${desc} <span class="time-slider-info-count">${count.toLocaleString()}개</span> 입니다.</span>`;
  box.classList.toggle("visible", count > 0);
}

// 슬라이더 트랙의 채워진(주황) 구간 % — css/style.css의 .time-slider-input이
// 이 값을 --slider-fill-pct로 읽어 그라디언트를 그린다(네이티브 range는
// 진행률을 자체적으로 그려주지 않는다).
function updateSliderFillStyle() {
  const input = document.getElementById("time-slider-input");
  const min = Number(input.min);
  const max = Number(input.max);
  const pct = max > min ? ((Number(input.value) - min) / (max - min)) * 100 : 100;
  input.style.setProperty("--slider-fill-pct", `${pct}%`);
}

// ------------------------------------------------------------
// 내 기억 — 내가 남긴 기억만 지도에 남기고, 전부 "불이 들어온" 것처럼
// 환하게 밝혀서 보여준다(2026-08-13, 리텐션 아이디어 논의 결과 —
// 처음엔 시간순으로 점선을 이었는데 지하철 노선도 같다는 피드백으로
// 걷어내고 밝기 강조만 남김, map.js renderMarkers 참고). 다른
// 필터/시간슬라이더와는 동시에 켜지지 않는다 — 이 모드를 켤 때
// 그것들을 끄고, 그것들을 켤 때 이 모드를 끈다(위
// exploreHashtag/setYearFilter/exploreSameYear/toggleSlider 참고).
//
// 오직 계정(StoryAuthor)만 본다 — 브라우저 기기ID는 절대 안 쓴다
// (2026-08-14). 로그인 안 한 상태로 누르면 requireLogin이 가입/로그인
// 화면부터 띄운다 — 팔로우할 계정이 없으면 애초에 "내 기억"이라는
// 개념이 성립하지 않는다.
// ------------------------------------------------------------
function toggleMyMemoryMode() {
  if (myMemoryModeActive) {
    closeMyMemoryMode();
    renderMarkers();
    return;
  }
  requireLogin(openRecallEntryChoice);
}

async function startMyMemoryMode() {
  clearFilters();
  closeSlider();
  myMemoryModeActive = true;
  document.getElementById("btn-my-memory").classList.add("tool-btn--active");

  // renderMarkers()가 매번 서버를 왕복하지 않도록 여기서 한 번만 조회해
  // 캐싱한다(다른 기기에서 쓴 글도 계정 연결로 포함된다).
  const myAuthorRecords = await Storage.listMyStoryAuthors();
  myMemoryAccountStoryIds = new Set(myAuthorRecords.map((r) => r.storyId));

  // 지도가 하늘로 쭉 올라가듯 64km 축척(레벨 13 — CONFIG.DEFAULT_LEVEL과
  // 같은 값, 카카오맵 레벨별 축척 표 기준) 까지 줌아웃한 뒤에 내 기억
  // 별만 켠다(2026-08-14). setLevel의 animate 옵션엔 완료 콜백이 없어서
  // duration만큼 기다렸다가 렌더링해 "다 올라간 다음에 켜지는" 순서를
  // 맞춘다.
  const ZOOM_OUT_DURATION = 700;
  map.setLevel(CONFIG.DEFAULT_LEVEL, { animate: { duration: ZOOM_OUT_DURATION } });
  setTimeout(() => {
    if (!myMemoryModeActive) return; // 애니메이션 도중 다시 꺼졌으면 무시
    renderMarkers();
    renderTotalCountBanner();
  }, ZOOM_OUT_DURATION);
}

function closeMyMemoryMode() {
  if (!myMemoryModeActive) return;
  myMemoryModeActive = false;
  document.getElementById("btn-my-memory").classList.remove("tool-btn--active");
  renderTotalCountBanner();
}

function getSliderPeriodTitle() {
  return sliderMode === "exact" ? `${sliderYear}년의 기억` : `~${sliderYear}년까지의 기억`;
}

function updateSliderLabel() {
  document.getElementById("time-slider-year-label").textContent = getSliderPeriodTitle();
}

// 현재 슬라이더 값/모드에 맞는 이야기 목록 — getSliderMatchCount와 같은
// 기준을 그대로 재사용한다.
function getSliderMatchStories() {
  return Storage.getVisibleStories().filter((s) => {
    const y = Storage.getStoryYear(s);
    if (sliderMode === "exact") return y === sliderYear;
    return y === null || y <= sliderYear;
  });
}

// "이 기간으로 보기" — 지금 슬라이더로 고른 기간(누적/이 해만)에 해당하는
// 기억들을 목록 모달로 훑어본다. "지금까지 쌓인 기억"(openRecentMemoriesModal,
// js/app.js)과 같은 패턴이지만 대상 목록만 다르다.
function openSliderPeriodModal(opts = {}) {
  if (!sliderActive || sliderYear === null) return;
  const panel = document.getElementById("slider-period-panel");
  const stories = getSliderMatchStories();
  const listHtml = stories.length
    ? buildSortedListHtml(stories, "timetravel-reverse", renderRecentListItem, { cap: 50 })
    : `<p class="recent-empty">이 기간에 남겨진 기억이 없습니다.</p>`;

  panel.innerHTML = `
    <div class="recent-header">
      <h2 class="composer-title" style="margin:0;">${escapeHtml(getSliderPeriodTitle())}</h2>
      <button class="recent-close" id="slider-period-close">✕</button>
    </div>
    ${listHtml}
  `;

  panel.querySelector("#slider-period-close").onclick = closeSliderPeriodModal;

  panel.querySelectorAll(".recent-item[data-id]").forEach((item) => {
    item.onclick = () => {
      const scrollTop = panel.scrollTop;
      closeSliderPeriodModal();
      navigateToStoryFromList(item.dataset.id, {
        kind: "sliderPeriod",
        scrollTop,
        label: getSliderPeriodTitle(),
      });
    };
  });

  document.getElementById("slider-period-overlay").classList.remove("hidden");
  panel.scrollTop = opts.scrollTop || 0;
}

function closeSliderPeriodModal() {
  document.getElementById("slider-period-overlay").classList.add("hidden");
}
