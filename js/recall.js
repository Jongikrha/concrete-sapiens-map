// ============================================================
// 기억산책 / 회상 모드 + 내 기억의 별자리 + 기억 라디오(랜덤 플레이리스트)
// ============================================================
// 이 파일은 두 진입점을 담당한다.
//
// 1) 하단 "내 기억" 버튼(js/filters.js의 toggleMyMemoryMode) — 기존
//    "지도에서 내 기억 보기"(startMyMemoryMode, 무변경)와 "기억산책"
//    (startRecallConstellation, scope="mine") 중 고른다. 기억산책은 몰입
//    리빌 전에 별자리 개요(showConstellationOverview)를 먼저 보여준다.
//    선택 패널은 filters.js의 openTodayMission()과 같은 패턴 —
//    #recall-choice-panel의 innerHTML만 갈아끼운다.
// 2) 하단 "기억 라디오" 버튼(startMemoryRadio, scope="songs", 구 "어딘가의
//    기억") — 이 서비스의 핵심 기능으로 두기로 해서(2026-08-19) 툴바에서
//    혼자 크게 뜬다. 내 기억을 포함한 전체 공개 기억 중 노래가 첨부된
//    것만 모아 랜덤 플레이리스트처럼 계속 재생하고, 지도도 밤처럼
//    어둡게 바꾼다(enterRecallNightMode — 기억산책엔 안 준다, 개인적
//    산책과 배경 라디오의 분위기를 다르게 두려는 의도). 첫 곡만 "N초 후
//    재생됩니다" 예고를 보여주고, 그다음부터는(곡이 끝나 자동으로
//    넘어가든 "다음 기억으로"를 직접 누르든) 예고 없이 바로 재생된다 —
//    켜놓고 다른 일을 해도 되게.
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
// "5초 후 재생됩니다" 예고 후 실제 재생을 거는 타이머 — 카드가 바뀌거나
// (hideRecallCard) 회상 모드가 끝나면 반드시 clearTimeout해서 엉뚱한
// 타이밍에 다른 곡이 재생되지 않게 한다.
let recallMusicTimer = null;
// 기억 라디오(scope="songs")에서 "예고 없이 바로 재생" 구간에 들어섰는지
// — 세션의 첫 곡 카드에서만 false, 그 뒤로는 계속 true. beginRecallWalk()가
// 새 세션마다 리셋한다.
let recallPlaylistStarted = false;
// 별자리 개요에서 쓴 스토리 목록 — 공유 카드 생성 시 다시 계산하지 않고 재사용.
let recallConstellationStories = null;

// ------------------------------------------------------------
// "내 기억" 버튼의 선택지 — 지도에서 보기 / 기억산책
// ------------------------------------------------------------
function openRecallEntryChoice() {
  const panel = document.getElementById("recall-choice-panel");
  panel.innerHTML = `
    <div class="daily-prompt-header">
      <span class="daily-prompt-label"><span class="daily-prompt-dot"></span>내 기억</span>
      <button class="daily-prompt-close" id="recall-choice-close" aria-label="닫기">✕</button>
    </div>
    <p class="daily-prompt-hint">어떻게 보고 싶으세요?</p>
    <div class="daily-prompt-divider"></div>
    <button class="btn-primary" id="recall-choice-map-btn">지도에서 내 기억 보기</button>
    <button class="btn-secondary" id="recall-choice-walk-btn" style="margin-top:8px;">기억산책</button>
  `;
  panel.querySelector("#recall-choice-close").onclick = closeRecallChoice;
  panel.querySelector("#recall-choice-map-btn").onclick = () => {
    closeRecallChoice();
    startMyMemoryMode();
  };
  panel.querySelector("#recall-choice-walk-btn").onclick = () => {
    closeRecallChoice();
    startRecallConstellation();
  };
  document.getElementById("recall-choice-overlay").classList.remove("hidden");
}

function closeRecallChoice() {
  document.getElementById("recall-choice-overlay").classList.add("hidden");
}

// ------------------------------------------------------------
// 진입 — 범위별로 풀을 구성한 뒤 세션을 연다
// ------------------------------------------------------------
async function startRecallConstellation() {
  const stories = await buildMyMemoryList("posted");
  if (!stories.length) {
    showToast("entry-toast", "아직 남긴 기억이 없어요", 2400);
    return;
  }
  recallScope = "mine";
  openRecallSessionShell();
  showConstellationOverview(stories);
}

// 하단 "기억 라디오" 버튼(구 "어딘가의 기억") — 내 기억을 포함한 전체
// 공개 기억 중 노래가 첨부된 것만 모아 랜덤 플레이리스트처럼 계속
// 재생한다(2026-08-19).
function startMemoryRadio() {
  const pool = Storage.getVisibleStories().filter((s) => Storage.extractYoutubeVideoId(s.youtubeUrl));
  if (!pool.length) {
    showToast("entry-toast", "아직 노래가 담긴 기억이 없어요", 2400);
    return;
  }
  recallScope = "songs";
  openRecallSessionShell();
  beginRecallWalk(pool);
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
}

function enterRecallNightMode() {
  document.getElementById("app").classList.add("recall-radio-night");
}

function exitRecallNightMode() {
  document.getElementById("app").classList.remove("recall-radio-night");
}

function exitRecallImmersiveChrome() {
  document.getElementById("app").classList.remove("recall-chrome-hidden");
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

// "당신의 기억은 서울·부산·경주 17곳에 남아 있습니다" — 활동량을 점수화하지
// 않고, 도시명 상위 몇 개 + 장소(그룹) 개수만 담담하게 알려준다.
function buildMemoryFactSentence(stories) {
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
  if (topCities.length === 0) return `당신의 기억은 ${placeLabel}`;
  return `당신의 기억은 ${topCities.join("·")} ${placeLabel}`;
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
  recallPlaylistStarted = false;
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
  const place = Storage.getGroupTitle({
    placeId: story.placeId,
    officialPlaceName: story.officialPlaceName,
    customName: story.customName,
    address: story.address,
  });
  document.getElementById("recall-card-yearplace").innerHTML =
    `${year !== null ? year : "· · ·"} · <span class="recall-card-place">${escapeHtml(place)}</span>`;
  document.getElementById("recall-card-content").textContent = story.content;

  const musicEl = document.getElementById("recall-card-music");
  if (recallMusicTimer) {
    clearTimeout(recallMusicTimer);
    recallMusicTimer = null;
  }
  const videoId = Storage.extractYoutubeVideoId(story.youtubeUrl);
  if (videoId) {
    // "🎵 아티스트 — 곡명" 텍스트 줄은 없앴다(2026-08-20 피드백) — 미니
    // 플레이어 자체가 제목을 보여주는데 바로 위에 같은 정보가 텍스트로도
    // 한 번 더 나오는 게 중복이었다. musicEl은 항상 hidden 상태로 두고
    // (index.html 기본값) 미니 플레이어를 끼워 넣을 자리 표시로만 쓴다 —
    // 화면 하단에 따로 뜨는 바 대신 여기(곡 정보가 있던 자리) 카드 안에
    // 들어간다. 회상 카드는 곡이 바뀔 때마다 항상 정지 후 다시 재생해서
    // (advanceRecall의 stopMiniPlayer) 화면을 벗어나도 이어 듣는 시나리오가
    // 없어, 시트 밖 상시 바로 뺄 이유가 없다.
    attachMiniPlayerAfter(musicEl);
    const musicLabel = story.musicTitle
      ? story.musicArtist
        ? `${story.musicArtist} · ${story.musicTitle}`
        : story.musicTitle
      : "";

    // 기억산책(scope="mine")은 카드마다 매번 예고 후 재생 — 조용한 곳에서
    // 갑자기 소리가 나면 놀랄 수 있어서다(2026-08-19 피드백). 기억 라디오
    // (scope="songs")는 "켜놓고 다른 일을 해도 되는" 경험이 목적이라 첫
    // 곡에서만 예고하고, 그 뒤로는(곡이 끝나 자동으로 넘어가든 직접 다음
    // 으로 넘기든) 예고 없이 바로 이어 재생한다. 텍스트 예고 문구는
    // 없앴지만, 음소거 상태로 미리 재생해뒀다가 5초 뒤 음소거만 푸는
    // 동작 자체는 그대로 유지한다(조용한 곳에서 갑자기 소리가 나지 않게).
    const isPlaylist = recallScope === "songs";
    const needsWarning = !isPlaylist || !recallPlaylistStarted;

    if (needsWarning) {
      // 실제 재생은 지금(카드가 뜨는 시점, 아직 탭의 유효기간 안) 음소거로
      // 미리 걸어두고, 5초 뒤엔 음소거만 푼다 — playMiniPlayerVideo 아래
      // unmuteMiniPlayerIfStillPlaying 설명 참고.
      playMiniPlayerVideo(videoId, musicLabel, { muted: true });
      recallMusicTimer = setTimeout(() => {
        recallMusicTimer = null;
        if (!recallSessionOpen || recallCurrentStory !== story) return;
        unmuteMiniPlayerIfStillPlaying(videoId);
      }, 5000);
    } else {
      playMiniPlayerVideo(videoId, musicLabel);
    }
    if (isPlaylist) recallPlaylistStarted = true;
  } else {
    restoreMiniPlayerHome();
  }

  document.getElementById("recall-card").classList.add("recall-card--visible");
}

function hideRecallCard() {
  document.getElementById("recall-card").classList.remove("recall-card--visible");
  if (recallMusicTimer) {
    clearTimeout(recallMusicTimer);
    recallMusicTimer = null;
  }
}

function advanceRecall() {
  stopMiniPlayer();
  showNextRecallMemory();
}

function endRecallSession() {
  stopMiniPlayer();
  restoreMiniPlayerHome();
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
  recallPlaylistStarted = false;
  recallConstellationStories = null;

  renderMarkers();
}

// ------------------------------------------------------------
// 나의 {연도}년 기억 지도 — 공유 이미지
// ------------------------------------------------------------
function generateConstellationShareCard(stories) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");
  drawShareCardBase(ctx, canvas);

  const marginX = 96;
  const maxWidth = canvas.width - marginX * 2;
  const year = new Date().getFullYear();

  ctx.font = "700 64px sans-serif";
  ctx.fillStyle = "#F4F3EF";
  ctx.fillText(`나의 ${year}년 기억 지도`, marginX, 300);

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

  const year = new Date().getFullYear();
  const shareText = `나의 ${year}년 기억 지도`;
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
