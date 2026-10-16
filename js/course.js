// ============================================================
// 발자취(코스) 따라 걷기 (2026-10-13)
// ============================================================
// 운영자가 어드민 "발자취" 탭에서 만든 코스(amplify/data/resource.ts의
// Course/CoursePlace)를 지도 위에서 순서대로 걸어보는 모드. 첫 코스는 책
// 『콘크리트 사피엔스』 속 장소이고, 이후 인물 발자취/드라마 촬영지 등으로
// 늘어나도 이 화면 하나를 같이 쓴다.
//
// 진입은 상단 "발자취" 칩 하나(코스마다 칩을 만들면 칩 줄이 넘친다) —
// 코스가 하나뿐이어도 코스 목록부터 고른다(공유 링크 ?course=는 바로 진입).
// 화면 구성은 기억산책(js/recall.js)과 같은 리듬: 평소 UI를 옅게 지우고
// (enterRecallImmersiveChrome 재사용), 아래 카드로 한 곳씩 넘겨본다.
// 기억산책과 다른 점은 장소가 정해진 순서로 이어진다는 것 — 핀과 카드의
// "1 / N"으로 순서를 보여준다. 코스가 관광 안내가 아니라 기억을 모으는
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
// 이번 따라 걷기의 플레이리스트 — 노래가 있는 장소들을 코스 순서대로
// (같은 곡은 한 번만). 끝낼 때 미니 플레이어가 여전히 이 중 하나면 멈춘다
// (사용자가 중간에 다른 곡으로 바꿨으면 그대로 둔다).
let courseSongs = [];
// 장소 카드를 접고 지도만 보는 중인지(2026-10-14) — 카드가 화면 아래를
// 크게 덮어서 장소들이 어디쯤 있는지 둘러보고 싶을 때 쓴다.
let courseMapFolded = false;
// 이번 걷기에서 장소마다 보고 있던 사진 번호 — 앞뒤 장소를 오가다 돌아와도
// 같은 사진을 보여준다(js/course.js renderCoursePlacePhoto). 걷기를 새로 시작하면 비운다.
const coursePhotoIndexByPlace = new Map();

async function loadPublishedCourses() {
  try {
    publishedCourses = await Storage.fetchPublishedCourses();
  } catch (e) {
    console.error("발자취 불러오기 실패", e);
    publishedCourses = [];
  }
  renderHashtagChips();
  openCourseFromLink();
}

// 공유 링크(?course=<slug>)로 들어오면 그 코스의 소개 화면을 바로 연다(2026-10-13) —
// 책·SNS에 "책 속 장소를 지도로 걸어보기" 링크/QR을 걸기 위한 입구.
// js/app.js가 이 파라미터가 있으면 기본 랜딩(오늘 올라온 기억)과 첫 방문
// 환영 모달을 건너뛴다 — 환영 모달은 발자취를 나갈 때 띄운다(endCourseWalk).
function openCourseFromLink() {
  const slug = new URLSearchParams(window.location.search).get("course");
  if (!slug) return;
  const course = publishedCourses.find((c) => c.slug === slug);
  if (!course) {
    showToast("entry-toast", "이 발자취는 지금 볼 수 없어요", 3000);
    maybeShowPendingWelcomeOverlay();
    return;
  }
  Storage.logEvent(`course_link_opened:${course.slug}`);
  openCourseDetail(course);
}

function buildCourseUrl(slug) {
  return `${window.location.origin}${window.location.pathname}?course=${encodeURIComponent(slug)}`;
}

// 소개 카드의 "공유하기" — 폰에선 OS 공유 시트(카카오톡 등)를, 안 되는
// 환경(대부분의 PC)에선 링크 복사. 공유 토스트(.share-toast, z-index 60)는
// 이 화면(.recall-session, 110)에 가려서 버튼 글자로 결과를 알린다.
async function shareCourseLink(course, btn) {
  const url = buildCourseUrl(course.slug);
  Storage.logEvent(`course_shared:${course.slug}`);
  if (navigator.share) {
    try {
      await navigator.share({ title: `${course.title} 발자취`, url });
    } catch (e) {
      // 공유 시트를 닫은 경우 — 아무것도 안 한다
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = "링크가 복사됐어요";
  } catch (e) {
    btn.textContent = url;
  }
}

// 해시태그 줄 맨 앞의 "발자취" 칩(js/filters.js renderHashtagChips가 줄을
// 새로 그릴 때마다 부른다). 해시태그/연도/곡 필터가 걸려 있으면 그쪽에서
// 먼저 return해 칩이 안 생기고, 시간여행/내 기억 모드에선 해시태그 칩과
// 똑같이 남아 있다(누르면 startCourseWalk가 그 모드들을 닫는다).
//
// 칩은 코스 이름 대신 발자국 아이콘 + "발자취" 하나로 두고, 누르면 코스가
// 하나여도 목록부터 고른다(2026-10-13) — 잠깐 "<코스 이름> 따라 걷기"로
// 칩에 바로 코스 이름을 띄웠는데, 다른 작품/인물 코스가 늘어나면 칩 하나가
// 특정 작품을 대표하게 돼 어색하다는 피드백으로 되돌렸다. 아이콘은 추상
// 도형 말고 알아볼 수 있는 맨발 발자국 두 개로 그렸다.
const COURSE_CHIP_ICON = `
  <svg class="course-entry-icon" width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <g transform="rotate(-10 6.5 15)"><ellipse cx="6.5" cy="16.8" rx="3.3" ry="5" /><circle cx="3.9" cy="9.6" r="1.25" /><circle cx="6.5" cy="8.9" r="1.3" /><circle cx="9.1" cy="9.7" r="1.15" /></g>
    <g transform="rotate(10 17.5 8)"><ellipse cx="17.5" cy="10" rx="3.3" ry="5" /><circle cx="14.9" cy="2.9" r="1.15" /><circle cx="17.5" cy="2.1" r="1.3" /><circle cx="20.1" cy="2.8" r="1.25" /></g>
  </svg>`;

function buildCourseChip() {
  if (publishedCourses.length === 0) return null;
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "chip course-entry";
  chip.innerHTML = `${COURSE_CHIP_ICON}<span>발자취</span>`;
  chip.onclick = openCourseChoice;
  return chip;
}

// 코스 목록(2026-10-13 시안) — 큰 제목 + "N개의 발자취" 배지, 코스마다
// 표지·제목·부제·종류/장소 수·"둘러보기" 카드. 맨 앞 코스는 "지금
// 둘러보세요"로 강조한다. 공개 코스가 아직 하나뿐이라 다음 콘텐츠 예고
// (COURSES_COMING_SOON)를 "준비 중"으로 아래에 붙인다 — 실제 코스가
// 아니라 코드에 적어둔 안내라 작품 이름은 밝히지 않고(표지 "준비 중",
// 제목 "새로운 콘텐츠 준비 중") 어떤 종류가 올지만 소개 글로 귀띔한다.
// 실제 코스가 공개되면 여기서 하나씩 지운다.
const COURSES_COMING_SOON = [
  { description: "드라마와 영화 속 그 장면의 장소를 따라 걷는 길을 준비하고 있어요.", kind: "drama" },
  { description: "한 사람이 지나온 길을 따라 걷는 발자취를 준비하고 있어요.", kind: "person" },
];

const COURSE_LIST_BOOKS_ICON = `
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor">
    <rect x="3" y="4" width="4" height="16" rx="1" /><rect x="8.5" y="6" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="15" rx="1" transform="rotate(-12 16 12.5)" />
  </svg>`;

const COURSE_LIST_PIN_ICON = `
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="currentColor">
    <path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" />
  </svg>`;

function openCourseChoice() {
  const panel = document.getElementById("course-choice-panel");
  const kindName = (c) => COURSE_KIND_LABELS[c.kind] || "발자취";
  panel.innerHTML = `
    <div class="course-list-header">
      <h2 class="course-list-title">발자취</h2>
      <button class="composer-close-btn" id="course-choice-close" aria-label="닫기">✕</button>
    </div>
    <div class="course-list-subrow">
      <p class="course-list-subtitle">책과 장소를 따라 도시를 걸어보세요.</p>
      <span class="course-list-badge">${COURSE_LIST_BOOKS_ICON}${publishedCourses.length}개의 발자취</span>
    </div>
    <div class="course-choice-list">
      ${publishedCourses.map((c, i) => `
        <div class="course-choice-item${i === 0 ? " course-choice-item--featured" : ""}">
          <span class="course-choice-cover${courseCoverKindClass(c)}">
            ${c.coverKey ? `<span class="course-choice-cover-img" ${courseCoverSlotAttrs(c)}></span>` : `<span class="course-choice-cover-text">${escapeHtml(c.title)}</span>`}
          </span>
          <span class="course-choice-text">
            ${i === 0 ? `<span class="course-choice-tag">✦ 지금 둘러보세요</span>` : ""}
            <span class="course-choice-title">${escapeHtml(c.title)}</span>
            ${c.author ? `<span class="course-choice-author">${escapeHtml(courseAuthorLine(c))}</span>` : ""}
            ${c.description ? `<span class="course-choice-desc">${escapeHtml(c.description)}</span>` : ""}
            <span class="course-choice-meta">${COURSE_LIST_PIN_ICON}${escapeHtml(kindName(c))} · 장소 ${c.places.length}곳${courseProgressNote(c)}</span>
          </span>
          <button type="button" class="course-choice-btn" data-course-index="${i}">둘러보기 <span aria-hidden="true">›</span></button>
        </div>
      `).join("")}
      ${COURSES_COMING_SOON.map((c, i) => `
        <div class="course-choice-item course-choice-item--soon">
          <span class="course-choice-cover course-choice-cover--soon course-choice-cover--soon-${i % 2}">
            <span class="course-choice-cover-text">준비 중</span>
          </span>
          <span class="course-choice-text">
            <span class="course-choice-title">새로운 콘텐츠 준비 중</span>
            <span class="course-choice-desc">${escapeHtml(c.description)}</span>
            <span class="course-choice-meta">${COURSE_LIST_PIN_ICON}${escapeHtml(kindName(c))} · 준비 중</span>
          </span>
          <span class="course-choice-btn course-choice-btn--soon">준비 중</span>
        </div>
      `).join("")}
    </div>
    <p class="course-list-footnote">다른 콘텐츠도 찾고 있어요. 함께 걷고 싶은 책이나 드라마가 있다면 알려주세요.</p>
  `;
  document.getElementById("course-choice-close").onclick = closeCourseChoice;
  panel.querySelectorAll(".course-choice-btn[data-course-index]").forEach((btn) => {
    btn.onclick = () => {
      closeCourseChoice();
      openCourseDetail(publishedCourses[Number(btn.dataset.courseIndex)], { fromList: true });
    };
  });
  // 카드 어디를 눌러도 둘러보기와 같게(버튼만 누르기엔 폰에서 작다)
  panel.querySelectorAll(".course-choice-item:not(.course-choice-item--soon)").forEach((item) => {
    const btn = item.querySelector(".course-choice-btn");
    item.onclick = (e) => {
      if (e.target !== btn && !btn.contains(e.target)) btn.click();
    };
  });
  panel.querySelectorAll(".course-choice-cover-img").forEach(fillCoverSlot);
  panel.scrollTop = 0;
  document.getElementById("course-choice-overlay").classList.remove("hidden");
}

// 목록 카드 "장소 20곳" 뒤에 붙는 진행 표시 — 다 본 코스는 "다 둘러봄",
// 걷다 만 코스는 "5곳 둘러봄". 처음 보는 코스엔 아무것도 안 붙는다.
function courseProgressNote(c) {
  const { seenCount, finished } = Storage.getCourseProgress(c);
  if (finished) return " · 다 둘러봄";
  return seenCount > 0 ? ` · ${seenCount}곳 둘러봄` : "";
}

const COURSE_KIND_LABELS = { book: "책", person: "인물", drama: "드라마·영화", music: "음악", org: "단체" };

// 코스 목록 제목 아래 "OOO 지음" — 종류에 따라 붙는 말이 다르다(2026-10-16).
const COURSE_AUTHOR_SUFFIX = { music: "노래", drama: "연출" };
function courseAuthorLine(c) {
  return `${c.author} ${COURSE_AUTHOR_SUFFIX[c.kind] || "지음"}`;
}

// 표지 썸네일 공통 속성 — 책등은 책 코스에만 있으니 다른 종류는 비율을 0으로
// 둬서 이미지를 자르지 않고, 음악은 정사각형 칸(.course-cover--music)에 넣는다.
function courseCoverSlotAttrs(c) {
  const ratio = isBookCourseKind(c.kind) ? c.coverSpineRatio || 0 : 0;
  return `data-photo-key="${escapeHtml(c.coverKey)}" data-spine-ratio="${ratio}"`;
}
function courseCoverKindClass(c) {
  return c.kind === "music" ? " course-cover--music" : "";
}

// data-photo-key를 가진 표지 슬롯에 이미지를 채운다(못 받으면 슬롯 제거).
// 책등+앞표지 이미지(data-spine-ratio > 0)면 이미지를 그만큼 넓게 그리고
// 왼쪽으로 밀어 책등 부분을 슬롯 밖으로 빼낸다 — 작은 썸네일엔 앞표지만.
function fillCoverSlot(slot) {
  const r = Math.min(0.5, Math.max(0, Number(slot.dataset.spineRatio) || 0));
  resolveStoryPhotoUrl(slot.dataset.photoKey).then((url) => {
    if (!slot.isConnected) return;
    if (!url) {
      slot.remove();
      return;
    }
    const img = document.createElement("img");
    img.alt = "";
    img.src = url;
    if (r > 0) {
      img.style.width = `${100 / (1 - r)}%`;
      img.style.maxWidth = "none";
      img.style.marginLeft = `${(-100 * r) / (1 - r)}%`;
    }
    slot.replaceChildren(img);
  });
}

// ------------------------------------------------------------
// 코스 소개 화면(2026-10-13) — 목록에서 코스를 고르거나 공유 링크로
// 들어오면, 지도 위 작은 카드 대신 큰 화면으로 책/드라마 등 콘텐츠를 먼저
// 소개하고 맨 아래 "따라 걷기 시작"으로 들어간다. 지도 위 작은 소개
// 카드(showCourseStep(-1))는 책 소개를 담기엔 좁았다. 따라 걷기는 첫
// 장소부터 시작하고, 첫 장소에서 "이전"을 누르면 전체 경로 카드가 나온다.
// ------------------------------------------------------------
function openCourseDetail(course, { fromList = false } = {}) {
  const panel = document.getElementById("course-detail-panel");
  // 지난번에 걷다 만 코스면 보던 장소부터 이어 걷기(2026-10-16) — 바로
  // 그 장소로 보내면 왜 중간부터인지 헷갈려서 소개 화면에서 고르게 한다.
  const { resumeIndex } = Storage.getCourseProgress(course);
  // 시안(2026-10-13): 왼쪽 입체 책 표지, 오른쪽에 제목·부제(description)·
  // 소개 글(intro)·고정 문구, 아래 "따라 걷기 시작". 장소 목록은 뺐다
  // (걷기 시작하면 바로 보이니 여기선 콘텐츠 소개에 집중). 아래 주황
  // 문구는 코스마다 바꾸지 않는 고정 문구다.
  panel.innerHTML = `
    <div class="course-detail-scroll">
      <div class="course-detail-top">
        ${fromList ? `<button type="button" class="course-detail-back" id="course-detail-back" aria-label="목록으로">‹ 목록</button>` : "<span></span>"}
        <div class="course-detail-top-actions">
          ${course.linkUrl ? `<a class="course-card-link" href="${escapeHtml(course.linkUrl)}" target="_blank" rel="noopener">더 알아보기</a>` : ""}
          <button type="button" class="course-card-link course-card-share" id="course-detail-share">공유하기</button>
          <button type="button" class="composer-close-btn" id="course-detail-close" aria-label="닫기">✕</button>
        </div>
      </div>
      <div class="course-detail-body${course.coverKey ? "" : " course-detail-body--no-cover"}">
        ${course.coverKey ? `<div class="course-detail-book" id="course-detail-book"></div>` : ""}
        <div class="course-detail-text">
          <p class="course-detail-kicker">발자취 · 장소 ${course.places.length}곳</p>
          <h2 class="course-detail-title">${escapeHtml(course.title)}</h2>
          ${course.description ? `<p class="course-detail-subtitle">${escapeHtml(course.description)}</p>` : ""}
          ${course.intro ? `<p class="course-detail-intro">${escapeHtml(course.intro)}</p>` : ""}
          <p class="course-detail-tagline">콘텐츠 속 장소를 따라 걸으며, 지역의 서사를 직접 만나보세요.</p>
        </div>
      </div>
    </div>
    <div class="course-detail-footer">
      <button type="button" class="btn-primary course-detail-start" id="course-detail-start">
        ${resumeIndex === null ? "<span>따라 걷기 시작</span>" : `<span class="course-detail-resume-label">이어 걷기 · ${resumeIndex + 1}/${course.places.length} ${escapeHtml(course.places[resumeIndex].name)}</span>`}
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
      ${resumeIndex === null ? "" : `<button type="button" class="course-detail-restart" id="course-detail-restart">처음부터 걷기</button>`}
    </div>
  `;
  const book = document.getElementById("course-detail-book");
  if (book) {
    resolveStoryPhotoUrl(course.coverKey).then((url) => {
      if (!book.isConnected) return;
      if (!url) {
        book.remove();
        return;
      }
      renderCourseCover(book, url, course.kind, course.coverSpineRatio).then((ok) => {
        if (!ok && book.isConnected) book.remove();
      });
    });
  }
  document.getElementById("course-detail-close").onclick = () => {
    closeCourseDetail();
    // 공유 링크로 들어와 미뤄둔 첫 방문 환영 모달(js/app.js maybeShowWelcomeOverlay)
    maybeShowPendingWelcomeOverlay();
  };
  const back = document.getElementById("course-detail-back");
  if (back) back.onclick = () => {
    closeCourseDetail();
    openCourseChoice();
  };
  document.getElementById("course-detail-share").onclick = (e) => shareCourseLink(course, e.currentTarget);
  document.getElementById("course-detail-start").onclick = () => {
    // 처음부터 시작하면(처음 보거나 지난번에 다 본 코스) 둘러본 수도 새로 센다
    if (resumeIndex === null) Storage.resetCourseProgress(course.id);
    else Storage.logEvent(`course_resumed:${course.slug}`);
    closeCourseDetail();
    startCourseWalk(course, resumeIndex ?? 0);
  };
  const restart = document.getElementById("course-detail-restart");
  if (restart) restart.onclick = () => {
    Storage.resetCourseProgress(course.id);
    Storage.logEvent(`course_restarted:${course.slug}`);
    closeCourseDetail();
    startCourseWalk(course, 0);
  };
  panel.scrollTop = 0;
  document.getElementById("course-detail-overlay").classList.remove("hidden");
  Storage.logEvent(`course_detail_opened:${course.slug}`);
}

function closeCourseDetail() {
  document.getElementById("course-detail-overlay").classList.add("hidden");
}

// ------------------------------------------------------------
// 기억 아카이브 맨 위 "발자취" 한 줄(2026-10-13) — 아카이브를 여는 사람은
// 이미 둘러볼 거리를 찾는 중이라 칩보다 발자취를 발견하기 좋다. 기억
// 목록 사이에 코스 장소를 섞지는 않는다(아카이브는 사람들이 직접 남긴
// 기억만 모인 곳이라는 성격을 지키려고). 표지를 누르면 그 코스 소개 화면,
// "발자취 ›"를 누르면 코스 목록. 옆에는 앞으로 올 종류(영상 콘텐츠/인물/
// 도서)마다 "준비중" 표지를 한 권씩 세워 책장이 채워지는 느낌을 준다
// (눌리지 않음). 표지 색은 실제 코스 표지가 돋보이게 연한 파스텔로.
// 실제 코스가 공개될 때마다 해당 종류를 빼면 된다.
// ------------------------------------------------------------
const ARCHIVE_COMING_SOON = [
  { title: "영상 콘텐츠", hex: "#A9CDD9" },
  { title: "인물", hex: "#B1C3DF" },
  { title: "도서", hex: "#E5B1A1" },
];

function buildArchiveCourseRowHtml() {
  if (publishedCourses.length === 0) return "";
  return `
    <div class="archive-course-row">
      <button type="button" class="archive-course-label" id="archive-course-label">
        ${COURSE_CHIP_ICON}<span>발자취</span><span class="archive-course-label-hint">작품 속 장소 따라 걷기 ›</span>
      </button>
      <div class="archive-course-items">
        ${publishedCourses.map((c, i) => `
          <button type="button" class="archive-course-item" data-course-index="${i}" aria-label="${escapeHtml(c.title)}">
            ${c.coverKey ? `<span class="archive-course-cover${courseCoverKindClass(c)}" ${courseCoverSlotAttrs(c)}></span>` : ""}
            <span class="archive-course-title">${escapeHtml(c.title)}</span>
          </button>
        `).join("")}
        ${ARCHIVE_COMING_SOON.map((c) => `
          <span class="archive-course-item archive-course-item--soon">
            <span class="archive-course-cover" style="background:${c.hex}"><span class="archive-course-cover-text">준비중</span></span>
            <span class="archive-course-title">${c.title}</span>
          </span>
        `).join("")}
      </div>
    </div>`;
}

// onLeave: 아카이브 모달을 닫는 함수(js/app.js closeRecentMemoriesModal)
function bindArchiveCourseRow(panel, onLeave) {
  const label = panel.querySelector("#archive-course-label");
  if (!label) return;
  label.onclick = () => {
    onLeave();
    Storage.logEvent("course_archive_row_clicked");
    openCourseChoice();
  };
  panel.querySelectorAll(".archive-course-item[data-course-index]").forEach((btn) => {
    btn.onclick = () => {
      const course = publishedCourses[Number(btn.dataset.courseIndex)];
      onLeave();
      Storage.logEvent(`course_archive_opened:${course.slug}`);
      openCourseDetail(course, { fromList: true });
    };
  });
  // 준비중 표지는 사진이 없어 fillCoverSlot이 빈 칸으로 보고 지워버린다
  panel.querySelectorAll(".archive-course-cover[data-photo-key]").forEach(fillCoverSlot);
}

function closeCourseChoice() {
  document.getElementById("course-choice-overlay").classList.add("hidden");
}

function startCourseWalk(course, startIndex = 0) {
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
  coursePhotoIndexByPlace.clear();
  enterRecallImmersiveChrome();
  drawCoursePath();
  document.getElementById("course-session").classList.remove("hidden");
  Storage.logEvent(`course_started:${course.slug}`);
  courseSongs = buildCourseSongs(course);
  // 다른 기억 카드에서 틀어둔 노래는 여기서 끊는다(js/recall.js
  // openRecallSessionShell과 같은 이유). 소개 화면에서 "따라 걷기 시작"을
  // 누른 거라 첫 장소부터, "이어 걷기"면 지난번 보던 장소부터 보여준다.
  stopMiniPlayer();
  showCourseStep(startIndex, { deferMusic: true });
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

// 장소 핀만 그린다 — 처음엔 장소들을 옅은 붉은 점선으로 이었는데, 로고
// 말풍선 핀 사이를 가로지르는 선이 거슬린다는 피드백으로 뺐다(2026-10-13).
// 순서는 카드의 "1 / N"과 다음 버튼이 보여준다.
function drawCoursePath() {
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
// "1 / 3"이 보여주므로 핀은 "이 코스의 장소" 표시만 한다. URL을 못
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
    img.crossOrigin = "anonymous"; // 픽셀을 읽어 배경 있는 로고인지 본다(S3 CORS 허용)
    img.onload = () => fillPinLogoIfOpaque(slot, img);
    // 캐시 등으로 CORS 로드가 실패하면 예전처럼 흰 말풍선 안 로고로
    img.onerror = () => {
      img.onerror = null;
      img.onload = null;
      img.removeAttribute("crossorigin");
      img.src = url;
    };
    img.src = url;
    slot.replaceChildren(img);
  });
}

// 배경까지 채운 로고(픽셀 90% 이상 불투명 — 예: 종이 질감 위 <탁류>)는 흰
// 여백 없이 말풍선을 꽉 채우고, 꼬리도 로고 아래쪽 색으로 칠한다. 흰 여백
// 안에 로고만 가운데 떠 보인다는 피드백(2026-10-15). 투명 배경 로고는 그대로.
// 모서리만 보지 않는 건, 어드민 업로드(resizeLogoFile)가 왼쪽 위 색과 비슷한
// 종이 부분을 반투명하게 지워 모서리 알파가 낮게 남기 때문이다 — 그 반투명
// 자리는 말풍선 바탕을 같은 색으로 깔아 메운다.
function fillPinLogoIfOpaque(slot, img) {
  try {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const all = ctx.getImageData(0, 0, w, h).data;
    let opaque = 0;
    for (let i = 3; i < all.length; i += 4) if (all[i] > 200) opaque++;
    if (opaque < (all.length / 4) * 0.9) return;
    // 꼬리 색 = 아래 가장자리 가운데 띠의 평균 색
    const band = ctx.getImageData(Math.round(w * 0.4), h - 3, Math.max(1, Math.round(w * 0.2)), 3).data;
    let r = 0, g = 0, b = 0;
    const n = band.length / 4;
    for (let i = 0; i < band.length; i += 4) {
      r += band[i];
      g += band[i + 1];
      b += band[i + 2];
    }
    slot.style.setProperty("--pin-tail", `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`);
    slot.classList.add("course-pin-logo--fill");
  } catch {
    // 픽셀을 못 읽으면(캔버스 오염) 흰 말풍선 그대로
  }
}

function fitCourseBounds({ folded = false } = {}) {
  const bounds = new kakao.maps.LatLngBounds();
  activeCourse.places.forEach((p) => bounds.extend(new kakao.maps.LatLng(p.lat, p.lng)));
  if (activeCourse.places.length === 1) {
    map.setLevel(4);
    map.panTo(bounds.getCenter());
    return;
  }
  // 아래 카드가 지도 아래쪽을 덮으므로 아래 여백을 크게 준다. 카드를
  // 접었을 땐 아래엔 얇은 띠만 남는다.
  if (folded) map.setBounds(bounds, 110, 50, 150, 50);
  else map.setBounds(bounds, 120, 60, 320, 60);
}

// deferMusic: 따라 걷기를 막 시작한 순간에만 쓴다 — enterRecallImmersiveChrome이
// 미니 플레이어를 옮기면서 유튜브 iframe이 다시 로드되는데, 같은 틱에 재생을
// 걸면 명령이 묻혀 모바일에서 소리가 안 났다(2026-10-13). 기억 라디오
// (showRecallStory의 500ms 뒤 openRecallCard)와 같은 간격을 두고 튼다.
function showCourseStep(index, { deferMusic = false } = {}) {
  if (!courseModeOpen) return;
  // 접힌 상태에서 핀이나 띠를 누르면 그 장소 카드를 다시 펼친다. 카드
  // 높이로 지도 위치를 계산하므로 카드를 그리기 전에 편다.
  if (courseMapFolded) setCourseMapFolded(false);
  courseIndex = index;
  courseOverlays.forEach((o, i) => {
    o.getContent().classList.toggle("course-pin--active", i === index);
    o.setZIndex(i === index ? 30 : 20);
  });

  const total = activeCourse.places.length;
  // 미니 플레이어가 나타나면 아래 지도 위치 계산(topEdge)이 달라지므로
  // 카드/지도 이동보다 먼저 튼다.
  if (index >= 0 && index < total) {
    const place = activeCourse.places[index];
    Storage.markCoursePlaceSeen(activeCourse.id, place.id);
    if (deferMusic) {
      setTimeout(() => {
        if (courseModeOpen && courseIndex === index) startCourseMusicAt(place);
      }, 500);
    } else {
      startCourseMusicAt(place);
    }
  }
  if (index >= total) Storage.markCourseFinished(activeCourse.id);
  renderCourseCard();
  if (index < 0 || index >= total) {
    fitCourseBounds();
  } else {
    const place = activeCourse.places[index];
    map.setLevel(4);
    map.setCenter(new kakao.maps.LatLng(place.lat, place.lng));
    placeCoursePinBesideCard(index);
  }
  if (index === activeCourse.places.length - 1) Storage.logEvent(`course_completed:${activeCourse.slug}`);
}

// 지도 정중앙에 두면 카드에 가려지므로 장소가 보일 자리로 지도를 민다.
// 넓은 화면(PC)에선 카드가 미니 플레이어 바로 아래까지 길어지므로
// (css/style.css .card-frame) 카드 왼쪽이나 오른쪽 빈 지도의
// 가운데에 둔다(2026-10-14). 쪽은 이웃 장소(이전, 첫 장소면 다음)가 있는
// 쪽 — 지나온/갈 길이 카드 뒤로 숨지 않고 화면 바깥쪽으로 뻗게. 옆 공간이
// 말풍선보다 좁은 화면(모바일·좁은 창)은 예전처럼 카드 위로 남는 영역의
// 가운데에 둔다. 노래가 나오는 중이면 미니 플레이어 아래부터를 본다.
function placeCoursePinBesideCard(index) {
  const mapEl = document.getElementById("map");
  const mapWidth = mapEl.clientWidth;
  const mapHeight = mapEl.clientHeight;
  const cardRect = document.getElementById("course-card").getBoundingClientRect();
  const miniPlayer = document.getElementById("mini-player");
  const topEdge = miniPlayer.classList.contains("hidden") ? 0 : miniPlayer.getBoundingClientRect().bottom;

  const sideWidth = cardRect.left;
  if (window.matchMedia("(min-width: 768px)").matches && sideWidth >= 160) {
    const places = activeCourse.places;
    const place = places[index];
    const neighbor = places[index - 1] || places[index + 1];
    const left = neighbor ? neighbor.lng < place.lng : false;
    const targetX = left ? sideWidth / 2 : mapWidth - sideWidth / 2;
    const targetY = (topEdge + mapHeight) / 2;
    map.panBy(mapWidth / 2 - targetX, mapHeight / 2 - targetY);
    return;
  }
  const offset = Math.max(0, mapHeight / 2 - (topEdge + cardRect.top) / 2);
  if (offset > 0) map.panBy(0, offset);
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
    // 표지(책 표지 등)가 있으면 글 오른쪽에 세로로 세운다.
    body = `
      <div class="course-intro">
        <div class="course-intro-text">
          <p class="course-card-kicker">발자취 · 장소 ${total}곳</p>
          <h2 class="course-card-title">${escapeHtml(activeCourse.title)}</h2>
          ${activeCourse.description ? `<p class="story-content">${escapeHtml(activeCourse.description)}</p>` : ""}
        </div>
        ${activeCourse.coverKey ? `<div class="course-intro-cover${courseCoverKindClass(activeCourse)}" ${courseCoverSlotAttrs(activeCourse)}></div>` : ""}
      </div>
      <div class="course-card-links">
        ${activeCourse.linkUrl ? `<a class="course-card-link" href="${escapeHtml(activeCourse.linkUrl)}" target="_blank" rel="noopener">더 알아보기 ›</a>` : ""}
        <button type="button" class="course-card-link course-card-share" id="course-card-share">공유하기</button>
      </div>
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
      ${coursePhotoCarouselHtml(place)}
      <div class="course-card-kicker">
        ${courseKindIconSvg(activeCourse.kind)}
        <span>${escapeHtml(activeCourse.title)}</span>
        <span class="course-card-kicker-sep" aria-hidden="true">·</span>
        <span>${courseIndex + 1} / ${total}</span>
        <button type="button" class="course-wish-btn" id="course-wish-btn" aria-label="가보고 싶어요" aria-pressed="false">${COURSE_WISH_ICON}</button>
        <button type="button" class="course-map-btn" id="course-map-btn">${COURSE_MAP_ICON}<span>지도 보기</span></button>
      </div>
      ${place.label ? `<p class="course-card-label">${escapeHtml(smartQuotes(place.label))}</p>` : ""}
      <h2 class="course-card-title">${escapeHtml(place.name)}</h2>
      ${!place.photoKey && place.description ? `<p class="story-content">${escapeHtml(smartQuotes(place.description))}</p>` : ""}
      ${place.quote ? `<blockquote class="course-card-quote">${escapeHtml(smartQuotes(place.quote))}</blockquote>` : ""}
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
  if (isIntro) {
    document.getElementById("course-card-share").onclick = (e) => shareCourseLink(activeCourse, e.currentTarget);
    card.querySelectorAll(".course-intro-cover").forEach(fillCoverSlot);
  }
  if (!isIntro && !isOutro) {
    renderCoursePlacePhoto(activeCourse.places[courseIndex]);
    bindCourseSongCard(activeCourse.places[courseIndex]);
    document.getElementById("course-map-btn").onclick = () => setCourseMapFolded(true);
    bindCourseWishButton(activeCourse.places[courseIndex]);
  }
}

// "가보고 싶어요"(2026-10-16) — 북마크. 담기면 안을 채운다(.course-wish-btn--on).
const COURSE_WISH_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4.6-6.5 4.6v-16a1 1 0 0 1 1-1z" /></svg>`;

// 장소를 계정의 "가보고 싶은 곳"에 담는다(Storage.togglePlaceWish). "내 것"이라
// 로그인 계정 기준이고, 비로그인이면 로그인부터 — "떠올랐어요"(js/storySheet.js
// handleReactionTap)와 같은 흐름. 모아보기는 계정 메뉴(js/mymemory.js).
function bindCourseWishButton(place) {
  const btn = document.getElementById("course-wish-btn");
  const sync = () => {
    const on = Storage.hasWishedPlace(place.id);
    btn.classList.toggle("course-wish-btn--on", on);
    btn.setAttribute("aria-pressed", String(on));
  };
  const toggle = () => {
    const on = Storage.togglePlaceWish(place.id, activeCourse.id);
    sync();
    showToast("course-wish-toast", on ? "가보고 싶은 곳에 담았어요" : "가보고 싶은 곳에서 뺐어요", 1800);
    Storage.logEvent(`place_wish_${on ? "added" : "removed"}:${activeCourse.slug}`);
  };
  sync();
  btn.onclick = () => {
    if (Auth.isLoggedIn()) {
      toggle();
      return;
    }
    requireLogin(() => {
      if (!btn.isConnected) return;
      if (Storage.hasWishedPlace(place.id)) sync();
      else toggle();
    });
  };
}

// 계정 메뉴 "가보고 싶은 곳"(2026-10-16) — 담은 장소를 최근 순으로. 누르면
// 그 코스를 그 장소부터 따라 걷는다(소개 화면은 건너뛴다 — 이미 아는 코스).
// 비공개로 돌렸거나 지워진 코스/장소는 목록에서 뺀다. 기억 목록과 같은
// 오버레이(#mymemory-panel)를 쓴다.
function openPlaceWishList() {
  closeAccountMenu();
  const panel = document.getElementById("mymemory-panel");
  const items = Storage.getMyPlaceWishes()
    .map((w) => {
      const course = publishedCourses.find((c) => c.id === w.courseId);
      const index = course ? course.places.findIndex((p) => p.id === w.placeId) : -1;
      return index < 0 ? null : { course, index, place: course.places[index] };
    })
    .filter(Boolean);
  panel.innerHTML = `
    <div class="recent-header">
      <h2 class="composer-title" style="margin:0;">가보고 싶은 곳</h2>
      <button class="recent-close" id="mymemory-close">✕</button>
    </div>
    ${items.length ? items.map(({ course, index, place }) => `
      <div class="recent-item place-wish-item" data-place-id="${escapeHtml(place.id)}">
        ${place.photoKey ? `<span class="place-wish-thumb" data-photo-key="${escapeHtml(place.photoKey)}" data-focus="${place.photoFocusX ?? 50}% ${place.photoFocusY ?? 50}%"></span>` : ""}
        <span class="place-wish-text">
          <span class="place-wish-name">${escapeHtml(place.name)}</span>
          <span class="place-wish-meta">${escapeHtml(course.title)} · ${index + 1}번째 장소</span>
        </span>
        <button type="button" class="place-wish-remove" aria-label="가보고 싶은 곳에서 빼기">${COURSE_WISH_ICON}</button>
      </div>
    `).join("") : `<p class="recent-empty">아직 담은 장소가 없어요.<br />발자취를 따라 걷다가 북마크를 눌러 담아보세요.</p>`}
  `;
  panel.querySelector("#mymemory-close").onclick = closeMyMemoryList;
  panel.querySelectorAll(".place-wish-item").forEach((el, i) => {
    const { course, index, place } = items[i];
    el.onclick = () => {
      closeMyMemoryList();
      Storage.logEvent(`place_wish_opened:${course.slug}`);
      startCourseWalk(course, index);
    };
    el.querySelector(".place-wish-remove").onclick = (e) => {
      e.stopPropagation();
      Storage.togglePlaceWish(place.id, course.id);
      el.remove();
      if (!panel.querySelector(".place-wish-item")) openPlaceWishList();
    };
  });
  panel.querySelectorAll(".place-wish-thumb").forEach((slot) => {
    resolveStoryPhotoUrl(slot.dataset.photoKey).then((url) => {
      if (!slot.isConnected) return;
      if (!url) {
        slot.remove();
        return;
      }
      slot.innerHTML = `<img src="${url}" alt="" style="object-position:${slot.dataset.focus}" />`;
    });
  });
  document.getElementById("mymemory-overlay").classList.remove("hidden");
  panel.scrollTop = 0;
}

const COURSE_MAP_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4zM9 4v14M15 6v14" /></svg>`;

// 장소 카드 접기/펴기(2026-10-14) — 따로 지도 페이지를 두지 않고 같은
// 화면에서 카드만 접는다. 페이지를 옮기면 플레이리스트가 끊기고 핀/지도를
// 두 군데서 그려야 해서. 접으면 코스 전체가 보이게 지도를 맞추고 아래엔
// "3 / 7 · 장소 이름" 띠만 남긴다. 지도는 그대로 끌고 확대할 수 있다.
// 기억 점은 걷는 중과 똑같이 숨겨 둔다(핀과 섞이면 지저분해서).
function setCourseMapFolded(folded) {
  courseMapFolded = folded;
  document.getElementById("course-session").classList.toggle("course-session--folded", folded);
  if (!folded) return;
  const total = activeCourse.places.length;
  const place = activeCourse.places[courseIndex];
  document.getElementById("course-fold-bar").innerHTML = `
    <span class="course-fold-bar-seq">${courseIndex + 1} / ${total}</span>
    <span class="course-fold-bar-name">${escapeHtml(place.name)}</span>
    <span class="course-fold-bar-open">카드 보기
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m6 15 6-6 6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </span>`;
  fitCourseBounds({ folded: true });
  Storage.logEvent(`course_map_folded:${activeCourse.slug}`);
}

// 장소 카드 "콘크리트 사피엔스 · 1 / 5" 앞 아이콘 — 코스 종류(Course.kind)를
// 따라 자동으로 고른다(책이면 펼친 책, 드라마·영화면 클래퍼보드, 인물이면
// 사람, 음악이면 음표, 그 외엔 칩과 같은 발자국). 글자색을 따라가는 선 아이콘.
function courseKindIconSvg(kind) {
  const paths = {
    book: '<path d="M12 6.5C10.3 5.2 7.9 4.6 4 4.8v13.4c3.9-.2 6.3.4 8 1.7 1.7-1.3 4.1-1.9 8-1.7V4.8c-3.9-.2-6.3.4-8 1.7zM12 6.5v13.4" />',
    drama: '<path d="M4 9.5h16V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9.5zM4 9.5 3.3 6.6a1 1 0 0 1 .7-1.2l13.6-3.3a1 1 0 0 1 1.2.7l.6 2.6L4 9.5zM8.2 4.4l2.4 3.4M13.2 3.2l2.4 3.4" />',
    person: '<circle cx="12" cy="8" r="3.6" /><path d="M5 20c.8-3.9 3.6-6 7-6s6.2 2.1 7 6" />',
    music: '<path d="M9 17.5V5.5l10-2v12" /><circle cx="6.5" cy="17.5" r="2.5" /><circle cx="16.5" cy="15.5" r="2.5" />',
  };
  if (!paths[kind]) return COURSE_CHIP_ICON.replace('class="course-entry-icon"', 'class="course-card-kicker-icon"');
  return `<svg class="course-card-kicker-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind]}</svg>`;
}

// 어드민에서 곧은 따옴표('아파트')로 적어도 카드에선 둥근 따옴표(‘아파트’)로
// 보이게 — 본문이 명조/고딕 어느 쪽이든 곧은 따옴표는 글줄에서 튄다.
function smartQuotes(text) {
  return String(text)
    .replace(/'([^'\n]*)'/g, "\u2018$1\u2019")
    .replace(/"([^"\n]*)"/g, "\u201C$1\u201D");
}

// 장소 사진(최대 3장, 2026-10-16) — 옆으로 넘겨 본다. 넘기기는 가로
// 스크롤 + scroll-snap이라 폰에선 손가락으로 밀고, 마우스로는 양옆 화살표나
// 아래 점을 누른다. 점은 사진 위에 얹어 카드 높이를 바꾸지 않는다.
// 사진 제목/출처는 사진마다 다르고 없을 수도 있어서, 넘길 때 아래 "지도
// 보기" 줄이 들썩이지 않게 두 줄 높이를 항상 비워둔다(.course-card-photo-meta).
function coursePhotoCarouselHtml(place) {
  const photos = Storage.getCoursePlacePhotos(place);
  if (!photos.length) return "";
  const many = photos.length > 1;
  return `
    <div class="recall-card-photo course-photo-carousel" id="course-card-photo">
      <div class="course-photo-track" id="course-photo-track">
        ${photos.map(() => `<div class="course-photo-slide"></div>`).join("")}
      </div>
      ${many ? `
        <button type="button" class="course-photo-arrow course-photo-arrow--prev" data-photo-step="-1" aria-label="이전 사진">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m14.5 6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <button type="button" class="course-photo-arrow course-photo-arrow--next" data-photo-step="1" aria-label="다음 사진">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <div class="course-photo-dots">
          ${photos.map((_, i) => `<button type="button" class="course-photo-dot" data-photo-index="${i}" aria-label="사진 ${i + 1}"></button>`).join("")}
        </div>
      ` : ""}
    </div>
    <div class="course-card-photo-meta" id="course-card-photo-meta"></div>
  `;
}

function coursePhotoMetaHtml(photo) {
  return `
    ${photo.title ? `<p class="course-card-photo-caption">${escapeHtml(smartQuotes(photo.title))}</p>` : ""}
    ${photo.credit ? `<p class="course-card-photo-credit">출처<span class="course-card-photo-credit-bar" aria-hidden="true"></span>${escapeHtml(photo.credit)}</p>` : ""}
  `;
}

// 사진 URL은 기억산책 카드 사진(js/recall.js renderRecallCardPhoto)과 같은
// presigned URL 캐시를 쓴다. URL이 늦게 오면 이미 다른 장소로 넘어갔을 수
// 있어 그 장소가 아직 보이는 중일 때만 꽂는다.
// 처음 보이는 사진은 지난번에 이 장소에서 마지막으로 본 사진의 다음 장
// (Storage.getCoursePhotoStartIndex). 같은 걷기 안에서 앞뒤 장소를 오가다
// 돌아오면 보던 사진 그대로 둔다(coursePhotoIndexByPlace).
function renderCoursePlacePhoto(place) {
  const slot = document.getElementById("course-card-photo");
  if (!slot) return;
  const photos = Storage.getCoursePlacePhotos(place);
  const track = document.getElementById("course-photo-track");
  const meta = document.getElementById("course-card-photo-meta");
  const slides = [...track.children];
  const dots = [...slot.querySelectorAll(".course-photo-dot")];
  let current = -1;

  const show = (index) => {
    if (index === current) return;
    current = index;
    meta.innerHTML = coursePhotoMetaHtml(photos[index]);
    dots.forEach((dot, i) => dot.classList.toggle("course-photo-dot--active", i === index));
    coursePhotoIndexByPlace.set(place.id, index);
    Storage.markCoursePhotoSeen(place.id, index);
  };
  const goTo = (index, smooth) => {
    const target = (index + photos.length) % photos.length;
    track.scrollTo({ left: target * track.clientWidth, behavior: smooth ? "smooth" : "auto" });
    show(target);
  };

  const start = coursePhotoIndexByPlace.has(place.id)
    ? coursePhotoIndexByPlace.get(place.id) % photos.length
    : Storage.getCoursePhotoStartIndex(place.id, photos.length);
  show(start);
  // 카드가 막 그려진 직후라 폭이 0일 수 있어 한 프레임 뒤에 맞춘다.
  requestAnimationFrame(() => {
    track.scrollLeft = start * track.clientWidth;
  });
  track.addEventListener("scroll", () => {
    if (!track.clientWidth) return;
    show(Math.min(photos.length - 1, Math.max(0, Math.round(track.scrollLeft / track.clientWidth))));
  }, { passive: true });
  slot.querySelectorAll("[data-photo-step]").forEach((btn) => {
    btn.onclick = () => goTo(current + Number(btn.dataset.photoStep), true);
  });
  dots.forEach((dot, i) => {
    dot.onclick = () => goTo(i, true);
  });

  let failed = 0;
  photos.forEach((photo, i) => {
    resolveStoryPhotoUrl(photo.key).then((url) => {
      if (!courseModeOpen || activeCourse.places[courseIndex] !== place) return;
      if (!url) {
        // 사진이 하나도 안 열리면 회색 빈칸 대신 사진 자리를 통째로 뺀다.
        if (++failed === photos.length) {
          slot.remove();
          meta.remove();
        }
        return;
      }
      const img = document.createElement("img");
      img.className = "recall-card-photo-img";
      img.alt = "";
      img.src = url;
      // 어드민에서 끌어서 정한 보일 부분
      img.style.objectPosition = `${photo.focusX}% ${photo.focusY}%`;
      slides[i].replaceChildren(img);
    });
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
  if (courseMapFolded) setCourseMapFolded(false);
  stopCourseSongTicker();
  if (courseSongs.some((s) => s.videoId === activeMiniPlayerVideoId)) stopMiniPlayer();
  courseSongs = [];
  courseOverlays.forEach((o) => o.setMap(null));
  courseOverlays = [];
  const card = document.getElementById("course-card");
  card.classList.remove("recall-card--visible");
  document.getElementById("course-session").classList.add("hidden");
  exitRecallImmersiveChrome();

  courseModeOpen = false;
  activeCourse = null;
  courseIndex = -1;
  renderMarkers();
  // 공유 링크로 들어와 미뤄둔 첫 방문 환영 모달(js/app.js maybeShowWelcomeOverlay)
  maybeShowPendingWelcomeOverlay();
}

function bindCourseEvents() {
  document.getElementById("course-exit-btn").onclick = endCourseWalk;
  document.getElementById("course-fold-bar").onclick = () => showCourseStep(courseIndex);
  bindOverlayClickToClose("course-choice-overlay", closeCourseChoice);
  bindOverlayClickToClose("course-detail-overlay", () => {
    closeCourseDetail();
    maybeShowPendingWelcomeOverlay();
  });
}
