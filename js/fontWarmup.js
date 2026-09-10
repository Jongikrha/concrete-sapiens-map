// 웹폰트 미리 받아두기 (2026-09-10)
//
// 이 사이트의 한글 폰트는 전부 "실제로 화면에 뜬 글자에 해당하는 조각만
// 받는" 서브셋 방식이다(index.html <head> 폰트 주석 참고). 덕분에 총
// 다운로드는 훨씬 작아졌지만, 뒤집어 말하면 어떤 폰트를 처음 쓰는 화면이
// 열릴 때마다 그 자리에서 새로 받는다는 뜻이다. 받는 동안 브라우저는
// font-display:swap 규칙대로 iOS 기본 고딕으로 먼저 그려놓고, 폰트가
// 도착하면 다시 그린다 — "글자가 한 번 휙 바뀌는" 그 현상(FOUT)이다.
// 2026-09-10에 기억 남기기 모달에서 제보됐는데, 실제로는 모달만이 아니라
// 기억 카드/검색 결과/내 기억 등 새 화면이 열릴 때마다 반복됐다.
//
// 그래서 첫 렌더가 끝나고 한가해진 뒤에 미리 받아둔다. 사용자가 어차피
// 모달이나 기억 카드를 열면 받게 될 데이터를, 눈에 띄지 않는 시점으로
// 옮기는 것뿐이다(조각 하나가 20~35KB, 아래 4종 합쳐 600KB 안팎).
//
// 지도 자체를 여는 첫 화면(Noto Sans KR)은 어차피 즉시 받으므로 여기서
// 다루지 않는다.
(function () {
  if (!document.fonts || !document.fonts.load) return;

  // 서브셋은 "이 글자들"에 해당하는 조각만 내려오기 때문에, 표본은 실제
  // UI에 뜨는 문구여야 한다. 아래는 이 서비스 고정 문구에서 뽑았고,
  // 구글/MaruBuri/Pretendard가 공통으로 쓰는 "흔한 한글" 조각 7개에
  // 정확히 걸치도록 확인해서 골랐다(2026-09-10) — 문구를 늘리면 덜 흔한
  // 조각까지 딸려와 받는 양이 늘어나니 함부로 붙이지 말 것.
  var SAMPLE =
    "기억 남기기 당신의 기억이 지도에 남아 빛이 됩니다. " +
    "어디에 기억을 남길까요? 언제 기억인가요? 어떤 기억이 있었나요? " +
    "태그를 남겨볼까요? 노래도 함께 남겨볼까요? 사진도 함께 남겨볼까요? " +
    "기억 아카이브 내 주변 시간여행 내 기억 기억 라디오 " +
    "이 장소를 뭐라고 부르시나요? 익명으로 남기기 이름 또는 닉네임 " +
    "잠시 후 다시 시도해주세요 비밀번호 변경 새 비밀번호를 설정해주세요";

  // Pretendard는 variable 빌드라 조각 하나가 400~800 전 굵기를 커버해서
  // 한 번만 부르면 된다. MaruBuri는 굵기별로 파일이 갈려서 기억 카드에
  // 실제로 쓰는 400(본문)과 700(연/월·유튜브 제목) 둘 다 받는다.
  // Noto Sans KR은 첫 화면에서 어차피 바로 받으므로 여기 없다.
  var FONTS = [
    '500 20px "Noto Serif KR"',       // 모달/시트 제목
    '400 15px "Pretendard Variable"', // UI 라벨/버튼
    '400 15px "Maru Buri"',           // 기억 본문
    '700 15px "Maru Buri"'            // 기억 연/월, 유튜브 제목
  ];

  function warmUp() {
    // 한 번에 몰아 던지지 않고 하나씩 — 지도 타일이나 기억 목록 요청과
    // 대역폭을 다투지 않게 한다.
    FONTS.reduce(function (chain, font) {
      return chain.then(function () {
        return document.fonts.load(font, SAMPLE);
      }).catch(function () {
        // 폰트 하나 못 받아도 그냥 지금까지처럼 열 때 받으면 된다.
      });
    }, Promise.resolve());
  }

  function whenIdle(fn) {
    if (window.requestIdleCallback) requestIdleCallback(fn, { timeout: 4000 });
    else setTimeout(fn, 1500);
  }

  function start() {
    // 데이터 절약 모드거나 느린 회선이면 굳이 미리 받지 않는다 — 그런
    // 환경에선 600KB를 앞당겨 쓰는 게 손해다. 폰트는 예전처럼 화면을
    // 열 때 받는다.
    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ""))) return;
    whenIdle(warmUp);
  }

  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
})();
