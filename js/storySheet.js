// ============================================================
// Bottom Sheet — 이야기 열람 + 기억 전달하기(공유 카드)
// ============================================================

let sheetOpen = false;
let spotTimelineOpen = {};
let spotTimelineFocusYear = {};
let currentSort = "latest";

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

    listHtml = dated.map(renderStoryItem).join("");
    if (undated.length > 0) {
      listHtml += `<div class="timeline-section-label">시점을 알 수 없는 기억들</div>`;
      listHtml += undated.map(renderStoryItem).join("");
    }
  } else {
    const sorted = [...displayStories].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    listHtml = sorted.map(renderStoryItem).join("");
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

  content.querySelectorAll(".hashtag-link").forEach((link) => {
    link.onclick = () => exploreHashtag(link.dataset.tag, link.dataset.storyId);
  });

  content.querySelectorAll(".year-explore-link").forEach((link) => {
    link.onclick = () => exploreSameYear(parseInt(link.dataset.year, 10), link.dataset.storyId);
  });

  content.querySelectorAll(".reaction-btn").forEach((btn) => {
    btn.onclick = () => { Storage.toggleReaction(btn.dataset.id); renderSheetContent(group); };
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
        const rawRefreshed = Storage.getGroupedByPlace().find((g) => g.key === group.key);
        const refreshed = rawRefreshed ? applyActiveFilterToGroup(rawRefreshed) : null;
        if (refreshed && refreshed.stories.length > 0) renderSheetContent(refreshed);
        else closeSheet();
        renderMarkers();
      }
    };
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

function renderStoryItem(story) {
  const numericYear = Storage.getStoryYear(story);
  const month = Storage.getStoryMonth(story);
  const yearMain = numericYear !== null ? numericYear : "· · ·";
  const tagsHtml = story.hashtags.map((t) => `<button class="hashtag-link" data-tag="${escapeHtml(t)}" data-story-id="${story.id}">${escapeHtml(t)}</button>`).join(" ");
  const reacted = Storage.hasReacted(story.id);

  return `
    <div class="story-item">
      <div class="story-date-block">
        <p class="story-year">${yearMain}</p>
        ${month ? `<p class="story-month">${month}월</p>` : ""}
      </div>
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

function generateShareCard(story) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#2F3031";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#FF5A36";
  ctx.beginPath();
  ctx.arc(90, 90, 10, 0, Math.PI * 2);
  ctx.fill();

  const year = Storage.getStoryYear(story);
  const title = Storage.getGroupTitle({ placeId: story.placeId, officialPlaceName: story.officialPlaceName, address: story.address });

  ctx.fillStyle = "#F4F3EF";
  ctx.font = "700 96px sans-serif";
  ctx.fillText(year !== null ? String(year) : "· · ·", 80, 220);

  ctx.font = "400 32px sans-serif";
  ctx.fillStyle = "#B9B9B5";
  ctx.fillText(title, 84, 270);

  ctx.font = "400 34px serif";
  ctx.fillStyle = "#F4F3EF";
  const lines = wrapCanvasText(ctx, `"${story.content}"`, 1020).slice(0, 5);
  lines.forEach((line, i) => ctx.fillText(line, 84, 360 + i * 48));

  ctx.font = "700 24px sans-serif";
  ctx.fillStyle = "#F4F3EF";
  ctx.fillText("CONCRETE SAPIENS", 84, 560);
  ctx.font = "400 20px sans-serif";
  ctx.fillStyle = "#B9B9B5";
  ctx.fillText("MEMORY MAP", 84, 588);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

async function handleShare(storyId) {
  const story = Storage.getAllStories().find((s) => s.id === storyId);
  if (!story) return;

  const url = buildStoryUrl(story.publicId);
  const title = Storage.getGroupTitle({ placeId: story.placeId, officialPlaceName: story.officialPlaceName, address: story.address });
  const year = Storage.getStoryYear(story);
  const shareText = `여기 이런 기억이 남아 있었어.\n${title}${year ? " · " + year : ""}`;

  Storage.incrementShareCount(storyId);

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
