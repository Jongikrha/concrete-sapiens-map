// ============================================================
// 밤 지도 — 일몰~일출 사이엔 지도를 한 단계 더 어둡게(2026-09-02)
// ============================================================
// 실제 일몰/일출 시각을 쓰되, 정밀한 천문 계산(위경도 기반) 대신 계절에
// 따른 근사치를 쓴다 — 이 서비스는 "전국"(한국) 대상이라 위경도 차이에
// 따른 오차가 몇 분 수준이고, 무드용 연출이라 그 정도 오차는 문제되지
// 않는다. 위치 권한을 요구하지 않아도 되는 것도 장점.
//
// 서울 기준 실측값(하지/동지)을 두 기준점으로 삼아 연중 사인 곡선으로
// 보간한다 — 실제 곡선(균시차 포함)과는 살짝 다르지만 차이는 10분
// 안팎이라 "저녁이 되면 어두워진다" 체감에는 영향이 없다.
//   하지(6/21 무렵) 일출 05:11 · 일몰 19:57
//   동지(12/21 무렵) 일출 07:43 · 일몰 17:17
const NIGHT_SUNRISE_MID = 6.45; // (5.183 + 7.717) / 2
const NIGHT_SUNRISE_AMPLITUDE = 1.27; // (7.717 - 5.183) / 2
const NIGHT_SUNSET_MID = 18.62; // (19.95 + 17.283) / 2
const NIGHT_SUNSET_AMPLITUDE = 1.33; // (19.95 - 17.283) / 2
const NIGHT_SOLSTICE_DAY = 172; // 하지(6월 21일)의 연중 일수(대략)

// 재확인 주기 — 일몰/일출 순간을 정확히 맞출 필요는 없어서(무드 연출),
// 탭을 계속 열어둔 사용자가 몇 분 안에는 전환을 보게 되는 정도로 충분하다.
const NIGHT_CHECK_INTERVAL_MS = 5 * 60 * 1000;

function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / 86400000);
}

function approxSunHour(date, mid, amplitude) {
  const angle = (2 * Math.PI * (dayOfYear(date) - NIGHT_SOLSTICE_DAY)) / 365;
  return mid + amplitude * Math.cos(angle);
}

function isNightNow(date = new Date()) {
  const hour = date.getHours() + date.getMinutes() / 60;
  const sunrise = approxSunHour(date, NIGHT_SUNRISE_MID, -NIGHT_SUNRISE_AMPLITUDE);
  const sunset = approxSunHour(date, NIGHT_SUNSET_MID, NIGHT_SUNSET_AMPLITUDE);
  // 일몰은 자정을 넘어가므로(저녁~다음날 새벽) OR로 판정한다.
  return hour >= sunset || hour < sunrise;
}

function applyNightClass() {
  document.getElementById("map").classList.toggle("map-night", isNightNow());
}

const NightMode = {
  init() {
    applyNightClass();
    setInterval(applyNightClass, NIGHT_CHECK_INTERVAL_MS);
  },
};
