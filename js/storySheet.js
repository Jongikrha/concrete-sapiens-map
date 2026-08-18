// ============================================================
// Bottom Sheet — 이야기 열람 + 기억 전달하기(공유 카드)
// ============================================================

let sheetOpen = false;
let spotTimelineOpen = {};
let spotTimelineFocusYear = {};
// 이 스팟(정확히 같은 장소) 기억 아래, 반경 500m 안의 다른 기억들을
// "근처의 기억"으로 접어서 보여준다(2026-08-18, 반경은 2026-08-18 300m→500m로
// 조정). 1000m는 이미 "우연히 겹치는" 알림(같은 해 한정, js/mymemory.js)에
// 쓰고 있어서 겹치지 않게, 여기는 연도 제한 없이 전부 보여준다.
const NEARBY_STORIES_RADIUS_METERS = 500;
const NEARBY_STORIES_CAP = 30;
let spotNearbyOpen = {};
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
  // 시트를 CSS로 숨기기만 하고 iframe은 그대로 두면 유튜브 재생이 백그라운드
  // 에서 계속된다 — 닫을 때 재생 중이던 임베드를 제거해 확실히 멈춘다.
  // 다시 열릴 땐 항상 renderSheetContent가 새로 그려서 썸네일 상태로 복원된다.
  document.querySelectorAll("#sheet-content .story-youtube-frame").forEach((f) => f.remove());
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

function showGoneState(message = "이 기억은 더 이상<br />지도에 남아 있지 않습니다.") {
  const content = document.getElementById("sheet-content");
  content.innerHTML = `
    <div class="gone-state-content">
      <p>${message}</p>
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

  // "근처의 기억" — 이 스팟과 정확히 같은 장소가 아니라도 반경 500m 안에
  // 있는 기억들. 연도 필터는 걸지 않는다(우연히 겹치는 알림과 달리 그냥
  // "이 동네를 둘러보는" 발견 섹션이라 활성 해시태그/연도 필터도 여기까지
  // 좁히지 않는다 — 지금 보고 있는 태그와 무관하게 근처엔 뭐가 있는지
  // 보여주는 게 취지).
  const exactStoryIds = new Set(group.stories.map((s) => s.id));
  const nearbyStories = Storage.getStoriesNear(group.lat, group.lng, NEARBY_STORIES_RADIUS_METERS)
    .filter((s) => !exactStoryIds.has(s.id))
    // 30개가 넘으면 가장 가까운 것부터 우선 보여준다(먼 것부터 잘리는 게
    // 아니라 가까운 것부터 채워지도록).
    .sort((a, b) => Storage._distanceMeters(group.lat, group.lng, a.lat, a.lng) - Storage._distanceMeters(group.lat, group.lng, b.lat, b.lng))
    .slice(0, NEARBY_STORIES_CAP);
  const isNearbyOpen = !!spotNearbyOpen[group.key];
  const nearbyListHtml = isNearbyOpen
    ? buildSortedListHtml(nearbyStories, currentSort, (s) => renderStoryItem(s, { showLocation: true }))
    : "";

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
      ${group.stories.length > 1
        ? `
          <button type="button" class="spot-share-toggle" id="spot-share-toggle">↗ 이 장소 기억 전부 공유</button>
          <div class="share-panel-inline hidden" id="spot-share-panel">
            ${renderSharePrivacyBox()}
            <div class="share-link-row">
              <span class="share-link-icon">🔗</span>
              <input type="text" class="share-link-input" id="spot-share-link-input" value="${buildPlaceUrl(group.key)}" readonly />
              <button type="button" class="share-copy-btn" id="spot-share-copy-btn">복사</button>
            </div>
            <button type="button" class="share-card-btn" id="spot-share-card-btn">
              <span class="share-card-btn-icon">🖼️</span>
              <span class="share-card-btn-label">카드 이미지로 공유하기</span>
              <span class="share-card-btn-chevron">›</span>
            </button>
          </div>
        `
        : ""}
    </div>
    ${displayStories.length > 1 ? SORT_TOGGLE_HTML(currentSort) : ""}
    <div class="story-list">${listHtml}</div>
    ${distinctYears.length > 1
      ? `
        <button type="button" class="spot-banner spot-banner--year" id="spot-timeline-toggle">
          <span class="spot-banner-icon">📅</span>
          <span class="spot-banner-text">
            <span class="spot-banner-title">${isTimelineOpen ? "시간연대표 접기" : "시간연대표로 보기"}</span>
            <span class="spot-banner-subtitle">${escapeHtml(spotCountLabel)}</span>
          </span>
          <span class="spot-banner-chevron">${isTimelineOpen ? "⌃" : "›"}</span>
        </button>
      `
      : ""}
    ${timelineHtml}
    ${nearbyStories.length > 0
      ? `
        <button type="button" class="spot-banner spot-banner--nearby" id="spot-nearby-toggle">
          <span class="spot-banner-icon">📍</span>
          <span class="spot-banner-text">
            <span class="spot-banner-title">${isNearbyOpen ? "근처의 기억 접기" : `근처의 기억 ${nearbyStories.length}개 보기`}</span>
            <span class="spot-banner-subtitle">이 주변에 남겨진 다른 기억을 찾아보세요</span>
          </span>
          <span class="spot-banner-chevron">${isNearbyOpen ? "⌃" : "›"}</span>
        </button>
        <div class="story-list">${nearbyListHtml}</div>
      `
      : ""}
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

  const nearbyToggle = content.querySelector("#spot-nearby-toggle");
  if (nearbyToggle) {
    nearbyToggle.onclick = () => {
      spotNearbyOpen[group.key] = !spotNearbyOpen[group.key];
      renderSheetContent(group);
    };
  }

  content.querySelector("#btn-add-story").onclick = () => {
    requireLogin(() => {
      closeSheet();
      if (group.placeId) {
        openComposer({
          lat: group.lat,
          lng: group.lng,
          officialPlaceName: group.officialPlaceName,
          placeId: group.placeId,
          address: group.address || null,
          isFreePin: false,
        });
      } else {
        // 자유 핀 스팟 — 새 자유 핀 작성과 동일하게 주소/건물명을
        // 다시 조회해서 채워준다(그룹엔 customName을 안 남기므로
        // 재사용할 이전 이름이 없다).
        startFreePinComposer(group.lat, group.lng);
      }
    });
  };

  const spotShareToggle = content.querySelector("#spot-share-toggle");
  if (spotShareToggle) {
    spotShareToggle.onclick = () => {
      document.getElementById("spot-share-panel").classList.toggle("hidden");
    };
  }
  const spotShareCopyBtn = content.querySelector("#spot-share-copy-btn");
  if (spotShareCopyBtn) spotShareCopyBtn.onclick = () => copyPlaceShareLink(group);
  const spotShareCardBtn = content.querySelector("#spot-share-card-btn");
  if (spotShareCardBtn) spotShareCardBtn.onclick = () => sharePlaceCard(group);

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

  // 유튜브 임베드는 썸네일 버튼으로만 렌더해뒀다가 클릭 시점에 iframe으로
  // 바꿔 끼운다 — 카드가 여러 개 쌓인 목록에서 iframe을 한꺼번에 다 로드하면
  // 무거워지고, 브라우저 자동재생 정책상 어차피 소리 없이는 못 켜진다.
  content.querySelectorAll(".story-youtube-thumb").forEach((btn) => {
    btn.onclick = () => {
      const wrap = btn.closest(".story-youtube");
      const videoId = wrap.dataset.videoId;
      wrap.innerHTML = `<iframe class="story-youtube-frame" src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1" title="YouTube video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
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

  content.querySelectorAll(".share-card-btn").forEach((btn) => {
    btn.onclick = () => shareStoryCard(btn.dataset.id);
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
    ${stories.length > 1 ? SORT_TOGGLE_HTML(hashtagSheetSort) : ""}
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

function renderYoutubeEmbed(story) {
  const videoId = Storage.extractYoutubeVideoId(story.youtubeUrl);
  if (!videoId) return "";
  return `
    <div class="story-youtube" data-video-id="${videoId}">
      <button type="button" class="story-youtube-thumb" style="background-image:url('https://i.ytimg.com/vi/${videoId}/hqdefault.jpg')" aria-label="노래 재생">
        <span class="story-youtube-play">▶</span>
      </button>
    </div>
  `;
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

  // "내가 쓴 글"은 오직 계정 연결(StoryAuthor, Storage.isMyStory)로만
  // 판단한다 — 브라우저 기기ID는 절대 안 쓴다(2026-08-14, mymemory.js
  // 헤더 주석 참고). 내 글이면 수정/삭제, 남의 글이면 신고만 노출한다.
  const authorName = story.displayAuthorName || "익명";
  const authorNameWithHonorific = authorName === "익명" ? authorName : `${authorName}님`;

  const isMine = Storage.isMyStory(story.id);
  const menuItemsHtml = isMine
    ? `<button class="edit-link" data-id="${story.id}">수정하기</button>
       <button class="delete-link" data-id="${story.id}">삭제하기</button>`
    : `<button class="report-link" data-id="${story.id}">이 기록 신고하기</button>`;

  // "우연히 겹치는 사람" 발견 — 같은 장소에서 같은 해를 기억하는 다른
  // 기억이 있으면 조용히 알려준다. 누가인지는 밝히지 않고 개수만(느슨한
  // SNS 톤, 2026-08-14 논의). 연도를 모르는 기억(numericYear === null)엔
  // 표시하지 않는다 — 비교 기준 자체가 없다.
  const overlapCount = numericYear !== null
    ? Storage.getStoriesAtSamePlace(story).filter((s) => Storage.getStoryYear(s) === numericYear).length
    : 0;

  return `
    <div class="story-item" data-story-id="${story.id}">
      <div class="story-date-block">
        <p class="story-year">${yearMain}</p>
        ${month ? `<p class="story-month">${month}월</p>` : ""}
      </div>
      ${locationHtml}
      <p class="story-content">${escapeHtml(story.content)}</p>
      ${renderYoutubeEmbed(story)}
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
      ${overlapCount > 0 ? `<p class="story-overlap-caption">같은 해의 기억이 이곳에 ${overlapCount}개 더 있어요</p>` : ""}

      <div class="action-row-split">
        <button class="reaction-btn ${reacted ? "reaction-btn--active" : ""}" data-id="${story.id}">
          <span class="dot-icon">${reacted ? "●" : "♡"}</span>
          떠올랐어요
        </button>
        <button class="share-btn" data-id="${story.id}">↗ 기억 전하기</button>
      </div>

      <div class="share-panel-inline hidden" id="share-panel-${story.id}">
        ${renderSharePrivacyBox()}
        <div class="share-link-row">
          <span class="share-link-icon">🔗</span>
          <input type="text" class="share-link-input" id="share-link-input-${story.id}" value="${buildStoryUrl(story.publicId)}" readonly />
          <button class="share-copy-btn" data-id="${story.id}">복사</button>
        </div>
        <button type="button" class="share-card-btn" data-id="${story.id}">
          <span class="share-card-btn-icon">🖼️</span>
          <span class="share-card-btn-label">카드 이미지로 공유하기</span>
          <span class="share-card-btn-chevron">›</span>
        </button>
      </div>

      ${numericYear !== null
        ? `
          <button type="button" class="spot-banner spot-banner--year year-explore-link" data-year="${numericYear}" data-story-id="${story.id}">
            <span class="spot-banner-icon">📅</span>
            <span class="spot-banner-text">
              <span class="spot-banner-title">${numericYear}년 다른 기억 둘러보기</span>
              <span class="spot-banner-subtitle">이 해에 남겨진 다른 기억으로 이동해요</span>
            </span>
            <span class="spot-banner-chevron">›</span>
          </button>
        `
        : ""}
    </div>
  `;
}

function getStoryYearLabel(story) {
  const y = Storage.getStoryYear(story);
  return y !== null ? y : "· · ·";
}

// ------------------------------------------------------------
// 기억 전달하기 — 카드 안에서 펼쳐지는 링크 패널(2026-08-13, 카카오톡
// 공유 버튼은 제거하고 링크 보여주기+복사로 단순화). 개별 기억/스팟 전체
// 공유 패널이 똑같은 안내 박스를 쓴다(2026-08-18 리디자인) — 중복 방지로
// 공통 함수 하나로 뺐다.
// ------------------------------------------------------------
function renderSharePrivacyBox() {
  return `
    <div class="share-privacy-box">
      <span class="share-privacy-icon">🔒</span>
      <p class="share-privacy-text">기억만 전해지고,<br />작성자는 익명으로 남습니다.</p>
      <span class="share-privacy-deco" aria-hidden="true">✈️</span>
    </div>
  `;
}

function buildStoryUrl(publicId) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?story=${publicId}`;
}

// 장소(스팟) 단위 공유 링크 — 개별 기억이 아니라 그 장소에 쌓인 기억
// 전체(그룹 시트)로 바로 진입한다(2026-08-18, js/app.js handleInitialEntry
// 의 ?place= 처리와 짝을 이룬다). group.key는 Storage._groupKeyFor가 만드는
// "place:<placeId>" 또는 "pin:<lat>,<lng>" 형식이라 그대로 노출해도
// 안전하지만(작성자 신원과 무관), ':'/',' 때문에 인코딩은 해둔다.
function buildPlaceUrl(groupKey) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}?place=${encodeURIComponent(groupKey)}`;
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

async function copyPlaceShareLink(group) {
  const url = buildPlaceUrl(group.key);
  const linkInput = document.getElementById("spot-share-link-input");

  try {
    await navigator.clipboard.writeText(url);
    showToast("share-toast", "링크가 복사되었습니다.", 2000);
  } catch (e) {
    if (linkInput) linkInput.select();
    showToast("share-toast", "링크를 직접 선택해 복사해주세요.", 2000);
  }
}

// ------------------------------------------------------------
// 카드 이미지로 공유 — 링크 복사와는 별개 옵션(2026-08-17, 초창기에
// 있다가 322ae82에서 카카오톡 SDK 개편 때 함께 빠졌던 인스타 스토리용
// 9:16 카드 이미지를 되살림). 모바일에서 파일 첨부를 지원하는
// navigator.share가 있으면 OS 공유 시트로 이미지를 바로 첨부해서
// 넘기고, 없으면(대부분의 PC 브라우저) 이미지를 다운로드한다.
// ------------------------------------------------------------
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

// 두 공유 카드(개별 기억/장소)가 공유하는 배경판 + 브랜드 마크.
function drawShareCardBase(ctx, canvas) {
  ctx.fillStyle = "#2F3031";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "#FF5A36";
  ctx.beginPath();
  ctx.arc(96, 140, 12, 0, Math.PI * 2);
  ctx.fill();
}

// 두 공유 카드가 공유하는 하단 브랜드 푸터 — footerY 기준선을 돌려줘서
// 호출부가 그 위에 CTA 문구를 올릴 수 있게 한다.
function drawShareCardBrandFooter(ctx, canvas, marginX) {
  const footerY = canvas.height - 200;
  ctx.font = "700 30px sans-serif";
  ctx.fillStyle = "#FF5A36";
  ctx.fillText("CONCRETE SAPIENS", marginX, footerY + 120);
  ctx.font = "400 24px sans-serif";
  ctx.fillStyle = "#B9B9B5";
  ctx.fillText("MEMORY MAP", marginX, footerY + 150);
  return footerY;
}

// 인스타그램 스토리에 그대로 채워지는 9:16 세로 카드. 연도·장소·인용구는
// 콘텐츠 길이에 따라 세로 위치가 밀리고, CTA/로고는 항상 하단에 고정한다.
function generateShareCard(story) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");

  drawShareCardBase(ctx, canvas);

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

  drawShareCardBrandFooter(ctx, canvas, marginX);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

// 장소(스팟) 단위 공유 카드 — 개별 기억 인용구는 작성자 동의 없이 노출하지
// 않는 원칙이라(2026-08-18), 큰 숫자(개수)와 연도 범위만 보여준다.
function generatePlaceShareCard(group) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");

  drawShareCardBase(ctx, canvas);

  const title = Storage.getGroupTitle(group);
  const addressCaption = Storage.getGroupAddressCaption(group);
  const distinctYears = [...new Set(group.stories.map((s) => Storage.getStoryYear(s)).filter((y) => y !== null))].sort((a, b) => a - b);
  const yearRangeLabel = distinctYears.length === 0
    ? null
    : distinctYears.length === 1
      ? `${distinctYears[0]}년의 기록`
      : `${distinctYears[0]} – ${distinctYears[distinctYears.length - 1]}년의 기록`;

  const marginX = 96;
  const maxWidth = canvas.width - marginX * 2;
  let cursorY = 340;

  ctx.fillStyle = "#FF5A36";
  ctx.font = "700 168px sans-serif";
  ctx.fillText(String(group.stories.length), marginX, cursorY);
  cursorY += 84;

  ctx.font = "700 44px sans-serif";
  ctx.fillStyle = "#F4F3EF";
  ctx.fillText("개의 기억이 쌓여 있습니다", marginX, cursorY);
  cursorY += 92;

  ctx.font = "700 56px sans-serif";
  ctx.fillStyle = "#F4F3EF";
  const titleLines = wrapCanvasText(ctx, title, maxWidth).slice(0, 2);
  titleLines.forEach((line, i) => ctx.fillText(line, marginX, cursorY + i * 68));
  cursorY += titleLines.length * 68 + 8;

  if (addressCaption) {
    ctx.font = "400 30px sans-serif";
    ctx.fillStyle = "#B9B9B5";
    const addrLines = wrapCanvasText(ctx, addressCaption, maxWidth).slice(0, 2);
    addrLines.forEach((line, i) => ctx.fillText(line, marginX, cursorY + i * 40));
    cursorY += addrLines.length * 40;
  }
  cursorY += 60;

  if (yearRangeLabel) {
    ctx.font = "400 44px serif";
    ctx.fillStyle = "#F4F3EF";
    ctx.fillText(yearRangeLabel, marginX, cursorY);
  }

  const footerY = canvas.height - 200;
  ctx.font = "700 38px sans-serif";
  ctx.fillStyle = "#F4F3EF";
  ctx.fillText("이 장소의 기억들을 지도에서", marginX, footerY);
  ctx.fillText("열어보세요 →", marginX, footerY + 52);

  drawShareCardBrandFooter(ctx, canvas, marginX);

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

async function shareStoryCard(storyId) {
  const story = Storage.getAllStories().find((s) => s.id === storyId);
  if (!story) return;

  const btn = document.querySelector(`.share-card-btn[data-id="${storyId}"]`);
  if (btn) btn.disabled = true;

  let blob;
  try {
    blob = await generateShareCard(story);
  } catch (e) {
    showToast("share-toast", "카드 이미지를 만들지 못했어요.", 2000);
    if (btn) btn.disabled = false;
    return;
  }
  if (btn) btn.disabled = false;
  if (!blob) return;

  const url = buildStoryUrl(story.publicId);
  const title = Storage.getGroupTitle({
    placeId: story.placeId,
    officialPlaceName: story.officialPlaceName,
    customName: story.customName,
    address: story.address,
  });
  const year = Storage.getStoryYear(story);
  const shareText = `여기 이런 기억이 남아 있었어.\n${title}${year ? " · " + year : ""}`;
  const file = new File([blob], "concrete-sapiens-memory.png", { type: "image/png" });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ title: "콘크리트 사피엔스 지도", text: shareText, url, files: [file] });
      Storage.incrementShareCount(storyId);
      Storage.markShared(storyId);
      return;
    } catch (e) {
      // 공유 시트를 취소했거나 실패 — 아래 다운로드로 넘어가지 않고 그냥 종료
      return;
    }
  }

  // navigator.share(파일 첨부)를 지원하지 않는 환경(대부분의 PC 브라우저)
  // — 이미지를 바로 다운로드해준다.
  const imgUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = imgUrl;
  a.download = "concrete-sapiens-memory.png";
  a.click();
  URL.revokeObjectURL(imgUrl);
  showToast("share-toast", "카드 이미지가 다운로드되었습니다.", 2000);
  Storage.incrementShareCount(storyId);
  Storage.markShared(storyId);
}

async function sharePlaceCard(group) {
  const btn = document.getElementById("spot-share-card-btn");
  if (btn) btn.disabled = true;

  let blob;
  try {
    blob = await generatePlaceShareCard(group);
  } catch (e) {
    showToast("share-toast", "카드 이미지를 만들지 못했어요.", 2000);
    if (btn) btn.disabled = false;
    return;
  }
  if (btn) btn.disabled = false;
  if (!blob) return;

  const url = buildPlaceUrl(group.key);
  const title = Storage.getGroupTitle(group);
  const shareText = `여기 ${group.stories.length}개의 기억이 쌓여 있어.\n${title}`;
  const file = new File([blob], "concrete-sapiens-place.png", { type: "image/png" });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ title: "콘크리트 사피엔스 지도", text: shareText, url, files: [file] });
      return;
    } catch (e) {
      // 공유 시트를 취소했거나 실패 — 아래 다운로드로 넘어가지 않고 그냥 종료
      return;
    }
  }

  // navigator.share(파일 첨부)를 지원하지 않는 환경(대부분의 PC 브라우저)
  // — 이미지를 바로 다운로드해준다.
  const imgUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = imgUrl;
  a.download = "concrete-sapiens-place.png";
  a.click();
  URL.revokeObjectURL(imgUrl);
  showToast("share-toast", "카드 이미지가 다운로드되었습니다.", 2000);
}
