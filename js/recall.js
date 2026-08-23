// ============================================================
// 기억산책 / 회상 모드 + 내 기억의 별자리 + 기억 라디오(랜덤 플레이리스트)
// ============================================================
// 이 파일은 두 진입점을 담당한다.
//
// 1) 하단 "내 기억" 버튼(js/filters.js의 toggleMyMemoryMode) — 기존
//    "지도에서 내 기억 보기"(startMyMemoryMode, 무변경)와 "기억산책"
//    (startRecallConstellationWithStories, scope="mine") 중 고른다.
//    기억산책은 실제로 기억이 있는 연대가 둘 이상이면 어느 연대로 걸을지
//    먼저 고르게 하고(openRecallDecadeChoice, 2026-08-20), 그다음 몰입
//    리빌 전에 별자리 개요(showConstellationOverview)를 보여준다. 선택
//    패널은 filters.js의 openTodayMission()과 같은 패턴 —
//    #recall-choice-panel의 innerHTML만 갈아끼운다.
// 2) 하단 "기억 라디오" 버튼(startMemoryRadio → openRadioChannelChoice,
//    scope="songs", 구 "어딘가의 기억") — 이 서비스의 핵심 기능으로 두기로
//    해서(2026-08-19) 툴바에서 혼자 크게 뜬다. 탭하면 바로 재생하지 않고
//    채널(전체 랜덤/연대별/주제별 — 주제는 해시태그 하나하나를 곡 수 많은
//    순으로 줄세워 상위 4개만 카드로, 나머지는 "더보기"에서 10곡 이상인
//    것만, 2026-08-23. 이전엔 사람이 미리 묶은 4개 그룹(RADIO_THEME_GROUPS)
//    이었는데, 자유입력 태그가 계속 늘어날 때마다 그룹을 다시 손봐야 하는
//    유지보수 부담을 없애려고 큐레이션을 접었다 — 표기가 갈라지는 경우
//    (#제주/#제주도)나 상위 4개가 시간에 따라 바뀌는 것도 감수하기로 함)
//    부터 고르게 한다 — 1)의 openRecallDecadeChoice와 같은
//    recall-choice-overlay/panel을 재사용. 고른 채널의 곡만 모아 랜덤
//    플레이리스트처럼 계속 재생하고, 지도도 밤처럼 어둡게 바꾼다
//    (enterRecallNightMode — 기억산책엔 안 준다, 개인적 산책과 배경
//    라디오의 분위기를 다르게 두려는 의도). 첫 곡만 "N초 후 재생됩니다"
//    예고를 보여주고, 그다음부터는(곡이 끝나 자동으로 넘어가든 "다음
//    기억으로"를 직접 누르든) 예고 없이 바로 재생된다 — 켜놓고 다른 일을
//    해도 되게.
//
// 별자리에서 점을 잇는 선은 실제 카카오 지도가 아니라 이 파일 안의 별도
// 캔버스에 그린다 — 2026-08-13에 실제 지도 위에서 점을 선으로 이었다가
// "지하철 노선도 같다"는 피드백으로 뺀 이력이 있다(js/map.js renderMarkers
// 주석 참고). 몰입 리빌은 지도 위에 아직 안 본 기억 하나의 점만 남기고
// (한 번에 하나씩, Fisher–Yates로 섞은 큐를 소진하면 재셔플), 누르면(또는
// 자동으로) 카드가 뜨고 음악이 흐른다. 무한 스크롤/추천 피드는 없다.

let recallSessionOpen = false;
let recallScope = null; // "mine"(기억산책) | "songs"(기억 라디오)
let recallPool = [];
let recallQueue = []; // pop()으로 뒤에서 하나씩 꺼내 쓰는 셔플 큐
let recallCurrentStory = null;
let recallDotMarker = null;
// 별자리 개요에서 쓴 스토리 목록 — 공유 카드 생성 시 다시 계산하지 않고 재사용.
let recallConstellationStories = null;
// 기억산책 진입 시 고른 연대(예: 1990, 2000...) — null이면 "전체".
// 별자리/공유 카드 제목에 쓴다(getConstellationTitle).
let recallDecadeLabel = null;

// "내 기억" 선택 카드 아이콘(2026-08-20 디자인 변경) — 외부 아이콘
// 라이브러리 없이 인라인 SVG로 직접 그린다. 지도 폴리곤/핀 좌표는 feather
// icons의 "map"/"map-pin" 글리프(24×24 그리드)를 그대로 가져와 위치만
// 옮겼다 — 흔히 쓰는 검증된 모양이라 직접 새로 그리는 것보다 안전하다.
const RECALL_CHOICE_MAP_ICON_SVG = `
  <svg viewBox="0 0 64 64" width="30" height="30" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <g transform="translate(2,12) scale(1.6)" stroke="#2F3031" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </g>
    <g transform="translate(29,2) scale(1.2)">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" fill="#FF5A36" />
      <circle cx="12" cy="10" r="3.4" fill="#FDEDE7" />
    </g>
  </svg>
`;
const RECALL_CHOICE_WALK_ICON_SVG = `
  <svg viewBox="0 0 64 64" width="30" height="30" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M8 50 C 18 50, 18 36, 28 36 C 38 36, 38 22, 46 22"
      stroke="#FF5A36" stroke-width="3" stroke-linecap="round" stroke-dasharray="0.5 8" />
    <g transform="translate(44,8)">
      <line x1="2" y1="2" x2="2" y2="26" stroke="#FF5A36" stroke-width="2.6" stroke-linecap="round" />
      <path d="M2 2 L18 7 L2 12 Z" fill="#FF5A36" />
    </g>
  </svg>
`;

// ------------------------------------------------------------
// "내 기억" 버튼의 선택지 — 지도에서 보기 / 기억산책
// ------------------------------------------------------------
function openRecallEntryChoice() {
  // 시간여행(슬라이더)이 열려 있으면 먼저 닫는다 — time-slider-panel은
  // 전체 화면을 덮는 오버레이가 아니라 하단 툴바가 그대로 클릭되는
  // 인라인 패널이라, 슬라이더를 켠 채로 "내 기억" 버튼을 눌러도 이
  // 선택 모달이 그 위에 그냥 얹혀서 둘이 동시에 보이는 문제가 있었다
  // (2026-08-21). startMyMemoryMode/openRecallSessionShell은 각자
  // 선택 이후 시점에 closeSlider를 부르지만, 그 전인 선택 모달
  // 단계에서는 아무도 안 불러서 여기서 진입 시점에 바로 닫는다.
  closeSlider();
  const panel = document.getElementById("recall-choice-panel");
  panel.innerHTML = `
    <div class="daily-prompt-header">
      <span class="daily-prompt-label">내 기억</span>
      <button class="daily-prompt-close" id="recall-choice-close" aria-label="닫기">✕</button>
    </div>
    <p class="daily-prompt-hint">어떻게 보고 싶으세요?</p>
    <div class="recall-choice-grid">
      <button type="button" class="recall-choice-card" id="recall-choice-map-btn">
        <span class="recall-choice-card-icon">${RECALL_CHOICE_MAP_ICON_SVG}</span>
        <span class="recall-choice-card-label">지도에서 내 기억 보기</span>
      </button>
      <button type="button" class="recall-choice-card" id="recall-choice-walk-btn">
        <span class="recall-choice-card-icon">${RECALL_CHOICE_WALK_ICON_SVG}</span>
        <span class="recall-choice-card-label">기억산책</span>
      </button>
    </div>
  `;
  panel.querySelector("#recall-choice-close").onclick = closeRecallChoice;
  panel.querySelector("#recall-choice-map-btn").onclick = () => {
    closeRecallChoice();
    startMyMemoryMode();
  };
  panel.querySelector("#recall-choice-walk-btn").onclick = async () => {
    const stories = await buildMyMemoryList("posted");
    if (!stories.length) {
      closeRecallChoice();
      showToast("entry-toast", "아직 남긴 기억이 없어요", 2400);
      return;
    }
    const buckets = getDecadeBuckets(stories);
    // 연대가 하나뿐이거나(또는 날짜 정보가 없어 아예 못 나누면) 고를 것도
    // 없어 바로 들어간다 — 그 하나의 연대로 라벨은 붙여준다.
    if (buckets.length <= 1) {
      closeRecallChoice();
      startRecallConstellationWithStories(stories, buckets.length === 1 ? buckets[0].decade : null);
    } else {
      openRecallDecadeChoice(stories, buckets);
    }
  };
  document.getElementById("recall-choice-overlay").classList.remove("hidden");
}

// 기억산책이 실제로 기억이 있는 연대만 골라 고르게 한다(2026-08-20) —
// "나의 기억 지도" 공유가 항상 오늘 연도로만 찍혀서, 정작 기억 자체가
// 다른 시대의 것이어도 그 맥락이 드러나지 않는다는 피드백. 연대별로
// 나눠보면 비어 보이는 시절이 더 남기고 싶어지는 계기가 될 수도 있다는
// 의도. dateMode가 없어 연도를 알 수 없는 기억(Storage.getStoryYear가
// null)은 연대 버킷에서 빠지지만 "전체"에는 그대로 포함된다.
function getDecadeBuckets(stories) {
  const buckets = new Map();
  stories.forEach((s) => {
    const year = Storage.getStoryYear(s);
    if (year === null) return;
    const decade = Math.floor(year / 10) * 10;
    if (!buckets.has(decade)) buckets.set(decade, []);
    buckets.get(decade).push(s);
  });
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([decade, decadeStories]) => ({ decade, stories: decadeStories }));
}

// 연대 카드 아이콘 — time-slider-mode-icon과 같은 feather "calendar"
// 글리프에, 목업(2026-08-22 "Memory Book" 디자인 레퍼런스)의 바인더
// 링 강조를 살려 상단 두 점만 오렌지로 채운다.
const RECALL_DECADE_CALENDAR_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#2F3031" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="5" width="18" height="16" rx="3"/>
    <path d="M8 3v4M16 3v4M3 10h18"/>
    <circle cx="8" cy="3" r="1.3" fill="#FF5A36" stroke="none"/>
    <circle cx="16" cy="3" r="1.3" fill="#FF5A36" stroke="none"/>
  </svg>
`;
const RECALL_DECADE_STAR_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="18" height="18" fill="#FDEDE7" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.6l-5.9 3 1.3-6.6-4.9-4.6 6.6-.8z"/>
  </svg>
`;
const RECALL_DECADE_CHEVRON_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="9 6 15 12 9 18"/>
  </svg>
`;

function openRecallDecadeChoice(stories, buckets) {
  const panel = document.getElementById("recall-choice-panel");
  const decadeButtonsHtml = buckets
    .map(
      ({ decade, stories: decadeStories }) => `
        <button type="button" class="recall-decade-card" data-decade="${decade}">
          <span class="recall-decade-card-icon">${RECALL_DECADE_CALENDAR_ICON_SVG}</span>
          <span class="recall-decade-card-text">${decade}년대 <span class="recall-decade-card-count">· ${decadeStories.length}개</span></span>
          <span class="recall-decade-card-chevron">${RECALL_DECADE_CHEVRON_ICON_SVG}</span>
        </button>
      `
    )
    .join("");
  panel.innerHTML = `
    <div class="daily-prompt-header">
      <span class="daily-prompt-label recall-decade-title-label"><span class="daily-prompt-dot"></span>기억산책</span>
      <button class="daily-prompt-close" id="recall-choice-close" aria-label="닫기">✕</button>
    </div>
    <p class="daily-prompt-hint">어느 시절의 기억을 걷고 싶으세요?</p>
    <div class="daily-prompt-divider"></div>
    <div class="recall-decade-list">
      ${decadeButtonsHtml}
      <button type="button" class="recall-decade-card recall-decade-card--all" id="recall-decade-all-btn">
        <span class="recall-decade-card-icon recall-decade-card-icon--all">${RECALL_DECADE_STAR_ICON_SVG}</span>
        <span class="recall-decade-card-text">전체 <span class="recall-decade-card-count">· ${stories.length}개</span></span>
        <span class="recall-decade-card-chevron recall-decade-card-chevron--all">${RECALL_DECADE_CHEVRON_ICON_SVG}</span>
      </button>
    </div>
  `;
  panel.querySelector("#recall-choice-close").onclick = closeRecallChoice;
  panel.querySelectorAll(".recall-decade-card[data-decade]").forEach((btn) => {
    btn.onclick = () => {
      const decade = Number(btn.dataset.decade);
      const bucket = buckets.find((b) => b.decade === decade);
      closeRecallChoice();
      startRecallConstellationWithStories(bucket.stories, decade);
    };
  });
  panel.querySelector("#recall-decade-all-btn").onclick = () => {
    closeRecallChoice();
    startRecallConstellationWithStories(stories, null);
  };
}

function closeRecallChoice() {
  document.getElementById("recall-choice-overlay").classList.add("hidden");
}

// ------------------------------------------------------------
// 진입 — 골라진(또는 자동으로 정해진) 스토리 목록으로 세션을 연다
// ------------------------------------------------------------
function startRecallConstellationWithStories(stories, decade) {
  recallScope = "mine";
  recallDecadeLabel = decade;
  openRecallSessionShell();
  showConstellationOverview(stories);
}

// 하단 "기억 라디오" 버튼(구 "어딘가의 기억") — 내 기억을 포함한 전체
// 공개 기억 중 노래가 첨부된 것만 모아 랜덤 플레이리스트처럼 계속
// 재생한다(2026-08-19). 탭하면 바로 재생하지 않고 채널(전체/연대별/
// 주제별)을 먼저 고르게 한다(2026-08-22) — 기억산책의 연대 선택
// (openRecallDecadeChoice)과 같은 recall-choice-overlay/panel을 그대로
// 재활용해 새 화면 자리 없이도 붙일 수 있다. 탭 한 번이 늘어나는
// 트레이드오프는 감수하기로 했다.
function startMemoryRadio() {
  openRadioChannelChoice();
}

// 라디오 채널 선택 — 전체 랜덤 / 연대별(getDecadeBuckets 재사용) / 주제별
// (해시태그별로 곡이 10개 이상인 것만, 곡 수 많은 순 상위 4개는 카드로,
// 나머지는 "더보기"로). 카드 그리드 디자인은 기억산책 연대 선택
// (openRecallDecadeChoice)의 .recall-decade-card를 그대로 재사용하되,
// 여기선 2열 그리드로 배치한다(2026-08-22 목업 레퍼런스).
function openRadioChannelChoice() {
  const pool = Storage.getVisibleStories().filter((s) => Storage.extractYoutubeVideoId(s.youtubeUrl));
  if (!pool.length) {
    showToast("entry-toast", "아직 노래가 담긴 기억이 없어요", 2400);
    return;
  }
  closeSlider();
  const decadeBuckets = getDecadeBuckets(pool);
  const tagBuckets = getRadioTagBuckets(pool);
  const topTagBuckets = tagBuckets.slice(0, 4);
  const moreTagBuckets = tagBuckets.slice(4);

  const decadeButtonsHtml = decadeBuckets
    .map(
      ({ decade, stories }) => `
        <button type="button" class="recall-decade-card recall-radio-decade-btn" data-decade="${decade}">
          <span class="recall-decade-card-icon">${RECALL_DECADE_CALENDAR_ICON_SVG}</span>
          <span class="recall-decade-card-text">${decade}년대 <span class="recall-decade-card-count">· ${stories.length}곡</span></span>
          <span class="recall-decade-card-chevron">${RECALL_DECADE_CHEVRON_ICON_SVG}</span>
        </button>
      `
    )
    .join("");
  const tagButtonsHtml = topTagBuckets
    .map(
      ({ tag, songCount }, i) => `
        <button type="button" class="recall-decade-card recall-radio-tag-btn" data-idx="${i}">
          <span class="recall-decade-card-text">${escapeHtml(tag)} <span class="recall-decade-card-count">· ${songCount}곡</span></span>
          <span class="recall-decade-card-chevron">${RECALL_DECADE_CHEVRON_ICON_SVG}</span>
        </button>
      `
    )
    .join("");
  const moreButtonHtml = moreTagBuckets.length
    ? `
        <button type="button" class="recall-decade-card" id="recall-radio-more-btn">
          <span class="recall-decade-card-text">더보기 <span class="recall-decade-card-count">· ${moreTagBuckets.length}개</span></span>
          <span class="recall-decade-card-chevron">${RECALL_DECADE_CHEVRON_ICON_SVG}</span>
        </button>
      `
    : "";

  const panel = document.getElementById("recall-choice-panel");
  panel.innerHTML = `
    <div class="daily-prompt-header">
      <span class="daily-prompt-label"><span class="daily-prompt-dot"></span>기억 라디오</span>
      <button class="daily-prompt-close" id="recall-choice-close" aria-label="닫기">✕</button>
    </div>
    <p class="daily-prompt-hint">어떤 채널을 들으시겠어요?</p>
    <div class="daily-prompt-divider"></div>
    <button type="button" class="recall-decade-card recall-decade-card--all recall-radio-all-card" id="recall-radio-all-btn">
      <span class="recall-decade-card-icon recall-decade-card-icon--all">${RADIO_ALL_EQUALIZER_ICON_SVG}</span>
      <span class="recall-decade-card-text">전체 취합 <span class="recall-decade-card-count">· ${pool.length}곡</span></span>
      <span class="recall-decade-card-chevron recall-decade-card-chevron--all">${RECALL_DECADE_CHEVRON_ICON_SVG}</span>
    </button>
    <div class="recall-radio-channel-grid">
      ${decadeButtonsHtml}
      ${tagButtonsHtml}
      ${moreButtonHtml}
    </div>
  `;
  panel.querySelector("#recall-choice-close").onclick = closeRecallChoice;
  panel.querySelector("#recall-radio-all-btn").onclick = () => {
    closeRecallChoice();
    beginMemoryRadioChannel(pool, "전체 취합");
  };
  panel.querySelectorAll(".recall-radio-decade-btn").forEach((btn) => {
    btn.onclick = () => {
      const decade = Number(btn.dataset.decade);
      const bucket = decadeBuckets.find((b) => b.decade === decade);
      closeRecallChoice();
      beginMemoryRadioChannel(bucket.stories, `${decade}년대`);
    };
  });
  panel.querySelectorAll(".recall-radio-tag-btn").forEach((btn) => {
    btn.onclick = () => {
      const bucket = topTagBuckets[Number(btn.dataset.idx)];
      closeRecallChoice();
      beginMemoryRadioChannel(bucket.stories, bucket.tag);
    };
  });
  if (moreTagBuckets.length) {
    panel.querySelector("#recall-radio-more-btn").onclick = () => {
      openRadioMoreTagsChoice(moreTagBuckets);
    };
  }
  document.getElementById("recall-choice-overlay").classList.remove("hidden");
}

// "더보기" — 상위 4개에 못 든 나머지 해시태그 채널(10곡 이상만)을 세로
// 목록으로 보여준다. 카드 그리드가 아니라 기억산책 연대 목록과 같은
// .recall-decade-list 세로 배치를 쓴다 — 항목 수가 들쭉날쭉해서 그리드보다
// 자연스럽다. 뒤로가기는 storySheet.js의 .sheet-back-link를 그대로 재사용.
function openRadioMoreTagsChoice(moreTagBuckets) {
  const panel = document.getElementById("recall-choice-panel");
  const tagButtonsHtml = moreTagBuckets
    .map(
      ({ tag, songCount }, i) => `
        <button type="button" class="recall-decade-card recall-radio-more-tag-btn" data-idx="${i}">
          <span class="recall-decade-card-text">${escapeHtml(tag)} <span class="recall-decade-card-count">· ${songCount}곡</span></span>
          <span class="recall-decade-card-chevron">${RECALL_DECADE_CHEVRON_ICON_SVG}</span>
        </button>
      `
    )
    .join("");
  panel.innerHTML = `
    <div class="daily-prompt-header">
      <span class="daily-prompt-label"><span class="daily-prompt-dot"></span>기억 라디오</span>
      <button class="daily-prompt-close" id="recall-choice-close" aria-label="닫기">✕</button>
    </div>
    <button type="button" class="sheet-back-link" id="recall-radio-more-back">← 채널 선택</button>
    <div class="recall-decade-list">
      ${tagButtonsHtml}
    </div>
  `;
  panel.querySelector("#recall-choice-close").onclick = closeRecallChoice;
  panel.querySelector("#recall-radio-more-back").onclick = openRadioChannelChoice;
  panel.querySelectorAll(".recall-radio-more-tag-btn").forEach((btn) => {
    btn.onclick = () => {
      const bucket = moreTagBuckets[Number(btn.dataset.idx)];
      closeRecallChoice();
      beginMemoryRadioChannel(bucket.stories, bucket.tag);
    };
  });
}

// "전체 취합" 카드 아이콘 — 오디오 이퀄라이저 막대. 연대 선택의 별
// 아이콘(RECALL_DECADE_STAR_ICON_SVG)과 같은 자리지만, 라디오는
// "재생 중"의 느낌이 더 맞아서 다른 글리프를 쓴다.
const RADIO_ALL_EQUALIZER_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="18" height="18" fill="#FDEDE7" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="9" width="3" height="7" rx="1.3"/>
    <rect x="8" y="3" width="3" height="18" rx="1.3"/>
    <rect x="14" y="7" width="3" height="11" rx="1.3"/>
    <rect x="20" y="1" width="3" height="21" rx="1.3"/>
  </svg>
`;
// 주제 채널 — 해시태그 하나하나를 그대로 채널로 쓴다(2026-08-23). 이전엔
// 의미가 겹치는 태그를 사람이 미리 4개 묶음(RADIO_THEME_GROUPS)으로
// 큐레이션했는데, 자유입력 태그가 계속 늘어날 때마다 그 목록을 다시
// 훑어봐야 하는 유지보수 부담이 있었다. 개별 태그로 가면 "#제주"/
// "#제주도"처럼 표기가 갈라져 같은 의미가 다른 채널로 보이거나, 비슷한
// 태그가 각자 10곡을 못 채워 채널로 못 뜨는 경우가 다시 생길 수 있지만,
// 동의어 매핑을 유지보수하는 비용이 더 크다고 판단해 그대로 감수하기로
// 했다(jongik.rha 확인). 곡 수 상위 4개만 카드로, 나머지 10곡 이상인
// 태그는 "더보기"로 — 매번 pool을 즉석 집계하는 방식이라 새 해시태그가
// 늘어나도 코드를 손볼 필요가 없다.
// "같은 노래"의 기준은 유튜브 영상 ID가 아니라 사용자가 작성 폼에 직접
// 입력하는 아티스트+곡명(musicTitle/musicArtist)이다 — 곡 상세/인기곡
// 집계(Storage.getStoriesForSong 등)가 이미 쓰는 Storage.normalizeSongKey를
// 그대로 재사용한다(2026-08-23). 15명이 각자 다른 유튜브 링크로 같은
// 노래를 붙여도 이 기준으로는 하나로 묶인다. 곡명을 못 입력한 기억(빈
// musicTitle)은 판단 불가라 중복 제거 대상에서 빼고 그대로 둔다
// (getStoriesForSong의 `if (!title) return []` 가드와 같은 이유).
function dedupeStoriesBySong(stories) {
  const seen = new Set();
  return stories.filter((s) => {
    if (!s.musicTitle) return true;
    const key = Storage.normalizeSongKey(s.musicArtist, s.musicTitle);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// "10곡"의 "곡"은 이야기(story) 개수가 아니라 서로 다른 노래 개수를
// 뜻한다 — 같은 노래를 여러 사람이 각자 다른 기억으로 남겼을 때, 그
// 노래를 겹쳐 세면 실제로는 곡 종류가 적은데도 채널이 뜰 수 있다
// (2026-08-23, jongik.rha 지적). 재생 목록(stories)엔 겹치는 곡의
// 기억도 전부 그대로 두고, "몇 곡인지" 판단(10곡 컷 + 카드에 뜨는
// 숫자)에서만 dedupeStoriesBySong으로 중복 제거한다 — 실제 재생
// 시작(beginMemoryRadioChannel)에서 한 번 더 곡 단위로 걸러지므로,
// 여기서 stories를 미리 줄여둘 필요는 없다.
function getRadioTagBuckets(pool) {
  const byTag = new Map();
  pool.forEach((s) => {
    (s.hashtags || []).forEach((tag) => {
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push(s);
    });
  });
  return [...byTag.entries()]
    .map(([tag, stories]) => ({ tag, stories, songCount: dedupeStoriesBySong(stories).length }))
    .filter(({ songCount }) => songCount >= 10)
    .sort((a, b) => b.songCount - a.songCount);
}

// 라디오 재생은 같은 노래가 두 번 나오지 않게 채널 시작 시점에 pool을
// 곡 단위로 한 번 줄인다(2026-08-23). recallPool(js/recall.js
// showNextRecallMemory)이 큐가 바닥나면 이 값 그대로 재셔플하므로, 라디오를
// 끄기 전까지 세션 내내 같은 곡이 반복되지 않는다 — 기억산책(scope="mine")
// 은 이 함수를 거치지 않아 영향 없다.
function beginMemoryRadioChannel(pool, channelLabel) {
  recallScope = "songs";
  openRecallSessionShell();
  showToast("entry-toast", `${channelLabel} 채널로 재생을 시작해요`, 2000);
  beginRecallWalk(dedupeStoriesBySong(pool));
}

// 진입 경로별 공통 처리 — 다른 필터 모드와 상호배타를
// 유지하고(clearFilters 등 기존 함수 재사용), 평소 마커를 지우고 UI
// 크롬을 페이드아웃한다. 기억 라디오(scope="songs")일 때만 지도를
// 밤처럼 어둡게 한다.
function openRecallSessionShell() {
  clearFilters();
  closeSlider();
  closeMyMemoryMode();
  clusterer.clear();
  clearSearchPin();
  recallSessionOpen = true;
  enterRecallImmersiveChrome();
  if (recallScope === "songs") enterRecallNightMode();
  document.getElementById("recall-session").classList.remove("hidden");
}

function enterRecallImmersiveChrome() {
  document.getElementById("app").classList.add("recall-chrome-hidden");
  // 평소 미니 플레이어는 #map-overlay-top 안(z-index:20)에 있어서, 그
  // 자리 그대로면 회상 모달(.recall-session, z-index:110)에 가려 정지/
  // 일시정지가 안 보인다 — #app 바로 아래로 재배치해 z-index 120으로
  // 다시 최상단에 뜨게 한다(css/style.css .mini-player--floating).
  const miniPlayer = document.getElementById("mini-player");
  document.getElementById("app").appendChild(miniPlayer);
  miniPlayer.classList.add("mini-player--floating");
}

function enterRecallNightMode() {
  document.getElementById("app").classList.add("recall-radio-night");
}

function exitRecallNightMode() {
  document.getElementById("app").classList.remove("recall-radio-night");
}

function exitRecallImmersiveChrome() {
  document.getElementById("app").classList.remove("recall-chrome-hidden");
  // enterRecallImmersiveChrome이 재배치했던 미니 플레이어를 원래 자리
  // (#filter-banner 바로 뒤)로 되돌린다.
  const miniPlayer = document.getElementById("mini-player");
  miniPlayer.classList.remove("mini-player--floating");
  document.getElementById("filter-banner").insertAdjacentElement("afterend", miniPlayer);
}

// ------------------------------------------------------------
// 내 기억의 별자리 — 실제 지도가 아니라 별도의 "밤하늘" 캔버스에 점을 찍는다.
// ------------------------------------------------------------
function showConstellationOverview(stories) {
  recallConstellationStories = stories;
  const canvas = document.getElementById("recall-constellation-canvas");
  renderConstellationCanvas(canvas, stories);
  document.getElementById("recall-constellation-fact").textContent = buildMemoryFactSentence(stories);
  document.getElementById("recall-walk-start-btn").onclick = () => {
    hideConstellationOverview();
    beginRecallWalk(stories);
  };
  document.getElementById("recall-share-btn").onclick = shareConstellationCard;
  document.getElementById("recall-constellation").classList.remove("hidden");
}

function hideConstellationOverview() {
  document.getElementById("recall-constellation").classList.add("hidden");
}

// "당신의 1990년대 기억은 서울·부산·경주 17곳에 남아 있습니다" — 활동량을
// 점수화하지 않고, 도시명 상위 몇 개 + 장소(그룹) 개수만 담담하게
// 알려준다. 연대를 골랐으면(recallDecadeLabel) 그 맥락을 문장에도 반영한다
// (2026-08-20) — 별자리 화면만 봐도 지금 어느 시절을 보고 있는지 알 수
// 있게.
function buildMemoryFactSentence(stories) {
  const subject = recallDecadeLabel !== null ? `당신의 ${recallDecadeLabel}년대 기억은` : "당신의 기억은";
  const placeCount = Storage.groupStoriesByPlace(stories).length;

  const cityCounts = {};
  stories.forEach((s) => {
    const city = Storage.getCityLabel(s.address);
    if (!city) return;
    cityCounts[city] = (cityCounts[city] || 0) + 1;
  });
  const topCities = Object.entries(cityCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([city]) => city);

  const placeLabel = `${placeCount}곳에 남아 있습니다.`;
  if (topCities.length === 0) return `${subject} ${placeLabel}`;
  return `${subject} ${topCities.join("·")} ${placeLabel}`;
}

// 좌표를 정사각 영역(size×size, offsetX/Y만큼 이동) 안에 min-max 정규화해
// 배치한다. 위도가 클수록 화면 위쪽으로 오게 y축을 뒤집는다.
function projectStoriesToPoints(stories, size, offsetX, offsetY) {
  const padding = size * 0.14;
  const lats = stories.map((s) => s.lat);
  const lngs = stories.map((s) => s.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latSpan = maxLat - minLat;
  const lngSpan = maxLng - minLng;
  const inner = size - padding * 2;

  return stories.map((s) => ({
    story: s,
    x: offsetX + (lngSpan === 0 ? size / 2 : padding + ((s.lng - minLng) / lngSpan) * inner),
    y: offsetY + (latSpan === 0 ? size / 2 : padding + ((maxLat - s.lat) / latSpan) * inner),
  }));
}

// 온스크린 캔버스와 공유 카드 캔버스가 공용으로 쓰는 점/선 드로잉.
// 점마다 가장 가까운 이웃 "하나"만 옅게 잇는다 — 전체를 한 줄로 순서대로
// 이으면 지하철 노선도처럼 보인다는 과거 피드백(위 헤더 주석 참고)을
// 피하기 위한 의도적 선택.
function drawConstellationArt(ctx, stories, size, offsetX, offsetY) {
  const points = projectStoriesToPoints(stories, size, offsetX, offsetY);

  const drawnPairs = new Set();
  points.forEach((p, i) => {
    let nearestIdx = -1;
    let nearestDist = Infinity;
    points.forEach((q, j) => {
      if (i === j) return;
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = j;
      }
    });
    if (nearestIdx === -1) return;
    const key = [i, nearestIdx].sort((a, b) => a - b).join("-");
    if (drawnPairs.has(key)) return;
    drawnPairs.add(key);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(points[nearestIdx].x, points[nearestIdx].y);
    ctx.strokeStyle = "rgba(244, 243, 239, 0.22)";
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  points.forEach((p) => {
    const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size * 0.045);
    glow.addColorStop(0, "rgba(255, 90, 54, 0.35)");
    glow.addColorStop(1, "rgba(255, 90, 54, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size * 0.045, 0, Math.PI * 2);
    ctx.fill();

    // starPoints는 js/map.js의 마커 드로잉이 쓰는 것과 같은 별 모양 유틸.
    ctx.fillStyle = "#FF5A36";
    ctx.fill(new Path2D(starPoints(p.x, p.y, size * 0.018, size * 0.008)));
  });
}

function renderConstellationCanvas(canvasEl, stories) {
  const size = canvasEl.width;
  const ctx = canvasEl.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  drawConstellationArt(ctx, stories, size, 0, 0);
}

// ------------------------------------------------------------
// 몰입 리빌 — 한 번에 기억 하나씩
// ------------------------------------------------------------
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 큐는 뒤에서 pop()으로 꺼내 쓰므로 배열의 "마지막 항목"이 다음에 나올
// 기억이다. 재셔플 직후 방금 봤던 기억이 바로 다시 나오지 않게, 그
// 경우에만 마지막 두 항목을 바꿔준다.
function buildRecallQueue(pool, avoidId) {
  const shuffled = shuffleArray(pool);
  const lastIdx = shuffled.length - 1;
  if (avoidId && lastIdx > 0 && shuffled[lastIdx].id === avoidId) {
    [shuffled[lastIdx], shuffled[lastIdx - 1]] = [shuffled[lastIdx - 1], shuffled[lastIdx]];
  }
  return shuffled;
}

function beginRecallWalk(pool) {
  recallPool = pool;
  recallQueue = buildRecallQueue(pool, null);
  showNextRecallMemory();
}

function showNextRecallMemory() {
  hideRecallCard();
  if (recallQueue.length === 0) {
    recallQueue = buildRecallQueue(recallPool, recallCurrentStory ? recallCurrentStory.id : null);
  }
  const story = recallQueue.pop();
  recallCurrentStory = story;
  map.setLevel(4);
  map.panTo(new kakao.maps.LatLng(story.lat, story.lng));
  placeRecallDot(story);

  // 점만 띄우고 눌러야 카드가 열리면 "어딜 눌러야 할지 모르겠다"는
  // 피드백이 있어(2026-08-19), 지도 이동을 잠깐 지켜본 뒤 카드를 자동으로
  // 연다(500ms — flyToStory의 250ms 관례보다 여유를 뒀다). 그사이 사용자가
  // "다음 기억으로"를 연타하거나 회상 모드를 나갔으면 이 타이머는 무시한다
  // (recallCurrentStory가 이미 바뀌었거나 세션이 닫혔는지로 판단).
  setTimeout(() => {
    if (recallSessionOpen && recallCurrentStory === story) openRecallCard();
  }, 500);
}

function placeRecallDot(story) {
  if (recallDotMarker) recallDotMarker.setMap(null);
  recallDotMarker = new kakao.maps.Marker({
    map,
    position: new kakao.maps.LatLng(story.lat, story.lng),
    image: makeDotImage(1, false, false), // selected=false라 map.js의 5~7초 숨쉬기 애니메이션이 그대로 적용된다
    zIndex: 15,
  });
  kakao.maps.event.addListener(recallDotMarker, "click", openRecallCard);
}

function openRecallCard() {
  const story = recallCurrentStory;
  if (!story) return;

  const year = Storage.getStoryYear(story);
  // 장소 이름이 없어 주소로 폴백하는 경우, 기억 라디오에서만큼은 지번
  // 번호까지 다 보여주지 않고 동/가 레벨까지만 보여준다(2026-08-21) —
  // getGroupTitle 그대로 쓰면 "충무로4가 23-1"처럼 너무 구체적으로 나온다.
  const place = (story.placeId && story.officialPlaceName) || story.customName
    ? Storage.getGroupTitle({
        placeId: story.placeId,
        officialPlaceName: story.officialPlaceName,
        customName: story.customName,
        address: story.address,
      })
    : (story.address && Storage.getDongLevelAddress(story.address)) || "주소를 확인할 수 없는 곳";
  document.getElementById("recall-card-yearplace").innerHTML =
    `${year !== null ? year : "· · ·"} · <span class="recall-card-place">${escapeHtml(place)}</span>`;
  document.getElementById("recall-card-content").textContent = story.content;

  const videoId = Storage.extractYoutubeVideoId(story.youtubeUrl);
  if (videoId) {
    const musicLabel = story.musicTitle
      ? story.musicArtist
        ? `${story.musicArtist} · ${story.musicTitle}`
        : story.musicTitle
      : "";

    // 미니 플레이어를 카드 안 DOM으로 옮겨 넣었던 적이 있었는데(2026-08-20,
    // 곡 정보 줄 자리에 끼워 넣는 디자인), 그 DOM 이동(referenceEl.after)
    // 자체가 iframe을 재초기화시켜 그 직후 보낸 재생 명령이 유실되는
    // 원인이었을 가능성이 높아 되돌렸다 — 일반 카드 재생(DOM 이동 없음)은
    // 이 세션 내내 안정적이었는데 회상 카드만 계속 실패한 유일한 구조적
    // 차이가 이 DOM 이동이었다. 화면 하단 고정 바 그대로 쓴다(z-index는
    // 이미 회상 모달보다 높게 고쳐둠).
    playMiniPlayerVideo(videoId, musicLabel);
  }

  document.getElementById("recall-card").classList.add("recall-card--visible");
}

function hideRecallCard() {
  document.getElementById("recall-card").classList.remove("recall-card--visible");
}

function advanceRecall() {
  stopMiniPlayer();
  showNextRecallMemory();
}

function endRecallSession() {
  stopMiniPlayer();
  if (recallDotMarker) {
    recallDotMarker.setMap(null);
    recallDotMarker = null;
  }
  hideRecallCard();
  hideConstellationOverview();
  document.getElementById("recall-session").classList.add("hidden");
  exitRecallImmersiveChrome();
  exitRecallNightMode();

  recallSessionOpen = false;
  recallScope = null;
  recallPool = [];
  recallQueue = [];
  recallCurrentStory = null;
  recallConstellationStories = null;
  recallDecadeLabel = null;

  renderMarkers();
}

// 연대를 골랐으면 "나의 1990년대 기억 지도", 안 골랐으면("전체") 기존
// 그대로 "나의 {오늘 연도}년 기억 지도".
function getConstellationTitle() {
  return recallDecadeLabel !== null
    ? `나의 ${recallDecadeLabel}년대 기억 지도`
    : `나의 ${new Date().getFullYear()}년 기억 지도`;
}

// ------------------------------------------------------------
// 나의 {연도}년/{연대}년대 기억 지도 — 공유 이미지
// ------------------------------------------------------------
function generateConstellationShareCard(stories) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");
  drawShareCardBase(ctx, canvas);

  const marginX = 96;
  const maxWidth = canvas.width - marginX * 2;

  ctx.font = "700 64px sans-serif";
  ctx.fillStyle = "#F4F3EF";
  ctx.fillText(getConstellationTitle(), marginX, 300);

  const artSize = 760;
  const artX = (canvas.width - artSize) / 2;
  const artY = 380;
  drawConstellationArt(ctx, stories, artSize, artX, artY);

  ctx.font = "400 40px serif";
  ctx.fillStyle = "#F4F3EF";
  const factLines = wrapCanvasText(ctx, buildMemoryFactSentence(stories), maxWidth);
  const factY = artY + artSize + 100;
  factLines.forEach((line, i) => ctx.fillText(line, marginX, factY + i * 56));

  const footerY = canvas.height - 200;
  ctx.font = "700 38px sans-serif";
  ctx.fillStyle = "#F4F3EF";
  ctx.fillText("지도에서 이 기억들을", marginX, footerY);
  ctx.fillText("다시 걸어보세요 →", marginX, footerY + 52);

  drawShareCardBrandFooter(ctx, canvas, marginX);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

async function shareConstellationCard() {
  const stories = recallConstellationStories;
  if (!stories || !stories.length) return;

  const btn = document.getElementById("recall-share-btn");
  if (btn) btn.disabled = true;

  let blob;
  try {
    blob = await generateConstellationShareCard(stories);
  } catch (e) {
    showToast("share-toast", "카드 이미지를 만들지 못했어요.", 2000);
    if (btn) btn.disabled = false;
    return;
  }
  if (btn) btn.disabled = false;
  if (!blob) return;

  const shareText = getConstellationTitle();
  const file = new File([blob], "concrete-sapiens-my-memory-map.png", { type: "image/png" });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ title: "콘크리트 사피엔스 지도", text: shareText, files: [file] });
      return;
    } catch (e) {
      // 공유 시트를 취소했거나 실패 — 아래 다운로드로 넘어가지 않고 그냥 종료
      return;
    }
  }

  const imgUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = imgUrl;
  a.download = "concrete-sapiens-my-memory-map.png";
  a.click();
  URL.revokeObjectURL(imgUrl);
  showToast("share-toast", "카드 이미지가 다운로드되었습니다.", 2000);
}

function bindRecallEvents() {
  bindOverlayClickToClose("recall-choice-overlay", closeRecallChoice);
  document.getElementById("recall-exit-btn").onclick = endRecallSession;
  document.getElementById("recall-card-next-btn").onclick = advanceRecall;

  // 기억 라디오에서만 곡이 끝나면 자동으로 다음 기억으로 넘어간다 —
  // 기억산책(scope="mine")이나 일반 카드 재생 중엔 아무것도
  // 하지 않는다(storySheet.js의 미니 플레이어는 이 화면 밖에서도 쓰이므로,
  // 콜백 안에서 매번 지금이 정말 플레이리스트 세션인지 확인한다).
  setMiniPlayerEndedCallback(() => {
    if (recallSessionOpen && recallScope === "songs") advanceRecall();
  });
}
