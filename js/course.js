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
// 옅은 점선으로 길을 보여준다. 장소마다 "근처에 남겨진 기억 N개"와
// "여기에 내 기억 남기기"를 붙여, 코스가 관광 안내가 아니라 기억을 모으는
// 장치가 되게 한다.

const COURSE_NEARBY_RADIUS_METERS = 300; // "근처의 기억"과 같은 기준

let publishedCourses = [];
let courseModeOpen = false;
let activeCourse = null;
// -1은 코스 소개 카드(전체 경로를 한눈에), 0부터는 장소 순서
let courseIndex = -1;
let courseOverlays = []; // kakao.maps.CustomOverlay — 번호 핀
let coursePolyline = null;
// 이번 따라 걷기에서 튼 곡들(코스 배경음악 + 장소 노래)의 videoId — 끝낼 때
// 미니 플레이어가 여전히 이 중 하나면 멈춘다(사용자가 중간에 다른 곡으로
// 바꿨으면 그대로 둔다).
let courseVideoIds = new Set();

async function loadPublishedCourses() {
  try {
    publishedCourses = await Storage.fetchPublishedCourses();
  } catch (e) {
    console.error("발자취 불러오기 실패", e);
    publishedCourses = [];
  }
  renderCourseEntry();
}

// 상단 "발자취" 칩 — 다른 필터가 걸려 있을 땐 "기억 아카이브"와 같이
// 숨긴다(js/app.js renderMemoryArchiveEntry가 매번 같이 부른다).
function renderCourseEntry() {
  const el = document.getElementById("course-entry");
  if (!el) return;
  const filtered = activeHashtagFilter || activeYearFilter !== null || activeSongFilter || sliderActive || myMemoryModeActive;
  el.classList.toggle("hidden", publishedCourses.length === 0 || !!filtered);
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
  playCourseSong();
  showCourseStep(-1);
}

// 음악은 섞는 방식이다 — 코스 배경음악이 처음부터 깔리고, 노래를 따로 넣은
// 장소에 오면 그 곡으로 바뀐다. 노래가 없는 장소에선 흐르던 곡이 끊기지
// 않고 이어진다(장소마다 무조건 바꾸면 넘길 때마다 끊겨 산만하다). 둘 다
// 칩/핀/다음 버튼을 누른 탭 이벤트 안에서 바로 틀어야 모바일 자동재생
// 제한에 안 걸린다(playMiniPlayerVideo 주석 참고).
function playCourseSong() {
  playCourseVideo(activeCourse);
}

function playPlaceSong(place) {
  playCourseVideo(place);
}

// item: Course 또는 CoursePlace — 둘 다 youtubeUrl/musicTitle/musicArtist를 가진다.
function playCourseVideo(item) {
  const videoId = Storage.extractYoutubeVideoId(item.youtubeUrl);
  if (!videoId || videoId === activeMiniPlayerVideoId) return;
  courseVideoIds.add(videoId);
  playMiniPlayerVideo(videoId, { title: item.musicTitle, artist: item.musicArtist });
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
    el.className = "course-pin";
    el.innerHTML = `
      <svg class="course-pin-shape" viewBox="0 0 30 38" aria-hidden="true">
        <path d="M15 1C7.3 1 1 7.1 1 14.7 1 24.4 15 37 15 37s14-12.6 14-22.3C29 7.1 22.7 1 15 1z" />
      </svg>
      <span class="course-pin-num">${i + 1}</span>`;
    el.setAttribute("aria-label", `${i + 1}번째 장소 ${p.name}`);
    el.onclick = () => showCourseStep(i);
    return new kakao.maps.CustomOverlay({
      map,
      position: new kakao.maps.LatLng(p.lat, p.lng),
      content: el,
      yAnchor: 1, // 물방울 끝이 장소를 가리키게
      zIndex: 20,
    });
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

  // 미니 플레이어가 나타나면 아래 지도 위치 계산(topEdge)이 달라지므로
  // 카드/지도 이동보다 먼저 튼다.
  if (index >= 0) playPlaceSong(activeCourse.places[index]);
  renderCourseCard();
  if (index < 0) {
    fitCourseBounds();
  } else {
    const place = activeCourse.places[index];
    map.setLevel(4);
    map.setCenter(new kakao.maps.LatLng(place.lat, place.lng));
    // 지도 정중앙에 두면 아래 카드에 가려지므로(특히 모바일), 카드 위로
    // 남는 영역의 가운데에 장소가 오도록 지도 중심을 그만큼 아래로 민다.
    // 코스 배경음악이 나오면 위쪽 미니 플레이어 아래부터를 남는 영역으로 본다.
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
  const card = document.getElementById("course-card");
  const total = activeCourse.places.length;
  const isIntro = courseIndex < 0;
  const isLast = courseIndex === total - 1;

  let body;
  if (isIntro) {
    body = `
      <p class="course-card-kicker">발자취 · 장소 ${total}곳</p>
      <h2 class="course-card-title">${escapeHtml(activeCourse.title)}</h2>
      ${activeCourse.description ? `<p class="story-content">${escapeHtml(activeCourse.description)}</p>` : ""}
      ${activeCourse.linkUrl ? `<a class="course-card-link" href="${escapeHtml(activeCourse.linkUrl)}" target="_blank" rel="noopener">더 알아보기 ›</a>` : ""}
    `;
  } else {
    const place = activeCourse.places[courseIndex];
    const nearbyCount = Storage.getStoriesNear(place.lat, place.lng, COURSE_NEARBY_RADIUS_METERS).length;
    body = `
      ${place.photoKey ? `<div class="recall-card-photo" id="course-card-photo"></div>` : ""}
      <p class="course-card-kicker">${escapeHtml(activeCourse.title)} · ${courseIndex + 1} / ${total}</p>
      ${place.label ? `<p class="course-card-label">${escapeHtml(place.label)}</p>` : ""}
      <h2 class="course-card-title">${escapeHtml(place.name)}</h2>
      ${place.description ? `<p class="story-content">${escapeHtml(place.description)}</p>` : ""}
      ${place.quote ? `<blockquote class="course-card-quote">${escapeHtml(place.quote)}</blockquote>` : ""}
      <div class="course-card-nearby">
        <span>${nearbyCount > 0 ? `이 근처에 남겨진 기억 <b>${nearbyCount}개</b>` : "아직 이 근처에 남겨진 기억이 없어요"}</span>
        <button type="button" class="course-card-write" id="course-card-write">여기에 내 기억 남기기</button>
      </div>
    `;
  }

  const nextLabel = isIntro ? "따라 걷기 시작" : isLast ? "처음으로" : "다음 장소로";
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
  document.getElementById("course-card-next-btn").onclick = () => showCourseStep(isLast ? -1 : courseIndex + 1);
  const writeBtn = document.getElementById("course-card-write");
  if (writeBtn) writeBtn.onclick = writeMemoryAtCoursePlace;
  if (!isIntro) renderCoursePlacePhoto(activeCourse.places[courseIndex]);
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
// 깔리므로 따라 걷기를 마치고 그 자리에서 작성 폼을 연다.
function writeMemoryAtCoursePlace() {
  const place = activeCourse.places[courseIndex];
  Storage.logEvent(`course_write:${activeCourse.slug}`);
  endCourseWalk();
  startFreePinComposer(place.lat, place.lng);
}

function endCourseWalk() {
  if (!courseModeOpen) return;
  if (courseVideoIds.has(activeMiniPlayerVideoId)) stopMiniPlayer();
  courseVideoIds = new Set();
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
  document.getElementById("course-entry").onclick = handleCourseEntryClick;
  document.getElementById("course-exit-btn").onclick = endCourseWalk;
  bindOverlayClickToClose("course-choice-overlay", closeCourseChoice);
}
