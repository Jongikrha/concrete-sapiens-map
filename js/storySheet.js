// ============================================================
// Bottom Sheet — 이야기 열람 + 기억 전달하기(공유 카드)
// ============================================================

let sheetOpen = false;
let spotTimelineOpen = {};
let spotTimelineFocusYear = {};
let currentSort = "latest";
let hashtagSheetTag = null;
let hashtagSheetSort = "latest";
// 목록(최근 기억/내 기억)에서 항목을 눌러 들어온 경우, 뒤로가기(←)로 그
// 목록으로 복귀하기 위해 어디서 왔는지를 기억해둔다. 마커를 직접 눌러
// 들어온 경우엔 null이라 뒤로가기 버튼 자체가 숨겨진다.
let sheetReturnTo = null;
// 목록에서 클릭한 그 기억을 카드 안에서 스크롤+하이라이트로 짚어주기
// 위한 1회성 상태 — 렌더 후 바로 소비하고 비운다.
let sheetHighlightStoryId = null;

function openSheet(group, options = {}) {
  currentSort = "latest";
  spotTimelineOpen[group.key] = false;
  spotTimelineFocusYear[group.key] = null;
  sheetReturnTo = options.returnTo || null;
  sheetHighlightStoryId = options.highlightStoryId || null;
  // scrollIntoView를 걸려면 시트가 먼저 화면에 붙어(display 전환) 레이아웃을
  // 가진 상태여야 한다 — renderSheetContent(내부에서 스크롤 처리)보다
  // hidden 해제가 먼저 와야 한다.
  document.getElementById("sheet-backdrop").classList.remove("hidden");
  document.getElementById("bottom-sheet").classList.remove("hidden");
  // 이전에 열었던 시트의 스크롤 위치가 같은 #sheet-content 요소에 남아있을
  // 수 있어 매번 맨 위로 되돌린다 — highlightStoryId가 있으면 아래
  // renderSheetContent에서 다시 그 기억으로 스크롤하며 덮어쓴다.
  document.getElementById("sheet-content").scrollTop = 0;
  renderSheetContent(group);
  sheetOpen = true;
  group.stories.forEach((s) => Storage.incrementViewCount(s.id));
}

function closeSheet() {
  document.getElementById("sheet-backdrop").classList.add("hidden");
  document.getElementById("bottom-sheet").classList.add("hidden");
  sheetOpen = false;
}

/**
 * X 버튼 / 배경 클릭 / ESC / 스와이프처럼 "사용자가 직접 카드를 닫는"
 * 경우에 쓴다. 해시태그나 연도 탐색으로 들어왔던 거라면, 카드를 덮고
 * 나면 다시 전체 지도(필터 없는 상태)로 돌아가는 게 자연스럽기 때문에
 * 필터도 함께 해제한다. (반면 다른 기억으로 바로 이동하는 내부 흐름
 * 에서는 이 함수 대신 plain closeSheet()를 써서, 잠깐의 중간 상태로
 * 불필요하게 화면이 두 번 깜빡이지 않도록 한다.)
 */
function closeSheetToUnfiltered() {
  closeSheet();
  if (activeHashtagFilter || activeYearFilter !== null) {
    clearFilters();
  }
}

function showGoneState() {
  const content = document.getElementById("sheet-content");
  content.innerHTML = `
    <div class="gone-state-content">
      <p>이 기억은 더 이상<br />지도에 남아 있지 않습니다.</p>
      <button class="btn-primary" id="btn-find-another">어딘가의 기억 발견하기</button>
    </div>
  `;
  document.getElementById("sheet-backdrop").classList.remove("hidden");
  document.getElementById("bottom-sheet").classList.remove("hidden");
  sheetOpen = true;

  content.querySelector("#btn-find-another").onclick = () => {
    closeSheet();
    goToRandomStory();
  };
}

function renderSheetContent(group) {
  const content = document.getElementById("sheet-content");
  const title = Storage.getGroupTitle(group);

  let displayStories = group.stories;
  const focusYear = spotTimelineFocusYear[group.key];
  if (focusYear !== null && focusYear !== undefined) {
    displayStories = group.stories.filter((s) => Storage.getStoryYear(s) === focusYear);
  }

  const listHtml = buildSortedListHtml(displayStories, currentSort, (s) => renderStoryItem(s));

  const distinctYears = [...new Set(group.stories.map((s) => Storage.getStoryYear(s)).filter((y) => y !== null))].sort((a, b) => a - b);
  const isTimelineOpen = !!spotTimelineOpen[group.key];
  const spotCountLabel = group.stories.length > 1 ? `이곳에 ${group.stories.length}개의 기억이 쌓여 있습니다` : `${group.stories.length}개의 기억`;

  const timelineHtml = isTimelineOpen && distinctYears.length > 0
    ? `
      <div class="spot-timeline">
        <button class="timeline-pill ${focusYear === null || focusYear === undefined ? "timeline-pill--active" : ""}" data-year="">전체</button>
        ${distinctYears.map((y) => `<button class="timeline-pill ${focusYear === y ? "timeline-pill--active" : ""}" data-year="${y}">${y}</button>`).join("")}
      </div>
    `
    : "";

  const addressCaption = Storage.getGroupAddressCaption(group);

  content.innerHTML = `
    ${sheetReturnTo ? `<button class="sheet-back-link" id="sheet-back-link">← ${escapeHtml(sheetReturnTo.label)}</button>` : ""}
    <div class="story-spot-header">
      <div class="story-spot-name">${escapeHtml(title)}</div>
      ${addressCaption
        ? `
          <div class="story-spot-meta">
            <span class="story-spot-address">${escapeHtml(addressCaption)}</span>
            <span class="story-spot-count">${group.stories.length}개의 기억</span>
          </div>
        `
        : `<span class="story-spot-count">${group.stories.length}개의 기억</span>`}
    </div>
    ${SORT_TOGGLE_HTML(currentSort)}
    <div class="story-list">${listHtml}</div>
    ${distinctYears.length > 1 ? `<button class="spot-timeline-toggle" id="spot-timeline-toggle">${isTimelineOpen ? "시간연대표 접기" : spotCountLabel + " · 연대표 보기"} →</button>` : ""}
    ${timelineHtml}
    <button class="btn-primary btn-add-story" id="btn-add-story">나도 이곳에 기억 남기기</button>
  `;

  content.querySelectorAll(".sort-btn").forEach((btn) => {
    btn.onclick = () => { currentSort = btn.dataset.sort; renderSheetContent(group); };
  });

  bindStoryItemEvents(content, {
    onChange: () => renderSheetContent(group),
    onRemove: () => {
      const rawRefreshed = Storage.getGroupedByPlace().find((g) => g.key === group.key);
      const refreshed = rawRefreshed ? applyActiveFilterToGroup(rawRefreshed) : null;
      if (refreshed && refreshed.stories.length > 0) renderSheetContent(refreshed);
      else closeSheet();
    },
  });

  const timelineToggle = content.querySelector("#spot-timeline-toggle");
  if (timelineToggle) {
    timelineToggle.onclick = () => {
      spotTimelineOpen[group.key] = !spotTimelineOpen[group.key];
      renderSheetContent(group);
    };
  }

  content.querySelectorAll(".timeline-pill").forEach((pill) => {
    pill.onclick = () => {
      const y = pill.dataset.year;
      spotTimelineFocusYear[group.key] = y === "" ? null : parseInt(y, 10);
      renderSheetContent(group);
    };
  });

  content.querySelector("#btn-add-story").onclick = () => {
    requireLogin(() => {
      closeSheet();
      openComposer({
        lat: group.lat,
        lng: group.lng,
        officialPlaceName: group.officialPlaceName,
        placeId: group.placeId,
        address: group.address || null,
        isFreePin: !group.placeId,
      });
    });
  };

  const backLink = content.querySelector("#sheet-back-link");
  if (backLink) backLink.onclick = goBackFromSheet;

  // 목록에서 클릭해 들어온 경우, 그 기억으로 스크롤. 정렬/연대표 전환 등
  // 이후 재렌더에서는 반복하지 않도록 1회 소비 후 비운다.
  if (sheetHighlightStoryId) {
    const target = content.querySelector(`.story-item[data-story-id="${sheetHighlightStoryId}"]`);
    if (target) {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    sheetHighlightStoryId = null;
  }
}

/**
 * story-item 내부 공통 인터랙션(해시태그/연도 이동, 장소 이동, 공감, 전달, 신고/
 * 수정/삭제 메뉴)을 한 곳에서 바인딩한다. renderSheetContent(단일 스팟)와
 * renderHashtagSheetContent(태그 전체 목록)가 같이 쓴다 — 정렬 갱신처럼
 * 컨텍스트별로 달라지는 부분만 onChange/onRemove로 호출부에서 넘겨준다.
 */
function bindStoryItemEvents(content, { onChange, onRemove }) {
  content.querySelectorAll(".hashtag-link").forEach((link) => {
    link.onclick = () => exploreHashtag(link.dataset.tag);
  });

  content.querySelectorAll(".year-explore-link").forEach((link) => {
    link.onclick = () => exploreSameYear(parseInt(link.dataset.year, 10), link.dataset.storyId);
  });

  // 태그 전체 목록처럼 여러 스팟이 섞여 있는 화면에서만 렌더되는 장소 이동 링크
  // (renderStoryItem의 showLocation 옵션). 단일 스팟 화면엔 없어서 no-op.
  content.querySelectorAll(".story-place-line").forEach((btn) => {
    btn.onclick = () => {
      const story = Storage.getAllStories().find((s) => s.id === btn.dataset.storyId);
      if (!story) return;
      closeSheet();
      flyToStory(story, true);
    };
  });

  content.querySelectorAll(".reaction-btn").forEach((btn) => {
    btn.onclick = () => { Storage.toggleReaction(btn.dataset.id); onChange(); };
  });

  content.querySelectorAll(".share-btn").forEach((btn) => {
    btn.onclick = () => toggleSharePanel(btn.dataset.id);
  });

  content.querySelectorAll(".share-link-input").forEach((input) => {
    input.onclick = () => input.select();
  });

  content.querySelectorAll(".share-copy-btn").forEach((btn) => {
    btn.onclick = () => copyShareLink(btn.dataset.id);
  });

  content.querySelectorAll(".story-item-menu-btn").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const dropdown = document.getElementById(`menu-${btn.dataset.menuId}`);
      document.querySelectorAll(".story-item-menu-dropdown").forEach((d) => {
        if (d !== dropdown) d.classList.add("hidden");
      });
      dropdown.classList.toggle("hidden");
    };
  });

  content.querySelectorAll(".report-link").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      if (confirm("이 기록을 신고하시겠습니까?")) {
        Storage.reportStory(btn.dataset.id);
        alert("신고가 접수되었습니다.");
        onRemove();
        renderMarkers();
      }
    };
  });

  content.querySelectorAll(".edit-link").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const story = Storage.getAllStories().find((s) => s.id === btn.dataset.id);
      if (!story) return;
      closeSheet();
      startEditComposer(story);
    };
  });

  content.querySelectorAll(".delete-link").forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("이 기억을 삭제하시겠습니까?\n삭제하면 되돌릴 수 없습니다.")) return;
      try {
        await Storage.softDeleteStory(btn.dataset.id);
        onRemove();
        renderMarkers();
        renderHashtagChips();
      } catch (err) {
        console.error("스토리 삭제 실패", btn.dataset.id, err);
        alert("삭제에 실패했습니다. 잠시 후 다시 시도해주세요.");
      }
    };
  });
}

/**
 * 해시태그 칩/링크를 누르면 그 태그를 가진 모든 기억을(스팟 하나가 아니라
 * 전국에서) 한 목록으로 보여준다. 기본은 최신순, 시간여행순(연도·월 오름차순)
 * 으로도 볼 수 있다 — 스팟 상세의 sort-toggle과 같은 문법을 재사용한다.
 */
function openHashtagSheet(tag) {
  hashtagSheetTag = tag;
  hashtagSheetSort = "latest";
  // 해시태그 목록은 스팟 상세와 다른 화면 흐름이라 이전 목록으로 돌아가는
  // 링크(sheetReturnTo)를 물려받지 않는다 — 여기서 명시적으로 비운다.
  sheetReturnTo = null;
  renderHashtagSheetContent();
  document.getElementById("sheet-backdrop").classList.remove("hidden");
  document.getElementById("bottom-sheet").classList.remove("hidden");
  document.getElementById("sheet-content").scrollTop = 0;
  sheetOpen = true;
}

/**
 * 상단 바 "더보기" 칩 — 화면에 다 못 넣는 21위 이후 해시태그까지 포함해
 * 전체 태그를 많이 쓰인 순으로 목록으로 보여준다. 태그를 고르면
 * exploreHashtag로 이어져 그 태그의 기억 목록(openHashtagSheet)으로 전환된다.
 */
function openAllTagsSheet() {
  sheetReturnTo = null;
  renderAllTagsSheetContent();
  document.getElementById("sheet-backdrop").classList.remove("hidden");
  document.getElementById("bottom-sheet").classList.remove("hidden");
  document.getElementById("sheet-content").scrollTop = 0;
  sheetOpen = true;
}

function renderAllTagsSheetContent() {
  const content = document.getElementById("sheet-content");
  const tags = Storage.getAllHashtagsWithCounts();

  const listHtml = tags
    .map(
      ({ tag, count }) => `
        <button class="all-tags-item" data-tag="${escapeHtml(tag)}">
          <span class="all-tags-item-name">${escapeHtml(tag)}</span>
          <span class="all-tags-item-count">${count.toLocaleString()}</span>
        </button>
      `
    )
    .join("");

  content.innerHTML = `
    <div class="story-spot-header">
      <div class="story-spot-name">모든 해시태그</div>
      <span class="story-spot-count">${tags.length}개의 태그</span>
    </div>
    <div class="all-tags-list">${listHtml || `<p class="story-list-empty">아직 태그가 없습니다.</p>`}</div>
  `;

  content.querySelectorAll(".all-tags-item").forEach((btn) => {
    btn.onclick = () => exploreHashtag(btn.dataset.tag);
  });
}

function renderHashtagSheetContent() {
  const tag = hashtagSheetTag;
  const content = document.getElementById("sheet-content");
  const stories = Storage.getVisibleStories().filter((s) => (s.hashtags || []).includes(tag));

  const listHtml = buildSortedListHtml(stories, hashtagSheetSort, (s) => renderStoryItem(s, { showLocation: true }));

  content.innerHTML = `
    <div class="story-spot-header">
      <div class="story-spot-name">${escapeHtml(tag)}</div>
      <span class="story-spot-count">${stories.length}개의 기억</span>
    </div>
    ${SORT_TOGGLE_HTML(hashtagSheetSort)}
    <div class="story-list">${listHtml || `<p class="story-list-empty">아직 이 태그를 가진 기억이 없습니다.</p>`}</div>
  `;

  content.querySelectorAll(".sort-btn").forEach((btn) => {
    btn.onclick = () => { hashtagSheetSort = btn.dataset.sort; renderHashtagSheetContent(); };
  });

  bindStoryItemEvents(content, {
    onChange: renderHashtagSheetContent,
    onRemove: renderHashtagSheetContent,
  });
}

function renderStoryItem(story, options = {}) {
  const numericYear = Storage.getStoryYear(story);
  const month = Storage.getStoryMonth(story);
  const yearMain = numericYear !== null ? numericYear : "· · ·";
  const tagsHtml = story.hashtags.map((t) => `<button class="hashtag-link" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join(" ");
  const reacted = Storage.hasReacted(story.id);
  const locationHtml = options.showLocation
    ? `<button class="story-place-line" data-story-id="${story.id}">📍 ${escapeHtml(Storage.getGroupTitle({ placeId: story.placeId, officialPlaceName: story.officialPlaceName, customName: story.customName, address: story.address }))} →</button>`
    : "";

  // "내가 쓴 글"은 실계정이 아니라 authorDeviceId(브라우저 단위 비식별
  // 상관관계, mymemory.js의 "내가 남긴 기억"과 동일 기준)로 판단한다.
  // 내 글이면 수정/삭제, 남의 글이면 신고만 노출한다.
  const authorName = story.displayAuthorName || "익명";
  const authorNameWithHonorific = authorName === "익명" ? authorName : `${authorName}님`;

  const isMine = !!story.authorDeviceId && story.authorDeviceId === Storage.getDeviceId();
  const menuItemsHtml = isMine
    ? `<button class="edit-link" data-id="${story.id}">수정하기</button>
       <button class="delete-link" data-id="${story.id}">삭제하기</button>`
    : `<button class="report-link" data-id="${story.id}">이 기록 신고하기</button>`;

  return `
    <div class="story-item" data-story-id="${story.id}">
      <div class="story-date-block">
        <p class="story-year">${yearMain}</p>
        ${month ? `<p class="story-month">${month}월</p>` : ""}
      </div>
      ${locationHtml}
      <p class="story-content">${escapeHtml(story.content)}</p>
      <div class="story-author-row">
        <div class="story-author-identity">
          <span class="story-avatar">🙂</span>
          <span class="story-author">${escapeHtml(story.displayAuthorName || "익명")}</span>
        </div>
        <div class="story-item-menu">
          <button class="story-item-menu-btn" data-menu-id="${story.id}">•••</button>
          <div class="story-item-menu-dropdown hidden" id="menu-${story.id}">
            ${menuItemsHtml}
          </div>
        </div>
      </div>
      ${story.customName ? `<p class="story-custom-name">${escapeHtml(authorNameWithHonorific)}이 이곳을 '${escapeHtml(story.customName)}'이라고 부릅니다</p>` : ""}
      ${tagsHtml ? `<div class="story-tags">${tagsHtml}</div>` : ""}

      <div class="action-row-split">
        <button class="reaction-btn ${reacted ? "reaction-btn--active" : ""}" data-id="${story.id}">
          <span class="dot-icon">${reacted ? "●" : "♡"}</span>
          떠올랐어요
        </button>
        <button class="share-btn" data-id="${story.id}">↗ 기억 전하기</button>
      </div>

      <div class="share-panel-inline hidden" id="share-panel-${story.id}">
        <p class="share-panel-title">이 기억을 전할게요</p>
        <div class="share-link-row">
          <input type="text" class="share-link-input" id="share-link-input-${story.id}" value="${buildStoryUrl(story.publicId)}" readonly />
          <button class="share-copy-btn" data-id="${story.id}">복사</button>
        </div>
        <p class="share-panel-privacy">🔒 공유해도 작성자는 익명으로 유지됩니다</p>
      </div>

      ${numericYear !== null ? `<button class="year-explore-link" data-year="${numericYear}" data-story-id="${story.id}">${numericYear}년의 다른 기억 둘러보기 →</button>` : ""}
    </div>
  `;
}

function getStoryYearLabel(story) {
  const y = Storage.getStoryYear(story);
  return y !== null ? y : "· · ·";
}

// ------------------------------------------------------------
// 기억 전달하기 — 카드 안에서 펼쳐지는 링크 패널(2026-08-13, 카카오톡
// 공유 버튼은 제거하고 링크 보여주기+복사로 단순화).
// ------------------------------------------------------------
function buildStoryUrl(publicId) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?story=${publicId}`;
}

function toggleSharePanel(storyId) {
  const panel = document.getElementById(`share-panel-${storyId}`);
  if (panel) panel.classList.toggle("hidden");
}

async function copyShareLink(storyId) {
  const story = Storage.getAllStories().find((s) => s.id === storyId);
  if (!story) return;
  const url = buildStoryUrl(story.publicId);
  const linkInput = document.getElementById(`share-link-input-${storyId}`);

  try {
    await navigator.clipboard.writeText(url);
    showToast("share-toast", "링크가 복사되었습니다.", 2000);
  } catch (e) {
    if (linkInput) linkInput.select();
    showToast("share-toast", "링크를 직접 선택해 복사해주세요.", 2000);
    return;
  }
  Storage.incrementShareCount(storyId);
  Storage.markShared(storyId);
}
