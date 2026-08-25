// ============================================================
// 설정 파일
// ============================================================
// 카카오 개발자 사이트(https://developers.kakao.com)에서
// 애플리케이션을 등록하고 아래 JavaScript 키를 발급받아 입력하세요.
// ============================================================

const CONFIG = {
  KAKAO_APP_KEY: "2d563828a521e193fd6b06393f010fa2",

  DEFAULT_CENTER: { lat: 36.3504, lng: 127.3845 },
  DEFAULT_LEVEL: 13,

  MAX_CONTENT_LENGTH: 200,

  // WHERE(장소 이름) 최대 글자 수 — 공백은 세지 않는다.
  MAX_PLACE_NAME_LENGTH: 15,

  // 상단 해시태그 바에 노출할 개수 (많이 쓰인 순 상위 N개) — 나머지는
  // 더보기 시트로.
  TOP_HASHTAG_LIMIT: 7,

  // 상단 바의 곡 칩에 노출할 개수 — 태그 줄과 별도의 줄로 분리해서 보여준다.
  TOP_SONG_LIMIT: 5,

  // 신고 누적 시 자동 숨김(HIDDEN) 처리 기준
  REPORT_HIDE_THRESHOLD: 5,

  // 최초 진입 시 랜덤 랜딩에 사용할 최근 이야기 풀 크기
  RECENT_STORY_POOL_SIZE: 100,

  // 반응 수 공개 표시 기준 (design spec §21, §25)
  // 정확한 숫자를 노출하지 않고 뭉뚱그려 표시한다.
  REACTION_DISPLAY_TIERS: [
    { min: 10000, label: "10K+" },
    { min: 1000, label: "1K+" },
    { min: 100, label: "100+" },
    { min: 10, label: "10+" },
    { min: 1, label: "온기가 닿았습니다" },
  ],

  // 과거 시점 입력 가능 최소 연도 (년/월 선택 드롭다운 범위)
  MIN_YEAR: 1940,

  // 검색한 장소 "근처"로 볼 반경(미터) — 검색 결과 클릭 시 이 안의
  // 기억 개수/연도범위를 배너로 보여주고 지도 마커를 밝힌다(js/search.js).
  SEARCH_AREA_RADIUS_METERS: 1000,
};
