// ============================================================
// 기능 안내 투어 — 검색창 옆 "?" 버튼(index.html help-tour-btn)
// ============================================================
// 첫 방문 환영 모달(js/app.js maybeShowWelcomeOverlay)은 브라우저당
// 한 번만 뜨고 서비스 컨셉만 짧게 설명하는 데 반해, 이건 언제든 다시
// 열어 기억산책/기억 라디오/시간여행처럼 하단 툴바 아이콘만으로는 뭔지
// 감이 안 올 수 있는 기능들을 스텝별로 훑어볼 수 있게 한다(2026-08-21).
// 스텝 카드 이미지는 실제 앱 UI를 그대로 옮긴 미리보기라 "이런 화면이
// 나온다"를 보여준다 — 앱 자체의 닫기 버튼은 목업 단계에서 잘라내
// 투어 패널의 닫기(X) 하나만 보이게 했다.

const HELP_TOUR_STEPS = [
  {
    img: "assets/tour/tour-1-discover.png",
    title: "기억을 발견해요",
    desc: "지도의 핀을 누르면 그 장소에 남겨진 진짜 기억을 읽을 수 있어요. 같은 곳, 같은 해를 기억하는 다른 사람이 있으면 카드에 함께 알려드려요.",
    cardFirst: false,
  },
  {
    img: "assets/tour/tour-2-compose.png",
    title: "기억을 남겨요",
    desc: "장소와 시절을 골라 당신의 기억을 적어보세요. 연도만 남겨도 괜찮고, 이름 없이 익명으로 남길 수도 있어요.",
    cardFirst: true,
  },
  {
    img: "assets/tour/tour-3-mymemory.png",
    quote: "내가 남긴 기억을 지도에서 보거나, 산책하듯 걸으며 새로운 기억을 만날 수 있어요.",
    cardFirst: true,
  },
  {
    img: "assets/tour/tour-4-radio.png",
    title: "기억 라디오",
    desc: "노래가 담긴 기억들을 라디오처럼 랜덤으로 계속 틀어줘요.",
    cardFirst: true,
  },
  {
    img: "assets/tour/tour-5-timetravel.png",
    title: "시간여행",
    desc: "연도를 골라 그 시절까지(또는 그 해만) 남겨진 기억만 지도에서 볼 수 있어요.",
    cardFirst: true,
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

  const imageHtml = `<img class="help-tour-image" src="${step.img}" alt="${step.title || step.quote}" />`;
  const textHtml = step.quote
    ? `<div class="help-tour-quote"><p>${step.quote}</p></div>`
    : `<p class="help-tour-title">${step.title}</p><p class="help-tour-desc">${step.desc}</p>`;

  panel.innerHTML = `
    <div class="help-tour-topbar">
      <div class="help-tour-dots">${dotsHtml}</div>
      <button class="help-tour-close" id="help-tour-close" aria-label="닫기">✕</button>
    </div>
    <div class="help-tour-body">
      ${step.cardFirst ? imageHtml + textHtml : textHtml + imageHtml}
    </div>
    <div class="help-tour-nav ${isFirst ? "help-tour-nav--single" : ""}">
      ${isFirst ? "" : `<button class="help-tour-prev-link" id="help-tour-prev">이전</button>`}
      <button class="btn-primary help-tour-next" id="help-tour-next">${isLast ? "시작하기" : "다음"}</button>
    </div>
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
