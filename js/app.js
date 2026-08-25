// ============================================================
// 콘크리트 사피엔스 지도 — 앱 부트스트랩 / 진입 흐름 / 전역 UI 이벤트
// 지도·마커는 map.js, 작성폼은 composer.js, 이야기 열람은 storySheet.js,
// 해시태그/연도/시간슬라이더는 filters.js, 검색은 search.js로 분리되어
// 있다. 이 파일은 그 조각들을 엮는 core.
// ============================================================

async function initApp() {
  // 유튜브 IFrame Player API를 가장 먼저 받아둔다(fire-and-forget) — 사용자가
  // 실제로 재생을 누를 때쯤엔 이미 로드가 끝나 있어야 그 탭과 같은 이벤트
  // 틱 안에서 동기적으로 재생을 시작할 수 있다(storySheet.js
  // playMiniPlayerVideo 설명 참고, 모바일 소리 없는 자동재생 문제 대응).
  // Storage.init/Auth.init의 await 뒤로 미뤄두면 그 네트워크 호출이 느린
  // 모바일 환경에서 API 로딩 시작 자체가 함께 밀려, 사용자가 지도 진입
  // 직후 바로 곡을 누르면 아직 로딩 중이라 재생이 막히는 경우가 있었다
  // (2026-08-20 확인) — 다른 초기화와 병렬로 최대한 일찍 시작한다.
  loadYoutubeIframeApi();
  initFadeScrollbars();
  await Storage.init();
  await Auth.init();
  Storage.logPageView(new URLSearchParams(window.location.search).get("story"));
  logVisitKind();
  initMap();
  bindUIEvents();
  renderHashtagChips();
  renderMarkers();
  renderTotalCountBanner();
  handleInitialEntry();
  maybeShowWelcomeOverlay();
  maybeShowTitleCard();
}

// 브라우저당 한 번만 보여주는 첫 방문 환영 모달(2026-08-21) — 초대
// 링크로 들어온 사람이 지도만 덩그러니 보고 "이게 뭐 하는 서비스지?"부터
// 시작하는 문제. 공유 링크(?story=/?place=)로 들어온 경우는 공유받은
// 카드를 먼저 보여주는 게 맞아서 진입 즉시 띄우진 않되, 그 카드를 스스로
// 닫는 순간(storySheet.js closeSheetToUnfiltered → maybeShowPendingWelcomeOverlay)
// 띄운다 — 예전엔 여기서 그냥 건너뛰어서, 공유 링크로 들어온(=가장 유력한
// 신규 유입 경로인) 사람이 설명을 영영 못 받는 경우가 있었다(2026-08-23).
const WELCOME_SEEN_KEY = "concrete_sapiens_welcome_seen_v1";
let pendingWelcomeOnSheetClose = false;

function maybeShowWelcomeOverlay() {
  if (localStorage.getItem(WELCOME_SEEN_KEY)) return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("story") || params.get("place")) {
    pendingWelcomeOnSheetClose = true;
    return;
  }
  showWelcomeOverlay();
}

/** closeSheetToUnfiltered가 카드를 닫을 때마다 호출 — 대기 중인 웰컴이 없으면 즉시 반환. */
function maybeShowPendingWelcomeOverlay() {
  if (!pendingWelcomeOnSheetClose) return;
  pendingWelcomeOnSheetClose = false;
  if (localStorage.getItem(WELCOME_SEEN_KEY)) return;
  // 시트가 내려가는 슬라이드 트랜지션(--cs-transition-normal, 280ms)과
  // 겹쳐 보이지 않게 살짝 늦춘다.
  setTimeout(showWelcomeOverlay, 300);
}

function showWelcomeOverlay() {
  const panel = document.getElementById("welcome-panel");
  panel.innerHTML = `
    <div class="daily-prompt-header">
      <span class="daily-prompt-label"><span class="daily-prompt-dot"></span>콘크리트 사피엔스 프로젝트</span>
    </div>
    <p class="daily-prompt-quote">도시는 건물로 만들어지지만,<br>장소는 기억으로 만들어집니다.</p>
    <p class="daily-prompt-hint">사람들이 실제 장소에 남긴 기억들이 이 지도 위에 쌓여 있어요. <br class="welcome-hint-break">지도를 돌아다니며 낯선 기억을 발견하고, <br class="welcome-hint-break"><strong>당신의 기억도 이 자리에 남겨 보세요.</strong></p>
    <div class="daily-prompt-divider"></div>
    <button class="btn-primary" id="welcome-confirm">둘러보기 시작</button>
    <button class="btn-secondary" id="welcome-write-btn">내 위치에 기억 남기기</button>
  `;
  panel.querySelector("#welcome-confirm").onclick = closeWelcomeOverlay;
  panel.querySelector("#welcome-write-btn").onclick = handleWelcomeWriteClick;
  document.getElementById("welcome-overlay").classList.remove("hidden");
  Storage.logEvent("welcome_shown");
}

function closeWelcomeOverlay() {
  localStorage.setItem(WELCOME_SEEN_KEY, "1");
  document.getElementById("welcome-overlay").classList.add("hidden");
}

/**
 * 웰컴 모달의 "내 위치에 기억 남기기" — 소비(둘러보기)만 유도하던 걸 보완해
 * 기여로 바로 이어지는 경로 하나를 덧붙인다(2026-08-23). 위치를 가져오는
 * 동안엔 모달을 유지하고, 성공했을 때만 닫고 작성폼(startFreePinComposer,
 * composer.js)으로 넘어간다 — 실패하면 그대로 남아 "둘러보기"로 돌아갈 수 있다.
 */
function handleWelcomeWriteClick() {
  Storage.logEvent("welcome_write_clicked");
  if (!navigator.geolocation) {
    alert("이 브라우저에서는 위치 정보를 사용할 수 없습니다.");
    return;
  }
  const btn = document.getElementById("welcome-write-btn");
  if (btn) btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      closeWelcomeOverlay();
      startFreePinComposer(pos.coords.latitude, pos.coords.longitude);
    },
    () => {
      if (btn) btn.disabled = false;
      alert("위치 정보를 가져올 수 없습니다. 위치 권한을 확인해주세요.");
    }
  );
}

/** 1회성 방문 로그와 별개로, "재방문"과 "첫 방문"을 로컬스토리지 플래그로만
 * 가볍게 구분해 AppEvent에 남긴다 — 실제 사용자 식별 없이 재방문율 근사치를
 * 보려는 목적(2026-08-23, 런칭 전 계측 보강). */
const VISITED_BEFORE_KEY = "concrete_sapiens_visited_before";

function logVisitKind() {
  const isReturning = !!localStorage.getItem(VISITED_BEFORE_KEY);
  Storage.logEvent(isReturning ? "visit_returning" : "visit_first");
  localStorage.setItem(VISITED_BEFORE_KEY, "1");
}

// 웰컴 모달은 브라우저당 한 번만 떠서, 그 이후 방문에는 "혹하게" 만들
// 장치가 없었다. 처음엔 하루 1번 뜨는 작은 카드(지도 구석)로 시도했는데
// (2026-08-25), 매일 들어오는 사람에게는 영화 오프닝 타이틀처럼 화면
// 전체를 짧게 채우는 장면이 더 강한 인상을 줄 거라는 판단으로 교체했다
// — 로고/버튼 없이 실제 기억 한 줄만 보여주고, 탭하거나 잠시 기다리면
// 그 장소로 카메라가 이동하며 카드가 열린다("근처 기억 발견 토스트"를
// 반복 노출 피로로 하루 만에 없앤 전례가 있어(project_nearby_discovery_
// toast_removed) 하루 1번 캡은 그대로 유지). 웰컴 모달을 이미 본
// 사람에게만 보여준다 — 진짜 첫 방문 당일엔 웰컴 모달 하나로 충분하니
// 그날은 겹치지 않게 건너뛴다.
const TITLE_CARD_LAST_SHOWN_KEY = "concrete_sapiens_title_card_last_shown";
const TITLE_CARD_AUTO_ADVANCE_MS = 3200;
let titleCardAdvanceTimer = null;

function todayDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ♡("떠올랐어요") 반응이 많은 상위 30개 중 랜덤으로 골라 "잘 쓰인" 글이
// 뽑힐 확률을 높인다(완전 무작위는 내용이 부실한 글이 뽑힐 위험) — 웰컴
// 모달과 타이틀 카드가 공유하는 선정 로직.
function pickFeaturedStory() {
  const stories = Storage.getVisibleStories();
  if (stories.length === 0) return null;
  const pool = [...stories].sort((a, b) => (b.reactionCount || 0) - (a.reactionCount || 0)).slice(0, 30);
  return pool[Math.floor(Math.random() * pool.length)];
}

function maybeShowTitleCard() {
  if (!localStorage.getItem(WELCOME_SEEN_KEY)) return;
  const params = new URLSearchParams(window.location.search);
  if (params.get("story") || params.get("place")) return; // 그날은 공유받은 카드가 우선
  if (localStorage.getItem(TITLE_CARD_LAST_SHOWN_KEY) === todayDateKey()) return;
  const story = pickFeaturedStory();
  if (!story) return;
  showTitleCard(story);
}

function showTitleCard(story) {
  const overlay = document.getElementById("title-card-overlay");
  const content = document.getElementById("title-card-content");
  if (!overlay || !content) return;

  const title = Storage.getGroupTitle({
    placeId: story.placeId,
    officialPlaceName: story.officialPlaceName,
    customName: story.customName,
    address: story.address,
  });
  const year = Storage.getStoryYear(story);

  content.innerHTML = `
    <p class="title-card-place">${escapeHtml(title)}${year !== null ? ` · ${year}` : ""}</p>
    <p class="title-card-quote">"${escapeHtml(story.content)}"</p>
    <p class="title-card-hint">탭하여 이 장소로</p>
  `;

  overlay.classList.remove("hidden", "title-card-overlay--out");
  // 열어보든 자동으로 넘어가든 "오늘은 봤다"로 친다.
  localStorage.setItem(TITLE_CARD_LAST_SHOWN_KEY, todayDateKey());
  Storage.logEvent("title_card_shown");

  const advance = () => {
    clearTimeout(titleCardAdvanceTimer);
    overlay.removeEventListener("click", advance);
    dismissTitleCard(story.id);
  };
  overlay.addEventListener("click", advance);
  titleCardAdvanceTimer = setTimeout(advance, TITLE_CARD_AUTO_ADVANCE_MS);
}

// 오버레이가 페이드아웃되는 동안 바로 그 장소로 카메라가 이동하며 카드가
// 열린다 — "타이틀이 사라지자 이미 그 장면"이 아니라 "타이틀이 사라지며
// 카메라가 그 장면으로 움직인다"는 쪽이 카카오맵 panTo의 자연스러운
// 애니메이션과 맞아서 더 매끄럽다.
function dismissTitleCard(storyId) {
  const overlay = document.getElementById("title-card-overlay");
  if (!overlay) return;
  overlay.classList.add("title-card-overlay--out");
  setTimeout(() => {
    overlay.classList.add("hidden");
    overlay.classList.remove("title-card-overlay--out");
  }, 380);
  navigateToStoryFromList(storyId);
}

function renderTotalCountBanner() {
  const el = document.getElementById("total-count-banner");
  if (!el) return;

  // searchAreaActive는 마커를 걸러내지 않고 반짝임 효과만 주는 상태라
  // 여기서는 제외한다 — 예전엔 여기 포함돼 있었는데, 검색 결과 카드에서
  // "다른 기억 둘러보기"/"내 기억으로 남기기"로 넘어가면 오버레이는
  // 사라져도 ✕를 눌러 명시적으로 닫기 전까진 searchAreaActive가 계속
  // true로 남아(search.js clearSearchArea 참고), 사용자는 검색한 걸
  // 잊은 채 정상 화면으로 돌아왔는데도 이 배너만 계속 숨어 있는 문제가
  // 있었다("가끔 없어져" 버그, 모바일에서 더 자주 검색을 쓰다 보니 눈에
  // 띔, 2026-08-17 확인).
  if (activeHashtagFilter || activeYearFilter !== null || activeSongFilter || sliderActive || myMemoryModeActive) {
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

const RECENT_ITEM_PIN_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.4-7-11.5A7 7 0 0 1 19 9.5C19 14.6 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.3"/></svg>`;
const RECENT_ITEM_NOTE_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>`;
const RECENT_ITEM_SEND_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>`;

// "지금까지 쌓인 기억"/"오늘의 기억"/"내 기억"(mymemory.js) 목록이 모두
// 공유하는 항목 카드(2026-08-20 디자인 레퍼런스 반영) — 연도를 굵게
// 강조하고, 장소/곡/공유를 한 줄 메타 정보로 내용 아래에 붙인다. 공유
// 아이콘은 눌러서 바로 공유창을 여는 대신 순수 장식이다 — 항목 자체가
// 이미 전체 클릭 영역(기억 카드로 이동)이라, 안에 또 다른 클릭 타깃을
// 심으면 "항목을 눌렀는데 공유가 뜨는" 혼선이 생긴다. 진짜 공유는 카드
// 상세(기억 카드)의 "기억 전하기" 버튼으로 안내한다.
// options.reactionCount는 "나를 떠올린 기억"(mymemory.js)에서만 넘어와,
// 몇 명이 반응했는지 짧게 덧붙인다.
function renderRecentListItem(story, options = {}) {
  const year = Storage.getStoryYear(story);
  const dateLabel = Storage.getStoryDateLabel(story);
  const title = Storage.getGroupTitle({
    placeId: story.placeId,
    officialPlaceName: story.officialPlaceName,
    customName: story.customName,
    address: story.address,
  });
  const musicLabel = story.musicTitle
    ? buildSongLabel({ artist: story.musicArtist, title: story.musicTitle })
    : "";
  const reactionCount = options.reactionCount || 0;

  return `
    <div class="recent-item" data-id="${story.id}">
      <div class="recent-item-date">
        <p class="recent-item-year">${year !== null ? year : "···"}<span class="recent-item-year-unit">${year !== null ? "년" : ""}</span></p>
        ${dateLabel ? `<p class="recent-item-month">${dateLabel}</p>` : ""}
      </div>
      <div class="recent-item-body">
        <p class="recent-item-content">${escapeHtml(story.content)}</p>
        <div class="recent-item-meta">
          <span class="recent-item-place">${RECENT_ITEM_PIN_SVG}${escapeHtml(title)}</span>
          ${musicLabel ? `<span class="recent-item-song">${RECENT_ITEM_NOTE_SVG}${escapeHtml(musicLabel)}</span>` : ""}
          <span class="recent-item-send">${RECENT_ITEM_SEND_SVG}</span>
        </div>
        ${reactionCount > 0 ? `<p class="recent-item-reaction">♡ ${reactionCount}명이 떠올랐어요</p>` : ""}
      </div>
    </div>
  `;
}

// renderItemFn은 호출부마다 다른 카드 마크업(요약 리스트 항목 vs 기억
// 카드 전체)을 그린다. cap은 호출부가 넘길 때만 적용되고, "시점 미상"
// (undated) 쪽에는 적용되지 않는다 — 아래로 계속 있다.
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
//
// 처음엔 50개만 보여주고 "더 불러오기"로 50개씩 더 연다(2026-08-20 —
// 예전엔 50개로 캡만 걸고 더 볼 방법이 없었는데, "전체 역사를 훑어보는"
// 화면 취지상 캡만 있고 탈출구가 없는 게 오히려 어색하다는 피드백).
// 오늘의 기억(todayVisibleCount)과 같은 패턴 — 정렬을 바꾸면 새 목록을
// 보는 셈이라 50으로 리셋하고, 카드 상세로 들어갔다 뒤로가기로 돌아올
// 때만 그 시점의 visibleCount를 이어받는다.
let recentSort = "timetravel-reverse";
let recentVisibleCount = 50;
const RECENT_LOAD_MORE_STEP = 50;

function openRecentMemoriesModal(opts = {}) {
  const panel = document.getElementById("recent-panel");
  const stories = Storage.getVisibleStories();
  recentVisibleCount = opts.visibleCount || 50;

  // buildSortedListHtml의 cap은 "시점 미상"엔 적용되지 않아 stories.length
  // 전체와 비교하면 "더 볼 게 있는지"를 틀리게 판단할 수 있다 — dated만
  // 따로 세어 정확히 비교한다.
  const { dated } = Storage.sortStoriesForDisplay(stories, recentSort);
  const hasMore = dated.length > recentVisibleCount;

  const listHtml = stories.length
    ? buildSortedListHtml(stories, recentSort, renderRecentListItem, { cap: recentVisibleCount })
    : `<p class="recent-empty">아직 등록된 기억이 없습니다.</p>`;

  panel.innerHTML = `
    <div class="recent-header">
      <h2 class="composer-title" style="margin:0;">지금까지 쌓인 기억</h2>
      <button class="recent-close" id="recent-close">✕</button>
    </div>
    ${stories.length > 1 ? SORT_TOGGLE_HTML(recentSort) : ""}
    ${listHtml}
    ${hasMore ? `<button class="recent-load-more" id="recent-load-more" type="button">더 불러오기 <span class="recent-load-more-chevron" aria-hidden="true">⌄</span></button>` : ""}
  `;

  panel.querySelector("#recent-close").onclick = closeRecentMemoriesModal;

  panel.querySelectorAll(".sort-btn").forEach((btn) => {
    btn.onclick = () => { recentSort = btn.dataset.sort; openRecentMemoriesModal({ visibleCount: 50 }); };
  });

  const loadMoreBtn = panel.querySelector("#recent-load-more");
  if (loadMoreBtn) {
    loadMoreBtn.onclick = () => {
      const scrollTop = panel.scrollTop;
      openRecentMemoriesModal({ visibleCount: recentVisibleCount + RECENT_LOAD_MORE_STEP });
      panel.scrollTop = scrollTop;
    };
  }

  panel.querySelectorAll(".recent-item[data-id]").forEach((item) => {
    item.onclick = () => {
      const scrollTop = panel.scrollTop;
      closeRecentMemoriesModal();
      navigateToStoryFromList(item.dataset.id, { kind: "recent", scrollTop, visibleCount: recentVisibleCount, label: "지금까지 쌓인 기억" });
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
//
// 처음엔 5개만 보여주고 "더 불러오기"로 10개씩 더 연다(2026-08-20 디자인
// 레퍼런스 반영). todayVisibleCount는 opts.visibleCount로 넘기지 않으면
// 매번 5로 리셋된다 — 칩을 다시 눌러 새로 여는 경우가 이에 해당한다.
// 카드 상세로 들어갔다 뒤로가기(goBackFromSheet)로 돌아올 때만 그 시점의
// visibleCount를 이어받아, 더 불러온 상태가 스크롤 위치처럼 유지된다.
let todayVisibleCount = 5;
const TODAY_LOAD_MORE_STEP = 10;

function openTodayMemoriesModal(opts = {}) {
  const panel = document.getElementById("today-panel");
  const stories = Storage.getTodayStories();
  todayVisibleCount = opts.visibleCount || 5;

  const listHtml = stories.length
    ? buildSortedListHtml(stories, "latest", renderRecentListItem, { cap: todayVisibleCount })
    : `<p class="recent-empty">오늘 등록된 기억이 아직 없습니다.</p>`;
  const hasMore = stories.length > todayVisibleCount;

  panel.innerHTML = `
    <div class="recent-header">
      <div>
        <h2 class="composer-title" style="margin:0 0 4px;">오늘의 기억</h2>
        <p class="composer-subtitle" style="margin:0;">오늘 쌓인 기억들을 만나보세요</p>
      </div>
      <button class="recent-close" id="today-close" aria-label="닫기">✕</button>
    </div>
    ${listHtml}
    ${hasMore ? `<button class="recent-load-more" id="today-load-more" type="button">더 불러오기 <span class="recent-load-more-chevron" aria-hidden="true">⌄</span></button>` : ""}
  `;

  panel.querySelector("#today-close").onclick = closeTodayMemoriesModal;

  const loadMoreBtn = panel.querySelector("#today-load-more");
  if (loadMoreBtn) {
    loadMoreBtn.onclick = () => {
      const scrollTop = panel.scrollTop;
      openTodayMemoriesModal({ visibleCount: todayVisibleCount + TODAY_LOAD_MORE_STEP });
      panel.scrollTop = scrollTop;
    };
  }

  panel.querySelectorAll(".recent-item[data-id]").forEach((item) => {
    item.onclick = () => {
      const scrollTop = panel.scrollTop;
      closeTodayMemoriesModal();
      navigateToStoryFromList(item.dataset.id, { kind: "today", scrollTop, visibleCount: todayVisibleCount, label: "오늘의 기억" });
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
// 담는다 — { kind: "recent" }, { kind: "today" }, { kind: "searchNearby" },
// { kind: "sliderPeriod" } 또는
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
    openRecentMemoriesModal({ scrollTop: returnTo.scrollTop, visibleCount: returnTo.visibleCount });
  } else if (returnTo.kind === "today") {
    openTodayMemoriesModal({ scrollTop: returnTo.scrollTop, visibleCount: returnTo.visibleCount });
  } else if (returnTo.kind === "mymemory") {
    openMyMemoryList(returnTo.listKind, { scrollTop: returnTo.scrollTop });
  } else if (returnTo.kind === "searchNearby") {
    openNearbyMemoriesModal({ scrollTop: returnTo.scrollTop });
  } else if (returnTo.kind === "sliderPeriod") {
    openSliderPeriodModal({ scrollTop: returnTo.scrollTop });
  }
}

// ------------------------------------------------------------
// 최초 진입: 최근 이야기 랜덤 랜딩
// ------------------------------------------------------------
function handleInitialEntry() {
  const params = new URLSearchParams(window.location.search);
  const storyPublicId = params.get("story");
  const placeKey = params.get("place");

  if (storyPublicId) {
    const story = Storage.getStoryByPublicId(storyPublicId);
    if (story) {
      flyToStory(story, true);
      return;
    }
    showGoneState();
    return;
  }

  if (placeKey) {
    const group = Storage.getGroupByKey(placeKey);
    if (group && group.stories.length > 0) {
      flyToPlace(group);
      return;
    }
    showGoneState("이 장소의 기억은 더 이상<br />지도에 남아 있지 않습니다.");
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

// ?place= 딥링크 전용 — 특정 기억이 아니라 장소(스팟) 자체로 진입한다.
function flyToPlace(group) {
  map.setLevel(4);
  map.panTo(new kakao.maps.LatLng(group.lat, group.lng));
  highlightMarkerForStory(group.stories[0]);
  setTimeout(() => openSheet(group), 250);
}

/**
 * 특정 이야기가 속한 스팟을 찾되, 지금 활성화된 필터(해시태그/연도/노래)가
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
  if (activeSongFilter) {
    const songStoryIds = new Set(
      Storage.getStoriesForSong(activeSongFilter.artist, activeSongFilter.title).map((s) => s.id)
    );
    return { ...rawGroup, stories: rawGroup.stories.filter((s) => songStoryIds.has(s.id)) };
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

  // 다른 모드 전환(exploreHashtag/setYearFilter/exploreSameYear/
  // toggleSlider)은 전부 켜지기 전에 내 기억 모드를 끄는데, 여기만
  // 빠져있어서 "내 기억"을 켠 채로 "어딘가의 기억"을 누르면 두 버튼이
  // 동시에 활성 상태로 남는 버그가 있었다(2026-08-14).
  closeMyMemoryMode();
  renderMarkers();

  showToast("entry-toast", "어딘가에 남겨진 기억을 찾는 중…", 900);

  setTimeout(() => {
    document.getElementById("entry-toast").classList.remove("show");
    map.setLevel(5);
    map.panTo(new kakao.maps.LatLng(story.lat, story.lng));
    highlightMarkerForStory(story);

    setTimeout(() => {
      const group = buildFilteredGroupContainingStory(story.id);
      if (group && group.stories.length > 0) {
        openSheet(group);
      }
    }, 500);
  }, 650);
}

/**
 * 오버레이는 배경 클릭으로 닫는다. click 이벤트 하나만 보고 e.target이
 * 오버레이 자신인지만 확인하면, 패널 안(텍스트 입력창 등)에서 마우스를
 * 눌러 드래그로 텍스트를 선택하다가 오버레이 위에서 손을 놓아도 "배경
 * 클릭"으로 오인해 창이 꺼진다 — mousedown도 오버레이 자신에서 시작했을
 * 때만 닫게 해서 막는다(2026-08-19, "기억 카드 쓰다가 드래그로 텍스트
 * 선택하면 창이 꺼진다" 피드백).
 */
function bindOverlayClickToClose(overlayId, onClose) {
  const overlay = document.getElementById(overlayId);
  let downOnOverlay = false;
  overlay.addEventListener("mousedown", (e) => {
    downOnOverlay = e.target === overlay;
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && downOnOverlay) onClose();
  });
}

// ------------------------------------------------------------
// 전역 UI 이벤트 바인딩
// ------------------------------------------------------------
function bindUIEvents() {
  document.getElementById("sheet-close").onclick = closeSheetToUnfiltered;
  document.getElementById("sheet-backdrop").addEventListener("click", closeSheetToUnfiltered);
  document.getElementById("mini-player-pause").onclick = toggleMiniPlayerPause;
  document.getElementById("mini-player-stop").onclick = stopMiniPlayer;
  bindOverlayClickToClose("composer-overlay", closeComposer);
  document.getElementById("total-count-banner").onclick = () => openRecentMemoriesModal();
  bindOverlayClickToClose("recent-overlay", closeRecentMemoriesModal);
  bindOverlayClickToClose("today-overlay", closeTodayMemoriesModal);
  bindOverlayClickToClose("slider-period-overlay", closeSliderPeriodModal);
  bindOverlayClickToClose("daily-prompt-overlay", closeTodayMission);
  bindOverlayClickToClose("welcome-overlay", closeWelcomeOverlay);
  bindOverlayClickToClose("help-tour-overlay", closeHelpTour);
  document.getElementById("help-tour-btn").onclick = openHelpTour;
  bindOverlayClickToClose("changepw-overlay", closeChangePasswordPanel);
  // auth-overlay는 배경 클릭으로 안 닫는다 — 가입/인증 도중 실수로 바깥을
  // 눌러서 입력 중이던 내용이 날아가는 걸 막기 위함(명시적으로 취소
  // 버튼이나 ESC를 눌러야 닫힌다).
  bindAccountMenuEvents();
  bindRecallEvents();

  document.getElementById("btn-my-location").onclick = goToMyLocation;
  document.getElementById("btn-random").onclick = startMemoryRadio;
  document.getElementById("btn-timeslider").onclick = toggleSlider;
  document.getElementById("btn-my-memory").onclick = toggleMyMemoryMode;
  document.getElementById("time-slider-close").onclick = closeSlider;
  document.getElementById("time-slider-mode-cumulative").onclick = () => setSliderMode("cumulative");
  document.getElementById("time-slider-mode-exact").onclick = () => setSliderMode("exact");
  document.getElementById("time-slider-view-btn").onclick = () => openSliderPeriodModal();
  document.getElementById("time-slider-input").addEventListener("input", (e) => {
    sliderYear = parseInt(e.target.value, 10);
    updateSliderLabel();
    updateSliderInfoBox();
    updateSliderFillStyle();
    updateSliderValueLabel();
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
      else if (!document.getElementById("changepw-overlay").classList.contains("hidden")) closeChangePasswordPanel();
      else if (!document.getElementById("composer-overlay").classList.contains("hidden")) closeComposer();
      else if (!document.getElementById("recent-overlay").classList.contains("hidden")) closeRecentMemoriesModal();
      else if (!document.getElementById("today-overlay").classList.contains("hidden")) closeTodayMemoriesModal();
      else if (!document.getElementById("slider-period-overlay").classList.contains("hidden")) closeSliderPeriodModal();
      else if (!document.getElementById("daily-prompt-overlay").classList.contains("hidden")) closeTodayMission();
      else if (!document.getElementById("account-menu").classList.contains("hidden")) closeAccountMenu();
      else if (!document.getElementById("recall-choice-overlay").classList.contains("hidden")) closeRecallChoice();
      else if (recallSessionOpen) endRecallSession();
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
