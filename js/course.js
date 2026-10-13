// ============================================================
// 발자취(코스) 따라 걷기 (2026-10-13)
// ============================================================
// 운영자가 어드민 "발자취" 탭에서 만든 코스(amplify/data/resource.ts의
// Course/CoursePlace)를 지도 위에서 순서대로 걸어보는 모드. 첫 코스는 책
// 『콘크리트 사피엔스』 속 장소이고, 이후 인물 발자취/드라마 촬영지 등으로
// 늘어나도 이 화면 하나를 같이 쓴다.
//
// 진입은 상단 "발자취" 칩 하나(코스마다 칩을 만들면 칩 줄이 넘친다) —
// 공개 코스가 하나뿐이면 바로 들어가고, 여럿이면 코스 목록부터 고른다.
// 화면 구성은 기억산책(js/recall.js)과 같은 리듬: 평소 UI를 옅게 지우고
// (enterRecallImmersiveChrome 재사용), 아래 카드로 한 곳씩 넘겨본다.
// 기억산책과 다른 점은 장소가 정해진 순서로 이어진다는 것 — 번호 핀과
// 옅은 점선으로 길을 보여준다. 코스가 관광 안내가 아니라 기억을 모으는
// 장치가 되도록 마지막 장소 뒤에 마무리 카드를 두고 거기서 한 번만 "당신의
// 기억도 남겨보세요"라고 묻는다 — 처음엔 장소 카드마다 "여기에 내 기억
// 남기기"와 근처 기억 수를 붙였는데, 누르면 따라 걷기가 끊기고 둘러보는
// 흐름 중간에 끼어든다는 피드백으로 옮겼다(2026-10-13).

let publishedCourses = [];
let courseModeOpen = false;
let activeCourse = null;
// -1은 코스 소개 카드(전체 경로를 한눈에), 0부터는 장소 순서,
// places.length는 마무리 카드(다시 전체 경로)
let courseIndex = -1;
let courseOverlays = []; // kakao.maps.CustomOverlay — 번호 핀
let coursePolyline = null;
// 이번 따라 걷기의 플레이리스트 — 노래가 있는 장소들을 코스 순서대로
// (같은 곡은 한 번만). 끝낼 때 미니 플레이어가 여전히 이 중 하나면 멈춘다
// (사용자가 중간에 다른 곡으로 바꿨으면 그대로 둔다).
let courseSongs = [];

async function loadPublishedCourses() {
  try {
    publishedCourses = await Storage.fetchPublishedCourses();
  } catch (e) {
    console.error("발자취 불러오기 실패", e);
    publishedCourses = [];
  }
  renderHashtagChips();
}

// 해시태그 줄 맨 앞의 "발자취" 칩(js/filters.js renderHashtagChips가 줄을
// 새로 그릴 때마다 부른다). 해시태그/연도/곡 필터가 걸려 있으면 그쪽에서
// 먼저 return해 칩이 안 생기고, 시간여행/내 기억 모드에선 해시태그 칩과
// 똑같이 남아 있다(누르면 startCourseWalk가 그 모드들을 닫는다).
//
// 칩 문구는 "발자취"만으로는 눌렀을 때 뭐가 나올지 짐작이 안 돼서
// (2026-10-13), 공개 코스가 하나면 "<코스 이름> 따라 걷기"로 무엇을
// 따라가는지 보여준다. 코스 로고가 있으면 앞에 작게 붙이고, 없으면 종류별
// 이모지(책이면 📖). 코스가 여럿이면 목록부터 고르니 "발자취 N".
const COURSE_KIND_EMOJI = { book: "📖", person: "👣", drama: "🎬", org: "👣", etc: "👣" };

function buildCourseChip() {
  if (publishedCourses.length === 0) return null;
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip course-entry";
  chip.onclick = handleCourseEntryClick;
  if (publishedCourses.length > 1) {
    chip.textContent = `발자취 ${publishedCourses.length}`;
    return chip;
  }
  const course = publishedCourses[0];
  const icon = document.createElement("span");
  icon.className = "course-entry-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = course.logoKey ? "" : COURSE_KIND_EMOJI[course.kind] || "👣";
  chip.append(icon, `${course.title} 따라 걷기`);
  if (course.logoKey) {
    resolveStoryPhotoUrl(course.logoKey).then((url) => {
      if (!url) {
        icon.textContent = COURSE_KIND_EMOJI[course.kind] || "👣";
        return;
      }
      const img = document.createElement("img");
      img.alt = "";
      img.src = url;
      icon.replaceChildren(img);
    });
  }
  return chip;
}

function handleCourseEntryClick() {
  if (publishedCourses.length === 1) {
    startCourseWalk(publishedCourses[0]);
    return;
  }
  openCourseChoice();
}

function openCourseChoice() {
  const panel = document.getElementById("course-choice-panel");
  panel.innerHTML = `
    <div class="composer-header">
      <div class="composer-header-text">
        <h2 class="composer-title">발자취</h2>
        <p class="composer-subtitle">정해진 장소들을 순서대로 따라 걸어보세요.</p>
      </div>
      <button class="composer-close-btn" id="course-choice-close" aria-label="닫기">✕</button>
    </div>
    <div class="course-choice-list">
      ${publishedCourses.map((c, i) => `
        <button type="button" class="course-choice-item" data-course-index="${i}">
          <span class="course-choice-title">${escapeHtml(c.title)}</span>
          ${c.description ? `<span class="course-choice-desc">${escapeHtml(c.description)}</span>` : ""}
          <span class="course-choice-meta">장소 ${c.places.length}곳</span>
        </button>
      `).join("")}
    </div>
  `;
  document.getElementById("course-choice-close").onclick = closeCourseChoice;
  panel.querySelectorAll(".course-choice-item").forEach((btn) => {
    btn.onclick = () => {
      closeCourseChoice();
      startCourseWalk(publishedCourses[Number(btn.dataset.courseIndex)]);
    };
  });
  document.getElementById("course-choice-overlay").classList.remove("hidden");
}

function closeCourseChoice() {
  document.getElementById("course-choice-overlay").classList.add("hidden");
}

function startCourseWalk(course) {
  if (recallSessionOpen || courseModeOpen) return;
  clearFilters();
  closeSlider();
  closeMyMemoryMode();
  if (sheetOpen) closeSheet();
  clearSearchPin();
  // 기억 점들은 잠시 걷어낸다 — 번호 핀과 섞이면 어느 게 코스인지 안
  // 보이고, 기억 점을 누르면 열리는 카드가 이 화면 카드와 겹친다.
  // 대신 장소 카드에 "근처에 남겨진 기억 N개"로 알려준다.
  clusterer.clear();

  activeCourse = course;
  courseModeOpen = true;
  enterRecallImmersiveChrome();
  drawCoursePath();
  document.getElementById("course-session").classList.remove("hidden");
  Storage.logEvent(`course_started:${course.slug}`);
  courseSongs = buildCourseSongs(course);
  // 소개 카드에선 아무 노래도 나오지 않는다 — 다른 기억 카드에서 틀어둔
  // 노래도 여기서 끊는다(js/recall.js openRecallSessionShell과 같은 이유).
  stopMiniPlayer();
  showCourseStep(-1);
}

// 음악은 기억 라디오처럼 내용과 따로 흐른다(2026-10-13) — 처음엔 코스
// 배경음악 한 곡 + 장소 노래로 갈아끼우는 방식이었는데, 카드를 넘길 때마다
// 노래가 바뀌거나 끊겨 산만하다는 피드백으로 바꿨다. 노래 있는 장소들을
// 코스 순서대로 한 곡씩 끝까지 틀고, 카드를 넘겨도 노래는 그대로 둔다.
// 첫 곡은 노래가 있는 장소 카드에 처음 도착했을 때 그 장소 곡으로 시작한다
// (소개 카드는 무음, 2026-10-13 요청) — "따라 걷기 시작"/핀 탭 이벤트
// 안에서 트는 것이라 모바일 자동재생 제한에도 안 걸린다. 미니 플레이어
// 재배치(enterRecallImmersiveChrome)로 iframe이 다시 로드된 직후 같은 틱에
// 틀면 명령이 묻혀 모바일에서 소리가 안 났던 적이 있는데(2026-10-13), 이
// 시점엔 이미 로드가 끝나 있다.
// 코스 배경음악(Course.youtubeUrl)은 더 쓰지 않는다(필드는 DB에 남아 있음).
function buildCourseSongs(course) {
  const seen = new Set();
  return course.places
    .map((p) => ({ videoId: Storage.extractYoutubeVideoId(p.youtubeUrl), title: p.musicTitle, artist: p.musicArtist }))
    .filter((s) => s.videoId && !seen.has(s.videoId) && seen.add(s.videoId));
}

function playCourseSongAt(i) {
  const song = courseSongs[i];
  playMiniPlayerVideo(song.videoId, { title: song.title, artist: song.artist });
}

function startCourseMusicAt(place) {
  if (courseSongs.some((s) => s.videoId === activeMiniPlayerVideoId)) return; // 이미 흐르는 중
  const videoId = Storage.extractYoutubeVideoId(place.youtubeUrl);
  const i = courseSongs.findIndex((s) => s.videoId === videoId);
  if (i >= 0) playCourseSongAt(i);
}

// 곡이 끝나면 다음 곡으로(마지막 곡 뒤엔 처음으로) — js/recall.js
// bindRecallEvents의 미니 플레이어 종료 콜백이 발자취 중일 때 부른다.
// 기억 라디오(handleRadioSongEnded)처럼, 카드를 넘겨봐서 지금 보고 있는
// 장소의 노래가 방금 끝난 곡과 다르면 그 장소 노래로 이어간다(카드와 노래를
// 다시 맞춘다). 같거나 노래 없는 장소면 코스 순서상 다음 곡으로.
function handleCourseSongEnded() {
  const i = courseSongs.findIndex((s) => s.videoId === activeMiniPlayerVideoId);
  if (i < 0) return; // 사용자가 다른 곡으로 바꿔 들은 경우 — 손대지 않는다
  const place = activeCourse.places[courseIndex];
  const placeSongIndex = place ? courseSongs.findIndex((s) => s.videoId === Storage.extractYoutubeVideoId(place.youtubeUrl)) : -1;
  playCourseSongAt(placeSongIndex >= 0 && placeSongIndex !== i ? placeSongIndex : (i + 1) % courseSongs.length);
}

// ------------------------------------------------------------
// 장소 카드 안 "이 장소의 노래" 카드 — 기억 라디오 노래 카드(js/recall.js
// refreshRecallSongCard)와 같은 마크업/스타일(.recall-song)을 쓴다. 노래가
// 있는 장소면 항상 보이고, 재생 버튼은 지금 흐르는 곡이 이 장소 곡이 아니면
// 그 곡으로 바꿔 틀고(이후 플레이리스트는 그 곡부터 이어짐), 이미 이 곡이면
// 미니 플레이어 일시정지 ⇄ 재생과 같다. 장소는 사용자 기억이 아니라서
// 하트(떠올랐어요)는 뺐다. 실제 소리는 미니 플레이어가 낸다.
// ------------------------------------------------------------
let courseSongTicker = null;

function courseSongCardHtml(place) {
  const videoId = Storage.extractYoutubeVideoId(place.youtubeUrl);
  if (!videoId) return "";
  return `
    <div class="recall-song" id="course-song">
      <div class="recall-song-art" aria-hidden="true">
        <div class="recall-song-disc"></div>
        <div class="recall-song-arm"></div>
      </div>
      <div class="recall-song-body">
        <p class="recall-song-label">
          <svg class="recall-song-label-icon" viewBox="0 0 16 12" width="16" height="12" aria-hidden="true">
            <g stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
              <line x1="1" y1="5" x2="1" y2="7" /><line x1="4" y1="3" x2="4" y2="9" /><line x1="7" y1="1" x2="7" y2="11" />
              <line x1="10" y1="3" x2="10" y2="9" /><line x1="13" y1="5" x2="13" y2="7" />
            </g>
          </svg>
          <span id="course-song-label-text">이 장소의 노래 듣기</span>
        </p>
        <p class="recall-song-title">${escapeHtml(place.musicTitle || "이 장소의 노래")}</p>
        <p class="recall-song-artist">${escapeHtml(place.musicArtist || "")}</p>
        <div class="recall-song-controls">
          <button type="button" class="recall-song-play" id="course-song-play" aria-label="이 장소의 노래 듣기">
            <svg class="recall-song-icon-play" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg>
            <svg class="recall-song-icon-pause" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="6.5" y="5.5" width="4" height="13" rx="1" fill="currentColor" /><rect x="13.5" y="5.5" width="4" height="13" rx="1" fill="currentColor" /></svg>
          </button>
          <div class="recall-song-wave" id="course-song-wave" aria-hidden="true">${buildSongWaveBars(videoId, RECALL_SONG_WAVE_BARS)}</div>
          <span class="recall-song-time" id="course-song-time"></span>
        </div>
      </div>
    </div>`;
}

function bindCourseSongCard(place) {
  const btn = document.getElementById("course-song-play");
  if (!btn) return;
  const videoId = Storage.extractYoutubeVideoId(place.youtubeUrl);
  btn.onclick = () => {
    if (activeMiniPlayerVideoId === videoId) toggleMiniPlayerPause();
    else playCourseSongAt(courseSongs.findIndex((s) => s.videoId === videoId));
    refreshCourseSongCard();
  };
  refreshCourseSongCard();
  courseSongTicker = setInterval(refreshCourseSongCard, 500);
}

function refreshCourseSongCard() {
  const box = document.getElementById("course-song");
  const place = activeCourse && activeCourse.places[courseIndex];
  if (!box || !place) return;
  const videoId = Storage.extractYoutubeVideoId(place.youtubeUrl);
  const isThisSong = !!videoId && activeMiniPlayerVideoId === videoId;
  const isPlaying = isThisSong && !miniPlayerPaused;
  box.classList.toggle("recall-song--active", isThisSong);
  box.classList.toggle("recall-song--playing", isPlaying);
  document.getElementById("course-song-label-text").textContent = isThisSong ? "지금 흐르는 노래" : "이 장소의 노래 듣기";
  document.getElementById("course-song-play").setAttribute("aria-label", isPlaying ? "일시정지" : "재생");
  const duration = isThisSong && ytPlayer && typeof ytPlayer.getDuration === "function" ? ytPlayer.getDuration() : 0;
  const current = duration ? ytPlayer.getCurrentTime() || 0 : 0;
  document.getElementById("course-song-time").textContent = duration ? formatRecallSongTime(duration - current) : "";
  markPlayedWaveBars(document.getElementById("course-song-wave"), duration ? current / duration : 0);
}

function stopCourseSongTicker() {
  clearInterval(courseSongTicker);
  courseSongTicker = null;
}

function drawCoursePath() {
  const path = activeCourse.places.map((p) => new kakao.maps.LatLng(p.lat, p.lng));
  // 예전에 기억 점들을 선으로 이었다가 "지하철 노선도 같다"는 피드백으로
  // 뺀 적이 있어(js/map.js renderMarkers 주석) 굵은 실선 대신 옅은 점선으로
  // "이어지는 길"이라는 느낌만 준다.
  if (path.length > 1) {
    coursePolyline = new kakao.maps.Polyline({
      map,
      path,
      strokeWeight: 3,
      strokeColor: "#FF5A36",
      strokeOpacity: 0.55,
      strokeStyle: "shortdash",
    });
  }
  courseOverlays = activeCourse.places.map((p, i) => {
    const el = document.createElement("button");
    el.type = "button";
    // 동그라미+숫자는 카카오맵의 지하철 출구 번호(①②)와 똑같아 보여서,
    // 기억 남기기 완료 화면의 핀(js/composer.js .wizard-done-pin)과 같은
    // 물방울 모양 안에 숫자를 넣는다.
    // 로고가 있는 코스는 물방울 대신 로고만 담은 흰 말풍선 배지로 그린다
    // (주황 물방울 안에 로고를 넣었더니 로고가 작고 붉은 테두리만 눈에
    // 띈다는 피드백, 2026-10-13).
    el.className = activeCourse.logoKey ? "course-pin course-pin--logo" : "course-pin";
    el.dataset.seq = String(i + 1);
    el.innerHTML = activeCourse.logoKey ? `<span class="course-pin-logo"></span>` : numberPinHtml(i + 1);
    el.setAttribute("aria-label", `${i + 1}번째 장소 ${p.name}`);
    el.onclick = () => showCourseStep(i);
    if (activeCourse.logoKey) hydrateCoursePinLogo(el, activeCourse.logoKey);
    return new kakao.maps.CustomOverlay({
      map,
      position: new kakao.maps.LatLng(p.lat, p.lng),
      content: el,
      yAnchor: 1, // 물방울 끝이 장소를 가리키게
      zIndex: 20,
    });
  });
}

// 코스 로고가 있으면 핀 안에 번호 대신 로고를 넣는다 — 순서는 카드의
// "1 / 3"과 점선이 보여주므로 핀은 "이 코스의 장소" 표시만 한다. URL을 못
// 받으면 번호로 되돌린다.
function numberPinHtml(n) {
  return `
    <svg class="course-pin-shape" viewBox="0 0 30 38" aria-hidden="true">
      <path d="M15 1C7.3 1 1 7.1 1 14.7 1 24.4 15 37 15 37s14-12.6 14-22.3C29 7.1 22.7 1 15 1z" />
    </svg>
    <span class="course-pin-num">${n}</span>`;
}

function hydrateCoursePinLogo(el, logoKey) {
  resolveStoryPhotoUrl(logoKey).then((url) => {
    const slot = el.querySelector(".course-pin-logo");
    if (!slot) return;
    if (!url) {
      el.classList.remove("course-pin--logo");
      el.innerHTML = numberPinHtml(Number(el.dataset.seq));
      return;
    }
    const img = document.createElement("img");
    img.alt = "";
    img.src = url;
    slot.replaceChildren(img);
  });
}

function fitCourseBounds() {
  const bounds = new kakao.maps.LatLngBounds();
  activeCourse.places.forEach((p) => bounds.extend(new kakao.maps.LatLng(p.lat, p.lng)));
  if (activeCourse.places.length === 1) {
    map.setLevel(4);
    map.panTo(bounds.getCenter());
    return;
  }
  // 아래 카드가 지도 아래쪽을 덮으므로 아래 여백을 크게 준다.
  map.setBounds(bounds, 120, 60, 320, 60);
}

function showCourseStep(index) {
  if (!courseModeOpen) return;
  courseIndex = index;
  courseOverlays.forEach((o, i) => {
    o.getContent().classList.toggle("course-pin--active", i === index);
    o.setZIndex(i === index ? 30 : 20);
  });

  const total = activeCourse.places.length;
  // 미니 플레이어가 나타나면 아래 지도 위치 계산(topEdge)이 달라지므로
  // 카드/지도 이동보다 먼저 튼다.
  if (index >= 0 && index < total) startCourseMusicAt(activeCourse.places[index]);
  renderCourseCard();
  if (index < 0 || index >= total) {
    fitCourseBounds();
  } else {
    const place = activeCourse.places[index];
    map.setLevel(4);
    map.setCenter(new kakao.maps.LatLng(place.lat, place.lng));
    // 지도 정중앙에 두면 아래 카드에 가려지므로(특히 모바일), 카드 위로
    // 남는 영역의 가운데에 장소가 오도록 지도 중심을 그만큼 아래로 민다.
    // 노래가 나오는 중이면 위쪽 미니 플레이어 아래부터를 남는 영역으로 본다.
    const mapHeight = document.getElementById("map").clientHeight;
    const cardTop = document.getElementById("course-card").getBoundingClientRect().top;
    const miniPlayer = document.getElementById("mini-player");
    const topEdge = miniPlayer.classList.contains("hidden") ? 0 : miniPlayer.getBoundingClientRect().bottom;
    const offset = Math.max(0, mapHeight / 2 - (topEdge + cardTop) / 2);
    if (offset > 0) map.panBy(0, offset);
  }
  if (index === activeCourse.places.length - 1) Storage.logEvent(`course_completed:${activeCourse.slug}`);
}

function renderCourseCard() {
  stopCourseSongTicker();
  const card = document.getElementById("course-card");
  const total = activeCourse.places.length;
  const isIntro = courseIndex < 0;
  const isLast = courseIndex === total - 1;
  const isOutro = courseIndex >= total;

  let body;
  if (isIntro) {
    body = `
      <p class="course-card-kicker">발자취 · 장소 ${total}곳</p>
      <h2 class="course-card-title">${escapeHtml(activeCourse.title)}</h2>
      ${activeCourse.description ? `<p class="story-content">${escapeHtml(activeCourse.description)}</p>` : ""}
      ${activeCourse.linkUrl ? `<a class="course-card-link" href="${escapeHtml(activeCourse.linkUrl)}" target="_blank" rel="noopener">더 알아보기 ›</a>` : ""}
    `;
  } else if (isOutro) {
    body = `
      <p class="course-card-kicker">${escapeHtml(activeCourse.title)} · 장소 ${total}곳을 모두 둘러봤어요</p>
      <h2 class="course-card-title">이 길 위에 당신의 기억도 있나요?</h2>
      <p class="story-content">지나온 곳 어딘가에 얽힌 기억이 있다면 지도에 남겨주세요.</p>
    `;
  } else {
    const place = activeCourse.places[courseIndex];
    body = `
      ${place.photoKey ? `<div class="recall-card-photo" id="course-card-photo"></div>` : ""}
      <p class="course-card-kicker">${escapeHtml(activeCourse.title)} · ${courseIndex + 1} / ${total}</p>
      ${place.label ? `<p class="course-card-label">${escapeHtml(place.label)}</p>` : ""}
      <h2 class="course-card-title">${escapeHtml(place.name)}</h2>
      ${place.description ? `<p class="story-content">${escapeHtml(place.description)}</p>` : ""}
      ${place.quote ? `<blockquote class="course-card-quote">${escapeHtml(place.quote)}</blockquote>` : ""}
      ${courseSongCardHtml(place)}
    `;
  }

  const nextLabel = isIntro ? "따라 걷기 시작" : isOutro ? "내 기억 남기기" : isLast ? "다 둘러봤어요" : "다음 장소로";
  card.innerHTML = `
    ${body}
    <div class="recall-card-nav">
      <button type="button" class="recall-card-prev-btn" id="course-card-prev-btn" aria-label="이전 장소"${isIntro ? " disabled" : ""}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M20 12H5m6-6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      <button type="button" class="btn-primary recall-card-next-btn" id="course-card-next-btn">
        <span>${nextLabel}</span>
        <svg class="recall-card-next-arrow" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
    </div>
  `;
  card.scrollTop = 0;
  card.classList.add("recall-card--visible");

  document.getElementById("course-card-prev-btn").onclick = () => showCourseStep(courseIndex - 1);
  document.getElementById("course-card-next-btn").onclick = isOutro ? writeMemoryAfterCourse : () => showCourseStep(courseIndex + 1);
  if (!isIntro && !isOutro) {
    renderCoursePlacePhoto(activeCourse.places[courseIndex]);
    bindCourseSongCard(activeCourse.places[courseIndex]);
  }
}

// 장소 사진 — 기억산책 카드 사진(js/recall.js renderRecallCardPhoto)과 같은
// 4:3 슬롯과 presigned URL 캐시를 쓴다. URL이 늦게 오면 이미 다른 장소로
// 넘어갔을 수 있어 그 장소가 아직 보이는 중일 때만 꽂는다.
function renderCoursePlacePhoto(place) {
  const slot = document.getElementById("course-card-photo");
  if (!slot) return;
  resolveStoryPhotoUrl(place.photoKey).then((url) => {
    if (!courseModeOpen || activeCourse.places[courseIndex] !== place) return;
    if (!url) {
      slot.remove();
      return;
    }
    const img = document.createElement("img");
    img.className = "recall-card-photo-img";
    img.alt = "";
    img.src = url;
    slot.replaceChildren(img);
  });
}

// 작성 폼(.overlay, z-index 100)이 이 화면(.recall-session, 110) 아래에
// 깔리므로 따라 걷기를 마치고 작성 폼을 연다. 이미 코스를 다 본 뒤라 끊길
// 흐름이 없다. 위치는 마지막 장소로 시작하고, 마법사 첫 단계에서 바꿀 수 있다.
function writeMemoryAfterCourse() {
  const place = activeCourse.places[activeCourse.places.length - 1];
  Storage.logEvent(`course_write:${activeCourse.slug}`);
  endCourseWalk();
  startFreePinComposer(place.lat, place.lng);
}

function endCourseWalk() {
  if (!courseModeOpen) return;
  stopCourseSongTicker();
  if (courseSongs.some((s) => s.videoId === activeMiniPlayerVideoId)) stopMiniPlayer();
  courseSongs = [];
  courseOverlays.forEach((o) => o.setMap(null));
  courseOverlays = [];
  if (coursePolyline) {
    coursePolyline.setMap(null);
    coursePolyline = null;
  }
  const card = document.getElementById("course-card");
  card.classList.remove("recall-card--visible");
  document.getElementById("course-session").classList.add("hidden");
  exitRecallImmersiveChrome();

  courseModeOpen = false;
  activeCourse = null;
  courseIndex = -1;
  renderMarkers();
}

function bindCourseEvents() {
  document.getElementById("course-exit-btn").onclick = endCourseWalk;
  bindOverlayClickToClose("course-choice-overlay", closeCourseChoice);
}
