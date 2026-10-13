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

// 코스 제목 옆 작은 안내(예: 출간 예정일) — 어드민에서 입력하는 칸은 아직
// 고민 중이라(2026-10-13) 우선 코스 제목 기준으로 여기에 적어둔다. 어드민
// 칸을 만들면 Course 필드로 옮기고 이 표는 지운다.
const COURSE_RELEASE_NOTES = {
  "콘크리트 사피엔스": "2026년 11월 출간 예정",
};

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
          <span class="course-choice-cover">
            ${c.coverKey ? `<span class="course-choice-cover-img" data-photo-key="${escapeHtml(c.coverKey)}" data-spine-ratio="${c.coverSpineRatio || 0}"></span>` : `<span class="course-choice-cover-text">${escapeHtml(c.title)}</span>`}
          </span>
          <span class="course-choice-text">
            ${i === 0 ? `<span class="course-choice-tag">✦ 지금 둘러보세요</span>` : ""}
            <span class="course-choice-title-row">
              <span class="course-choice-title">${escapeHtml(c.title)}</span>
              ${COURSE_RELEASE_NOTES[c.title] ? `<span class="course-choice-release">${escapeHtml(COURSE_RELEASE_NOTES[c.title])}</span>` : ""}
            </span>
            ${c.description ? `<span class="course-choice-desc">${escapeHtml(c.description)}</span>` : ""}
            <span class="course-choice-meta">${COURSE_LIST_PIN_ICON}${escapeHtml(kindName(c))} · 장소 ${c.places.length}곳</span>
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

const COURSE_KIND_LABELS = { book: "책", person: "인물", drama: "드라마·영화", org: "단체" };

// "책 · " 처럼 뒤에 붙일 구분자까지 — 종류가 없거나 "기타"면 빈 문자열.
function courseKindLabel(course) {
  const label = COURSE_KIND_LABELS[course.kind];
  return label ? `${label} · ` : "";
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
        <span>따라 걷기 시작</span>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
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
      renderBook3d(book, url, course.coverSpineRatio).then((ok) => {
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
    closeCourseDetail();
    startCourseWalk(course);
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
// "발자취 ›"를 누르면 코스 목록. 옆에는 "준비 중" 표지 4권을 세워 책장이
// 채워지는 느낌을 준다(눌리지 않음) — 표지 색은 팬톤 올해의 색 중 파스텔
// 톤 4가지. 실제 코스가 공개될 때마다 하나씩 빼면 된다.
// ------------------------------------------------------------
const ARCHIVE_COMING_SOON_COLORS = [
  { code: "13-1023", name: "Peach Fuzz", hex: "#FFBE98" }, // 2024 올해의 색
  { code: "15-3919", name: "Serenity", hex: "#92A8D1" }, // 2016
  { code: "13-1520", name: "Rose Quartz", hex: "#F7CAC9" }, // 2016
  { code: "13-0647", name: "Illuminating", hex: "#F5DF4D" }, // 2021
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
            ${c.coverKey ? `<span class="archive-course-cover" data-photo-key="${escapeHtml(c.coverKey)}" data-spine-ratio="${c.coverSpineRatio || 0}"></span>` : ""}
            <span class="archive-course-title">${escapeHtml(c.title)}</span>
          </button>
        `).join("")}
        ${ARCHIVE_COMING_SOON_COLORS.map((c) => `
          <span class="archive-course-item archive-course-item--soon">
            <span class="archive-course-cover" style="background:${c.hex}" title="PANTONE ${c.code} ${c.name}"><span class="archive-course-cover-text">준비 중</span></span>
            <span class="archive-course-title">준비 중</span>
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
  panel.querySelectorAll(".archive-course-item").forEach((btn) => {
    btn.onclick = () => {
      const course = publishedCourses[Number(btn.dataset.courseIndex)];
      onLeave();
      Storage.logEvent(`course_archive_opened:${course.slug}`);
      openCourseDetail(course, { fromList: true });
    };
  });
  panel.querySelectorAll(".archive-course-cover").forEach(fillCoverSlot);
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
  // 다른 기억 카드에서 틀어둔 노래는 여기서 끊는다(js/recall.js
  // openRecallSessionShell과 같은 이유). 소개 화면에서 "따라 걷기 시작"을
  // 누른 거라 첫 장소부터 보여준다.
  stopMiniPlayer();
  showCourseStep(0, { deferMusic: true });
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

// deferMusic: 따라 걷기를 막 시작한 순간에만 쓴다 — enterRecallImmersiveChrome이
// 미니 플레이어를 옮기면서 유튜브 iframe이 다시 로드되는데, 같은 틱에 재생을
// 걸면 명령이 묻혀 모바일에서 소리가 안 났다(2026-10-13). 기억 라디오
// (showRecallStory의 500ms 뒤 openRecallCard)와 같은 간격을 두고 튼다.
function showCourseStep(index, { deferMusic = false } = {}) {
  if (!courseModeOpen) return;
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
    if (deferMusic) {
      setTimeout(() => {
        if (courseModeOpen && courseIndex === index) startCourseMusicAt(place);
      }, 500);
    } else {
      startCourseMusicAt(place);
    }
  }
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
    // 표지(책 표지 등)가 있으면 글 오른쪽에 세로로 세운다.
    body = `
      <div class="course-intro">
        <div class="course-intro-text">
          <p class="course-card-kicker">발자취 · 장소 ${total}곳</p>
          <h2 class="course-card-title">${escapeHtml(activeCourse.title)}</h2>
          ${activeCourse.description ? `<p class="story-content">${escapeHtml(activeCourse.description)}</p>` : ""}
        </div>
        ${activeCourse.coverKey ? `<div class="course-intro-cover" data-photo-key="${escapeHtml(activeCourse.coverKey)}" data-spine-ratio="${activeCourse.coverSpineRatio || 0}"></div>` : ""}
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
      ${place.photoKey ? `<div class="recall-card-photo" id="course-card-photo"></div>` : ""}
      ${place.photoKey && place.description ? `<p class="course-card-photo-caption">${escapeHtml(smartQuotes(place.description))}</p>` : ""}
      <p class="course-card-kicker">
        ${courseKindIconSvg(activeCourse.kind)}
        <span>${escapeHtml(activeCourse.title)}</span>
        <span class="course-card-kicker-sep" aria-hidden="true">·</span>
        <span>${courseIndex + 1} / ${total}</span>
      </p>
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
  }
}

// 장소 카드 "콘크리트 사피엔스 · 1 / 5" 앞 아이콘 — 코스 종류(Course.kind)를
// 따라 자동으로 고른다(책이면 펼친 책, 드라마·영화면 클래퍼보드, 인물이면
// 사람, 그 외엔 칩과 같은 발자국). 글자색을 따라가는 선 아이콘.
function courseKindIconSvg(kind) {
  const paths = {
    book: '<path d="M12 6.5C10.3 5.2 7.9 4.6 4 4.8v13.4c3.9-.2 6.3.4 8 1.7 1.7-1.3 4.1-1.9 8-1.7V4.8c-3.9-.2-6.3.4-8 1.7zM12 6.5v13.4" />',
    drama: '<path d="M4 9.5h16V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9.5zM4 9.5 3.3 6.6a1 1 0 0 1 .7-1.2l13.6-3.3a1 1 0 0 1 1.2.7l.6 2.6L4 9.5zM8.2 4.4l2.4 3.4M13.2 3.2l2.4 3.4" />',
    person: '<circle cx="12" cy="8" r="3.6" /><path d="M5 20c.8-3.9 3.6-6 7-6s6.2 2.1 7 6" />',
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
    // 어드민에서 끌어서 정한 보일 부분(CoursePlace.photoFocusX/Y)
    img.style.objectPosition = `${place.photoFocusX ?? 50}% ${place.photoFocusY ?? 50}%`;
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
  bindOverlayClickToClose("course-choice-overlay", closeCourseChoice);
  bindOverlayClickToClose("course-detail-overlay", () => {
    closeCourseDetail();
    maybeShowPendingWelcomeOverlay();
  });
}
