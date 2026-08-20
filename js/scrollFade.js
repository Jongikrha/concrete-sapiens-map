// ============================================================
// 스크롤 중에만 살짝 보이는 오버레이 스크롤바 — 서비스 전체 공통.
//
// 원래 각 스크롤 컨테이너(.composer-card-inner 등)에 얇은 알약형
// ::-webkit-scrollbar를 직접 그렸었는데(2026-08-14), 안드로이드 크롬 등
// 일부 환경에서 폭 지정이 무시되고 브라우저 자체 최소 두께로 그려지며
// 카드 둥근 모서리 밖으로 삐져나오는 문제가 있었다(2026-08-20 제보).
// 네이티브 스크롤바는 아예 숨기고, 대신 우리가 직접 그리는 얇은 썸
// 하나를 document에 하나만 띄워두고 스크롤이 일어난 컨테이너 위치에
// 맞춰 옮긴다 — 일반 DOM 엘리먼트라 플랫폼에 따라 두께가 달라지거나
// 모서리를 뚫고 나올 일이 없다.
//
// 컨테이너마다 각자 썸을 하나씩 붙이지 않고 공유 썸 하나로 처리하는
// 이유: 여러 컨테이너(오늘의 기억/내 기억/기억 카드 등)가 매번
// innerHTML로 통째로 다시 그려지는데(예: openTodayMemoriesModal),
// 컨테이너 자식으로 썸을 붙였다면 다시 그릴 때마다 같이 지워져서 매
// 렌더 함수마다 재부착 코드를 잊지 않고 넣어야 했을 것이다. 공유 썸은
// document.body에 한 번만 붙고 좌표만 옮겨 다니니 그 문제가 없다 —
// 어차피 이 앱에서 스크롤 가능한 요소가 동시에 두 개 이상 눈에 보이는
// 경우가 없어서(모달은 항상 하나만 열림) 공유해도 무방하다.
// ------------------------------------------------------------

const FADE_SCROLLBAR_SELECTOR =
  ".composer-card-inner, .sheet-scroll, .search-area-card-inner, .search-results, .recall-card, .bulk-prompt-box";
const FADE_SCROLLBAR_HIDE_DELAY_MS = 700;
const FADE_SCROLLBAR_MIN_THUMB_PX = 24;
const FADE_SCROLLBAR_INSET_PX = 6;

let fadeScrollbarThumbEl = null;
let fadeScrollbarHideTimer = null;

function initFadeScrollbars() {
  if (fadeScrollbarThumbEl) return;
  fadeScrollbarThumbEl = document.createElement("div");
  fadeScrollbarThumbEl.className = "fade-scrollbar-thumb";
  fadeScrollbarThumbEl.setAttribute("aria-hidden", "true");
  document.body.appendChild(fadeScrollbarThumbEl);

  // scroll 이벤트는 버블링하지 않는다 — document에 그냥 리스너를 달면
  // 하위 컨테이너의 스크롤을 못 받는다. 캡처 단계(3번째 인자 true)는
  // 이벤트가 대상까지 내려가는 길목의 모든 조상을 거치므로, document
  // 하나에 캡처 리스너를 달아두면 지금 있는 컨테이너든 나중에 새로
  // 생기는 컨테이너든(admin.js의 .bulk-prompt-box처럼 동적으로 그려지는
  // 경우 포함) 전부 별도 등록 없이 잡힌다.
  document.addEventListener("scroll", handleAnyScroll, true);
}

function handleAnyScroll(e) {
  const el = e.target;
  if (!(el instanceof Element) || !el.matches(FADE_SCROLLBAR_SELECTOR)) return;
  updateFadeScrollbarThumb(el);
}

function updateFadeScrollbarThumb(el) {
  const { scrollTop, scrollHeight, clientHeight } = el;
  if (scrollHeight <= clientHeight + 1) {
    fadeScrollbarThumbEl.classList.remove("is-visible");
    return;
  }

  const rect = el.getBoundingClientRect();
  const maxScroll = scrollHeight - clientHeight;
  const thumbHeight = Math.max((clientHeight / scrollHeight) * clientHeight, FADE_SCROLLBAR_MIN_THUMB_PX);
  const progress = maxScroll > 0 ? scrollTop / maxScroll : 0;
  const thumbTop = rect.top + progress * (clientHeight - thumbHeight);

  fadeScrollbarThumbEl.style.height = `${thumbHeight}px`;
  fadeScrollbarThumbEl.style.top = `${thumbTop}px`;
  fadeScrollbarThumbEl.style.left = `${rect.right - FADE_SCROLLBAR_INSET_PX}px`;
  fadeScrollbarThumbEl.classList.add("is-visible");

  clearTimeout(fadeScrollbarHideTimer);
  fadeScrollbarHideTimer = setTimeout(() => {
    fadeScrollbarThumbEl.classList.remove("is-visible");
  }, FADE_SCROLLBAR_HIDE_DELAY_MS);
}
