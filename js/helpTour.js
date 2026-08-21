// ============================================================
// 기능 안내 투어 — 검색창 옆 "?" 버튼(index.html help-tour-btn)
// ============================================================
// 첫 방문 환영 모달(js/app.js maybeShowWelcomeOverlay)은 브라우저당
// 한 번만 뜨고 서비스 컨셉만 짧게 설명하는 데 반해, 이건 언제든 다시
// 열어 기억산책/기억 라디오/시간여행처럼 하단 툴바 아이콘만으로는 뭔지
// 감이 안 올 수 있는 기능들을 스텝별로 훑어볼 수 있게 한다(2026-08-21).
// 화면은 실제 앱 UI를 캡처한 스크린샷이라 "이런 화면이 나온다"를 그대로
// 보여준다.

const HELP_TOUR_STEPS = [
  {
    img: "assets/tour/tour-1-story.png",
    title: "기억을 발견해요",
    desc: "지도의 핀을 누르면 그 장소에 남겨진 진짜 기억을 읽을 수 있어요. 같은 곳, 같은 해를 기억하는 다른 사람이 있으면 카드에 함께 알려드려요.",
  },
  {
    img: "assets/tour/tour-5-composer.png",
    title: "기억을 남겨요",
    desc: "장소와 시절을 골라 당신의 기억을 적어보세요. 연도만 남겨도 괜찮고, 이름 없이 익명으로 남길 수도 있어요.",
  },
  {
    img: "assets/tour/tour-2-recall.png",
    title: "기억산책",
    desc: "내가 남긴 기억을 연대별로 골라, 하나씩 다시 만나며 걸어보는 산책 모드예요.",
  },
  {
    img: "assets/tour/tour-3-radio.png",
    title: "기억 라디오",
    desc: "노래가 담긴 기억들을 라디오처럼 랜덤으로 계속 틀어줘요.",
  },
  {
    img: "assets/tour/tour-4-slider.png",
    title: "시간여행",
    desc: "연도를 골라 그 시절까지(또는 그 해만) 남겨진 기억만 지도에서 볼 수 있어요.",
  },
];

let helpTourStep = 0;

function renderHelpTourStep() {
  const panel = document.getElementById("help-tour-panel");
  const step = HELP_TOUR_STEPS[helpTourStep];
  const isFirst = helpTourStep === 0;
  const isLast = helpTourStep === HELP_TOUR_STEPS.length - 1;

  const dotsHtml = HELP_TOUR_STEPS
    .map((_, i) => `<span class="help-tour-dot ${i === helpTourStep ? "help-tour-dot--active" : ""}"></span>`)
    .join("");

  panel.innerHTML = `
    <div class="daily-prompt-header">
      <span class="daily-prompt-label"><span class="daily-prompt-dot"></span>이런 기능이 있어요</span>
      <button class="daily-prompt-close" id="help-tour-close" aria-label="닫기">✕</button>
    </div>
    <img class="help-tour-image" src="${step.img}" alt="${step.title}" />
    <p class="daily-prompt-quote" style="margin-top:16px;">${step.title}</p>
    <p class="daily-prompt-hint">${step.desc}</p>
    <div class="help-tour-dots">${dotsHtml}</div>
    <div class="help-tour-nav">
      <button class="btn-secondary help-tour-prev" id="help-tour-prev" ${isFirst ? "disabled" : ""}>이전</button>
      <button class="btn-primary help-tour-next" id="help-tour-next">${isLast ? "시작하기" : "다음"}</button>
    </div>
  `;

  panel.querySelector("#help-tour-close").onclick = closeHelpTour;
  panel.querySelector("#help-tour-prev").onclick = () => {
    if (helpTourStep > 0) {
      helpTourStep -= 1;
      renderHelpTourStep();
    }
  };
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
