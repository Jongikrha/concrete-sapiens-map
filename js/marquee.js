// ============================================================
// 긴 곡명/가수 이름 흘려 보내기(마퀴, 2026-10-17)
// ============================================================
// 기억 라디오 카드·발자취 장소 카드의 노래 줄과 미니 플레이어는 한 줄
// (nowrap + "…")이라 긴 곡명이 잘렸다. 두 줄로 늘리면 곡마다 카드 높이가
// 들썩여서(스텝마다 패널 크기가 달라졌던 사고와 같은 문제), 높이는 그대로
// 두고 지금 재생 중인 곡 줄만 넘칠 때 옆으로 천천히 흘려 보낸다.
//
// 규칙: 실제로 넘칠 때만 움직인다 → 처음 2초는 멈춰서 앞부분을 읽게 하고
// → 초당 30px로 끝까지 → 1.5초 멈춘 뒤 처음으로 돌아가 반복. "동작 줄이기"
// 설정(prefers-reduced-motion)이면 움직이지 않고 기존처럼 "…"로 둔다.
// 목록/칩처럼 여러 줄이 나열되는 곳에는 쓰지 않는다(동시에 움직이면 산만).
//
// 쓰는 쪽은 글자를 넣은 직후 applyMarquee(el)만 부르면 된다. 요소가 아직
// 숨겨져 있으면(폭 0) 잠시 뒤 다시 잰다 — 미니 플레이어처럼 글자를 먼저
// 넣고 나중에 보이는 경우.

const MARQUEE_HOLD_START_MS = 2000;
const MARQUEE_HOLD_END_MS = 1500;
const MARQUEE_PX_PER_SEC = 30;
const MARQUEE_MEASURE_RETRIES = 10;

function applyMarquee(el, attempt = 0) {
  if (!el) return;
  if (attempt === 0) resetMarquee(el);
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const token = el._marqueeToken;
  requestAnimationFrame(() => {
    if (el._marqueeToken !== token || !el.isConnected) return; // 그사이 글자가 바뀜
    if (el.clientWidth === 0) {
      if (attempt < MARQUEE_MEASURE_RETRIES) setTimeout(() => applyMarquee(el, attempt + 1), 300);
      return;
    }
    if (el.scrollWidth <= el.clientWidth + 1) return;
    const text = el.textContent;
    const inner = document.createElement("span");
    inner.className = "marquee-inner";
    inner.textContent = text;
    el.replaceChildren(inner);
    el.classList.add("marquee");
    const distance = inner.offsetWidth - el.clientWidth;
    if (distance <= 0) return;
    const scrollMs = (distance / MARQUEE_PX_PER_SEC) * 1000;
    const total = MARQUEE_HOLD_START_MS + scrollMs + MARQUEE_HOLD_END_MS;
    const startOffset = MARQUEE_HOLD_START_MS / total;
    const endOffset = (MARQUEE_HOLD_START_MS + scrollMs) / total;
    el._marqueeAnim = inner.animate(
      [
        { transform: "translateX(0)", offset: 0 },
        { transform: "translateX(0)", offset: startOffset },
        { transform: `translateX(${-distance}px)`, offset: endOffset },
        { transform: `translateX(${-distance}px)`, offset: 1 },
      ],
      { duration: total, iterations: Infinity, easing: "linear" }
    );
  });
}

// 이전 흐름을 멈추고 평범한 글자(…로 잘리는 상태)로 되돌린다
function resetMarquee(el) {
  el._marqueeToken = (el._marqueeToken || 0) + 1;
  if (el._marqueeAnim) {
    el._marqueeAnim.cancel();
    el._marqueeAnim = null;
  }
  if (el.classList.contains("marquee")) {
    const text = el.textContent;
    el.classList.remove("marquee");
    el.textContent = text;
  }
}
