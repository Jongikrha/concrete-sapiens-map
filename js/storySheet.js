// ============================================================
// Bottom Sheet — 이야기 열람 + 기억 전달하기(공유 카드)
// ============================================================

let sheetOpen = false;
let spotTimelineOpen = {};
let spotTimelineFocusYear = {};
let currentSort = "latest";
let hashtagSheetTag = null;
let hashtagSheetSort = "latest";

function openSheet(group) {
  currentSort = "latest";
  spotTimelineOpen[group.key] = false;
  spotTimelineFocusYear[group.key] = null;
  renderSheetContent(group);
  document.getElementById("sheet-backdrop").classList.remove("hidden");
  document.getElementById("bottom-sheet").classList.remove("hidden");
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

  let listHtml;
  if (currentSort === "timetravel") {
    const dated = displayStories.filter((s) => Storage.getStoryYear(s) !== null);
    const undated = displayStories.filter((s) => Storage.getStoryYear(s) === null);

    dated.sort((a, b) => {
      const ay = Storage.getStoryYear(a), by = Storage.getStoryYear(b);
      if (ay !== by) return ay - by;
      const am = Storage.getStoryMonth(a) || 0, bm = Storage.getStoryMonth(b) || 0;
      return am - bm;
    });
    undated.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    listHtml = dated.map((s) => renderStoryItem(s)).join("");
    if (undated.length > 0) {
      listHtml += `<div class="timeline-section-label">시점을 알 수 없는 기억들</div>`;
      listHtml += undated.map((s) => renderStoryItem(s)).join("");
    }
  } else {
    const sorted = [...displayStories].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    listHtml = sorted.map((s) => renderStoryItem(s)).join("");
  }

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
    <div class="story-spot-header">
      <div class="story-spot-name">${escapeHtml(title)}</div>
      ${addressCaption ? `<div class="story-spot-address">${escapeHtml(addressCaption)}</div>` : ""}
      <span class="story-spot-count">${group.stories.length}개의 기억</span>
    </div>
    <div class="sort-toggle">
      <button class="sort-btn ${currentSort === "latest" ? "sort-btn--active" : ""}" data-sort="latest">최신순</button>
      <button class="sort-btn ${currentSort === "timetravel" ? "sort-btn--active" : ""}" data-sort="timetravel">시간여행순</button>
    </div>
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
    onReport: () => {
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
}

/**
 * story-item 내부 공통 인터랙션(해시태그/연도 이동, 장소 이동, 공감, 전달, 신고
 * 메뉴)을 한 곳에서 바인딩한다. renderSheetContent(단일 스팟)와
 * renderHashtagSheetContent(태그 전체 목록)가 같이 쓴다 — 정렬 갱신처럼
 * 컨텍스트별로 달라지는 부분만 onChange/onReport로 호출부에서 넘겨준다.
 */
function bindStoryItemEvents(content, { onChange, onReport }) {
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
    btn.onclick = () => handleShare(btn.dataset.id);
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
        onReport();
        renderMarkers();
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
  renderHashtagSheetContent();
  document.getElementById("sheet-backdrop").classList.remove("hidden");
  document.getElementById("bottom-sheet").classList.remove("hidden");
  sheetOpen = true;
}

function renderHashtagSheetContent() {
  const tag = hashtagSheetTag;
  const content = document.getElementById("sheet-content");
  const stories = Storage.getVisibleStories().filter((s) => (s.hashtags || []).includes(tag));

  let listHtml;
  if (hashtagSheetSort === "timetravel") {
    const dated = stories.filter((s) => Storage.getStoryYear(s) !== null);
    const undated = stories.filter((s) => Storage.getStoryYear(s) === null);

    dated.sort((a, b) => {
      const ay = Storage.getStoryYear(a), by = Storage.getStoryYear(b);
      if (ay !== by) return ay - by;
      const am = Storage.getStoryMonth(a) || 0, bm = Storage.getStoryMonth(b) || 0;
      return am - bm;
    });
    undated.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    listHtml = dated.map((s) => renderStoryItem(s, { showLocation: true })).join("");
    if (undated.length > 0) {
      listHtml += `<div class="timeline-section-label">시점을 알 수 없는 기억들</div>`;
      listHtml += undated.map((s) => renderStoryItem(s, { showLocation: true })).join("");
    }
  } else {
    const sorted = [...stories].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    listHtml = sorted.map((s) => renderStoryItem(s, { showLocation: true })).join("");
  }

  content.innerHTML = `
    <div class="story-spot-header">
      <div class="story-spot-name">${escapeHtml(tag)}</div>
      <span class="story-spot-count">${stories.length}개의 기억</span>
    </div>
    <div class="sort-toggle">
      <button class="sort-btn ${hashtagSheetSort === "latest" ? "sort-btn--active" : ""}" data-sort="latest">최신순</button>
      <button class="sort-btn ${hashtagSheetSort === "timetravel" ? "sort-btn--active" : ""}" data-sort="timetravel">시간여행순</button>
    </div>
    <div class="story-list">${listHtml || `<p class="story-list-empty">아직 이 태그를 가진 기억이 없습니다.</p>`}</div>
  `;

  content.querySelectorAll(".sort-btn").forEach((btn) => {
    btn.onclick = () => { hashtagSheetSort = btn.dataset.sort; renderHashtagSheetContent(); };
  });

  bindStoryItemEvents(content, {
    onChange: renderHashtagSheetContent,
    onReport: renderHashtagSheetContent,
  });
}

function renderStoryItem(story, options = {}) {
  const numericYear = Storage.getStoryYear(story);
  const month = Storage.getStoryMonth(story);
  const yearMain = numericYear !== null ? numericYear : "· · ·";
  const tagsHtml = story.hashtags.map((t) => `<button class="hashtag-link" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`).join(" ");
  const reacted = Storage.hasReacted(story.id);
  const locationHtml = options.showLocation
    ? `<button class="story-place-line" data-story-id="${story.id}">${escapeHtml(Storage.getGroupTitle({ placeId: story.placeId, officialPlaceName: story.officialPlaceName, customName: story.customName, address: story.address }))}</button>`
    : "";

  return `
    <div class="story-item">
      <div class="story-date-block">
        <p class="story-year">${yearMain}</p>
        ${month ? `<p class="story-month">${month}월</p>` : ""}
      </div>
      ${locationHtml}
      <p class="story-content">${escapeHtml(story.content)}</p>
      <div class="story-author-row">
        <span class="story-author">${escapeHtml(story.displayAuthorName || "익명")}</span>
        <div class="story-item-menu">
          <button class="story-item-menu-btn" data-menu-id="${story.id}">•••</button>
          <div class="story-item-menu-dropdown hidden" id="menu-${story.id}">
            <button class="report-link" data-id="${story.id}">이 기록 신고하기</button>
          </div>
        </div>
      </div>
      ${story.customName ? `<p class="story-custom-name">${escapeHtml(story.displayAuthorName || "익명")}이 이곳을 '${escapeHtml(story.customName)}'이라고 부릅니다</p>` : ""}
      ${tagsHtml ? `<div class="story-tags">${tagsHtml}</div>` : ""}

      <div class="action-row-split">
        <button class="reaction-btn ${reacted ? "reaction-btn--active" : ""}" data-id="${story.id}">
          <span class="dot-icon">${reacted ? "●" : "♡"}</span>
          떠올랐어요
        </button>
        <button class="share-btn" data-id="${story.id}">↗ 기억 전하기</button>
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
// 기억 전달하기 — 공유 카드 이미지 생성 + Web Share API
// ------------------------------------------------------------
function buildStoryUrl(publicId) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?story=${publicId}`;
}

function wrapCanvasText(ctx, text, maxWidth) {
  const chars = text.split("");
  const lines = [];
  let line = "";
  chars.forEach((ch) => {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line = test;
    }
  });
  if (line) lines.push(line);
  return lines;
}

// 인스타그램 스토리에 그대로 채워지는 9:16 세로 카드. 연도·장소·인용구는
// 콘텐츠 길이에 따라 세로 위치가 밀리고, CTA/로고는 항상 하단에 고정한다.
function generateShareCard(story) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#2F3031";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#FF5A36";
  ctx.beginPath();
  ctx.arc(96, 140, 12, 0, Math.PI * 2);
  ctx.fill();

  const year = Storage.getStoryYear(story);
  const groupLike = {
    placeId: story.placeId,
    officialPlaceName: story.officialPlaceName,
    customName: story.customName,
    address: story.address,
  };
  const title = Storage.getGroupTitle(groupLike);
  const addressCaption = Storage.getGroupAddressCaption(groupLike);

  const marginX = 96;
  const maxWidth = canvas.width - marginX * 2;
  let cursorY = 340;

  ctx.fillStyle = "#F4F3EF";
  ctx.font = "700 168px sans-serif";
  ctx.fillText(year !== null ? String(year) : "· · ·", marginX, cursorY);
  cursorY += 100;

  ctx.font = "700 56px sans-serif";
  ctx.fillStyle = "#F4F3EF";
  const titleLines = wrapCanvasText(ctx, title, maxWidth).slice(0, 2);
  titleLines.forEach((line, i) => ctx.fillText(line, marginX, cursorY + i * 68));
  cursorY += titleLines.length * 68 + 8;

  // 작성자가 붙인 지역명(title)만으로는 실제 위치를 모를 수 있어
  // 지번 주소를 옆에(작은 글씨로) 항상 함께 보여준다.
  if (addressCaption) {
    ctx.font = "400 30px sans-serif";
    ctx.fillStyle = "#B9B9B5";
    const addrLines = wrapCanvasText(ctx, addressCaption, maxWidth).slice(0, 2);
    addrLines.forEach((line, i) => ctx.fillText(line, marginX, cursorY + i * 40));
    cursorY += addrLines.length * 40;
  }
  cursorY += 100;

  const footerY = canvas.height - 200;
  const lineHeight = 76;
  const maxQuoteLines = Math.max(3, Math.floor((footerY - 40 - cursorY) / lineHeight));

  ctx.font = "400 52px serif";
  ctx.fillStyle = "#F4F3EF";
  let quoteLines = wrapCanvasText(ctx, `"${story.content}"`, maxWidth);
  if (quoteLines.length > maxQuoteLines) {
    quoteLines = quoteLines.slice(0, maxQuoteLines);
    const last = quoteLines[quoteLines.length - 1];
    quoteLines[quoteLines.length - 1] = last.slice(0, Math.max(0, last.length - 1)) + "…";
  }
  quoteLines.forEach((line, i) => ctx.fillText(line, marginX, cursorY + i * lineHeight));

  ctx.font = "700 38px sans-serif";
  ctx.fillStyle = "#F4F3EF";
  ctx.fillText("이 기억의 장소를 지도에서", marginX, footerY);
  ctx.fillText("열어보세요 →", marginX, footerY + 52);

  ctx.font = "700 30px sans-serif";
  ctx.fillStyle = "#FF5A36";
  ctx.fillText("CONCRETE SAPIENS", marginX, footerY + 120);
  ctx.font = "400 24px sans-serif";
  ctx.fillStyle = "#B9B9B5";
  ctx.fillText("MEMORY MAP", marginX, footerY + 150);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

async function handleShare(storyId) {
  const story = Storage.getAllStories().find((s) => s.id === storyId);
  if (!story) return;

  const url = buildStoryUrl(story.publicId);
  const title = Storage.getGroupTitle({ placeId: story.placeId, officialPlaceName: story.officialPlaceName, customName: story.customName, address: story.address });
  const year = Storage.getStoryYear(story);
  const shareText = `여기 이런 기억이 남아 있었어.\n${title}${year ? " · " + year : ""}`;

  Storage.incrementShareCount(storyId);
  Storage.markShared(storyId);

  try {
    const blob = await generateShareCard(story);
    const file = new File([blob], "concrete-sapiens-memory.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title: "콘크리트 사피엔스 지도", text: shareText, url, files: [file] });
      return;
    }
  } catch (e) {
    // 폴백으로 진행
  }

  if (navigator.share) {
    try {
      await navigator.share({ title: "콘크리트 사피엔스 지도", text: shareText, url });
      return;
    } catch (e) {
      return;
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    showToast("share-toast", "링크가 복사되었습니다.", 2000);
  } catch (e) {
    showToast("share-toast", "링크 복사에 실패했습니다.", 2000);
  }
}
