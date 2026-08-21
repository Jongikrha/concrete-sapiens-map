// ============================================================
// 기능 안내 투어 — 검색창 옆 "?" 버튼(index.html help-tour-btn)
// ============================================================
// 첫 방문 환영 모달(js/app.js maybeShowWelcomeOverlay)은 브라우저당
// 한 번만 뜨고 서비스 컨셉만 짧게 설명하는 데 반해, 이건 언제든 다시
// 열어 기억산책/기억 라디오/시간여행처럼 하단 툴바 아이콘만으로는 뭔지
// 감이 안 올 수 있는 기능들을 스텝별로 훑어볼 수 있게 한다(2026-08-21).
// 스텝 이미지는 제목/설명/점/닫기 버튼까지 전부 포함된 완성된 목업을
// 그대로 쓴다(2026-08-21 재작업) — 코드로 텍스트/점을 다시 그리지
// 않고 이미지를 그대로 붙이는 대신, 닫기/이전/다음은 이미지 위에 투명
// 버튼을 정확히 같은 위치(모든 스텝 이미지 크기가 989x1340으로 동일)에
// 겹쳐서 클릭만 받는다.

const HELP_TOUR_STEPS = [
  "assets/tour/tour-1-discover.png",
  "assets/tour/tour-2-compose.png",
  "assets/tour/tour-3-mymemory.png",
  "assets/tour/tour-4-radio.png",
  "assets/tour/tour-5-timetravel.png",
];

let helpTourStep = 0;

function renderHelpTourStep() {
  const panel = document.getElementById("help-tour-panel");
  const isFirst = helpTourStep === 0;
  const isLast = helpTourStep === HELP_TOUR_STEPS.length - 1;

  panel.innerHTML = `
    <img class="help-tour-flat-image" src="${HELP_TOUR_STEPS[helpTourStep]}" alt="기능 안내 ${helpTourStep + 1}/${HELP_TOUR_STEPS.length}" />
    <button class="help-tour-hit help-tour-hit-close" id="help-tour-close" aria-label="닫기"></button>
    ${isFirst ? "" : `<button class="help-tour-hit help-tour-hit-prev" id="help-tour-prev" aria-label="이전"></button>`}
    <button class="help-tour-hit help-tour-hit-next ${isFirst ? "help-tour-hit-next--full" : ""}" id="help-tour-next" aria-label="${isLast ? "시작하기" : "다음"}"></button>
  `;

  panel.querySelector("#help-tour-close").onclick = closeHelpTour;
  const prevBtn = panel.querySelector("#help-tour-prev");
  if (prevBtn) {
    prevBtn.onclick = () => {
      if (helpTourStep > 0) {
        helpTourStep -= 1;
        renderHelpTourStep();
      }
    };
  }
  panel.querySelector("#help-tour-next").onclick = () => {
    if (isLast) {
      closeHelpTour();
      return;
    }
    helpTourStep += 1;
    renderHelpTourStep();
  };
}

function openHelpTour() {
  helpTourStep = 0;
  renderHelpTourStep();
  document.getElementById("help-tour-overlay").classList.remove("hidden");
}

function closeHelpTour() {
  document.getElementById("help-tour-overlay").classList.add("hidden");
}
