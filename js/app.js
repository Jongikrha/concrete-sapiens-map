// ============================================================
// 콘크리트 사피엔스 지도 - 메인 앱 로직
// ============================================================

let map;
let clusterer;
let placesService;
let markers = [];
let activeHashtagFilter = null;
let pendingPin = null; // 새 이야기를 작성 중인 좌표/장소 정보

function initApp() {
  Storage.seedIfEmpty();
  initMap();
  bindUIEvents();
  renderHashtagChips();
  renderMarkers();
}

// ------------------------------------------------------------
// 지도 초기화
// ------------------------------------------------------------
function initMap() {
  const container = document.getElementById("map");
  const options = {
    center: new kakao.maps.LatLng(
      CONFIG.DEFAULT_CENTER.lat,
      CONFIG.DEFAULT_CENTER.lng
    ),
    level: CONFIG.DEFAULT_LEVEL,
  };
  map = new kakao.maps.Map(container, options);

  clusterer = new kakao.maps.MarkerClusterer({
    map,
    averageCenter: true,
    minLevel: 8,
    disableClickZoom: false,
  });

  placesService = new kakao.maps.services.Places();

  // 지도 클릭 시 자유 핀 작성 플로우 시작
  kakao.maps.event.addListener(map, "click", (mouseEvent) => {
    const latlng = mouseEvent.latLng;
    openComposer({
      lat: latlng.getLat(),
      lng: latlng.getLng(),
      placeName: null,
      placeId: null,
      isFreePin: true,
    });
  });
}

// ------------------------------------------------------------
// 마커 렌더링 (스팟 단위로 그룹핑)
// ------------------------------------------------------------
function renderMarkers() {
  clusterer.clear();
  markers.forEach((m) => kakao.maps.event.removeListener(m, "click"));
  markers = [];

  let groups = Storage.getGroupedByPlace();

  if (activeHashtagFilter) {
    groups = groups
      .map((g) => ({
        ...g,
        stories: g.stories.filter((s) =>
          s.hashtags.includes(activeHashtagFilter)
        ),
      }))
      .filter((g) => g.stories.length > 0);
  }

  groups.forEach((group) => {
    const marker = new kakao.maps.Marker({
      position: new kakao.maps.LatLng(group.lat, group.lng),
      title: group.placeName,
    });
    kakao.maps.event.addListener(marker, "click", () => {
      openStoryListPopup(group);
    });
    markers.push(marker);
  });

  clusterer.addMarkers(markers);
}

// ------------------------------------------------------------
// 해시태그 칩 렌더링 (전체 이야기에서 많이 쓰인 순 상위 30개)
// ------------------------------------------------------------
function renderHashtagChips() {
  const wrap = document.getElementById("hashtag-chips");
  wrap.innerHTML = "";

  if (activeHashtagFilter) {
    const clearChip = document.createElement("button");
    clearChip.className = "chip chip--active";
    clearChip.textContent = `${activeHashtagFilter} ✕`;
    clearChip.onclick = () => {
      activeHashtagFilter = null;
      renderHashtagChips();
      renderMarkers();
    };
    wrap.appendChild(clearChip);
    return;
  }

  const topTags = Storage.getTopHashtags(CONFIG.TOP_HASHTAG_LIMIT);

  if (topTags.length === 0) return;

  topTags.forEach((tag) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = tag;
    chip.onclick = () => {
      activeHashtagFilter = tag;
      renderHashtagChips();
      renderMarkers();
    };
    wrap.appendChild(chip);
  });
}

// ------------------------------------------------------------
// 이야기 리스트 팝업 (한 스팟에 여러 이야기)
// ------------------------------------------------------------
let currentSort = "latest"; // "latest" | "timetravel"
const expandedComments = new Set(); // 댓글 펼침 상태 (story.id 목록)

function openStoryListPopup(group) {
  currentSort = "latest";
  renderStoryListPopup(group);
  document.getElementById("popup-overlay").classList.remove("hidden");
}

function renderStoryListPopup(group) {
  const panel = document.getElementById("popup-panel");

  const sorted = [...group.stories].sort((a, b) => {
    if (currentSort === "latest") {
      return new Date(b.createdAt) - new Date(a.createdAt);
    }
    // timetravel: referenceDate 있는 것 오래된 순, 없는 것은 뒤로
    const da = a.referenceDate ? new Date(a.referenceDate) : new Date(8640000000000000);
    const db = b.referenceDate ? new Date(b.referenceDate) : new Date(8640000000000000);
    return da - db;
  });

  panel.innerHTML = `
    <div class="plaque-header">
      <div class="plaque-eyebrow">SPOT · ${sorted.length}개의 기록</div>
      <h2 class="plaque-title">${escapeHtml(group.placeName || "이름 없는 곳")}</h2>
      <div class="sort-toggle">
        <button class="sort-btn ${currentSort === "latest" ? "sort-btn--active" : ""}" data-sort="latest">최신순</button>
        <button class="sort-btn ${currentSort === "timetravel" ? "sort-btn--active" : ""}" data-sort="timetravel">시간여행순</button>
      </div>
    </div>
    <div class="story-list">
      ${sorted.map(renderStoryItem).join("")}
    </div>
    <button class="btn-primary btn-add-story" id="btn-add-story">+ 나도 이야기 남기기</button>
  `;

  panel.querySelectorAll(".sort-btn").forEach((btn) => {
    btn.onclick = () => {
      currentSort = btn.dataset.sort;
      renderStoryListPopup(group);
    };
  });

  panel.querySelectorAll(".report-btn").forEach((btn) => {
    btn.onclick = () => {
      if (confirm("이 기록을 신고하시겠습니까?")) {
        Storage.reportStory(btn.dataset.id);
        alert("신고가 접수되었습니다.");
        const refreshed = Storage.getGroupedByPlace().find((g) => g.key === group.key);
        if (refreshed) renderStoryListPopup(refreshed);
        renderMarkers();
      }
    };
  });

  panel.querySelectorAll(".hashtag-link").forEach((link) => {
    link.onclick = () => {
      activeHashtagFilter = link.dataset.tag;
      closePopup();
      renderHashtagChips();
      renderMarkers();
    };
  });

  panel.querySelectorAll(".like-btn").forEach((btn) => {
    btn.onclick = () => {
      Storage.toggleLike(btn.dataset.id);
      const refreshed = Storage.getGroupedByPlace().find((g) => g.key === group.key);
      if (refreshed) renderStoryListPopup(refreshed);
      renderMarkers();
    };
  });

  panel.querySelectorAll(".comment-toggle-btn").forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      if (expandedComments.has(id)) {
        expandedComments.delete(id);
      } else {
        expandedComments.add(id);
      }
      renderStoryListPopup(group);
    };
  });

  panel.querySelectorAll(".comment-submit-btn").forEach((btn) => {
    btn.onclick = () => {
      const storyId = btn.dataset.id;
      const input = panel.querySelector(`.comment-input[data-id="${storyId}"]`);
      const authorInput = panel.querySelector(`.comment-author[data-id="${storyId}"]`);
      const content = input.value.trim();
      if (!content) return;
      Storage.addComment(storyId, {
        authorName: authorInput.value.trim() || "익명",
        content,
      });
      const refreshed = Storage.getGroupedByPlace().find((g) => g.key === group.key);
      if (refreshed) renderStoryListPopup(refreshed);
    };
  });

  document.getElementById("btn-add-story").onclick = () => {
    closePopup();
    openComposer({
      lat: group.lat,
      lng: group.lng,
      placeName: group.placeName,
      placeId: group.stories[0]?.placeId || null,
      isFreePin: !group.stories[0]?.placeId,
    });
  };
}

function renderStoryItem(story) {
  const dateLabel = formatDateLabel(story);
  const tagsHtml = story.hashtags
    .map((t) => `<button class="hashtag-link" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`)
    .join(" ");

  const likes = story.likes || 0;
  const liked = Storage.isLikedByMe(story.id);
  const comments = story.comments || [];
  const isExpanded = expandedComments.has(story.id);

  const commentsHtml = isExpanded
    ? `
      <div class="comment-section">
        ${comments
          .map(
            (c) => `
          <div class="comment-item">
            <span class="comment-author">${escapeHtml(c.authorName)}</span>
            <span class="comment-content">${escapeHtml(c.content)}</span>
          </div>
        `
          )
          .join("") || `<p class="comment-empty">아직 댓글이 없어요. 첫 댓글을 남겨보세요.</p>`}
        <div class="comment-form">
          <input type="text" class="comment-author input-field" data-id="${story.id}" placeholder="이름 (선택)" maxlength="20" />
          <input type="text" class="comment-input input-field" data-id="${story.id}" placeholder="댓글을 남겨보세요" maxlength="100" />
          <button class="comment-submit-btn" data-id="${story.id}">등록</button>
        </div>
      </div>
    `
    : "";

  return `
    <div class="story-item">
      <p class="story-content">${escapeHtml(story.content)}</p>
      <div class="story-meta">
        <span class="story-tags">${tagsHtml}</span>
        <span class="story-date">${dateLabel}</span>
      </div>
      <div class="story-footer">
        <span class="story-author">${escapeHtml(story.authorName || "익명")}</span>
        <div class="story-actions">
          <button class="like-btn ${liked ? "like-btn--active" : ""}" data-id="${story.id}">
            ${liked ? "♥" : "♡"} ${likes}
          </button>
          <button class="comment-toggle-btn" data-id="${story.id}">💬 ${comments.length}</button>
          <button class="report-btn" data-id="${story.id}">신고</button>
        </div>
      </div>
      ${commentsHtml}
    </div>
  `;
}

function formatDateLabel(story) {
  if (story.dateMode === "past" && story.referenceDate) {
    return `${story.referenceDate} 회상`;
  }
  if (story.dateMode === "now") {
    return `${formatKoreanDate(story.createdAt)} 작성`;
  }
  return `${relativeTime(story.createdAt)}`;
}

function closePopup() {
  document.getElementById("popup-overlay").classList.add("hidden");
}

// ------------------------------------------------------------
// 작성 화면 (Composer)
// ------------------------------------------------------------
function openComposer(pin) {
  pendingPin = pin;
  const panel = document.getElementById("composer-panel");

  panel.innerHTML = `
    <div class="plaque-header">
      <div class="plaque-eyebrow">NEW RECORD</div>
      <h2 class="plaque-title">${escapeHtml(pin.placeName || "이름 없는 장소")}</h2>
    </div>

    <label class="field-label">작성자</label>
    <input type="text" id="input-author" class="input-field" placeholder="실명, 자유 아이디, 또는 비워두면 익명" maxlength="30" />

    <label class="field-label">기록 (해시태그는 본문 안에 #이렇게 작성하세요)</label>
    <textarea id="input-content" class="input-field textarea" maxlength="${CONFIG.MAX_CONTENT_LENGTH}" placeholder="이 장소에 얽힌 기억을 남겨보세요..."></textarea>
    <div class="char-count"><span id="char-count-num">0</span> / ${CONFIG.MAX_CONTENT_LENGTH}</div>

    <label class="field-label">시점</label>
    <div class="date-mode-toggle">
      <button class="mode-btn mode-btn--active" data-mode="none">미지정</button>
      <button class="mode-btn" data-mode="now">지금</button>
      <button class="mode-btn" data-mode="past">과거 회상</button>
    </div>
    <input type="date" id="input-refdate" class="input-field hidden" max="${todayStr()}" />

    <button class="btn-primary btn-submit" id="btn-submit">게시하기</button>
    <button class="btn-secondary" id="btn-cancel">취소</button>
  `;

  let dateMode = "none";

  panel.querySelector("#input-content").addEventListener("input", (e) => {
    document.getElementById("char-count-num").textContent = e.target.value.length;
  });

  panel.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.onclick = () => {
      dateMode = btn.dataset.mode;
      panel.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("mode-btn--active"));
      btn.classList.add("mode-btn--active");
      const dateInput = document.getElementById("input-refdate");
      if (dateMode === "past") {
        dateInput.classList.remove("hidden");
      } else {
        dateInput.classList.add("hidden");
      }
    };
  });

  document.getElementById("btn-cancel").onclick = closeComposer;

  document.getElementById("btn-submit").onclick = () => {
    const content = document.getElementById("input-content").value.trim();
    const authorInput = document.getElementById("input-author").value.trim();
    const refDateInput = document.getElementById("input-refdate").value;

    if (!content) {
      alert("기록 내용을 입력해주세요.");
      return;
    }
    if (dateMode === "past" && !refDateInput) {
      alert("회상할 날짜를 선택해주세요.");
      return;
    }

    const story = {
      id: crypto.randomUUID(),
      lat: pendingPin.lat,
      lng: pendingPin.lng,
      placeName: pendingPin.placeName || "이름 없는 곳",
      placeId: pendingPin.placeId,
      content,
      hashtags: extractHashtags(content),
      authorName: authorInput || "익명",
      dateMode,
      referenceDate: dateMode === "past" ? refDateInput : null,
      createdAt: new Date().toISOString(),
      reportCount: 0,
      isHidden: false,
      likes: 0,
      comments: [],
    };

    Storage.saveStory(story);
    closeComposer();
    renderMarkers();
    map.setCenter(new kakao.maps.LatLng(story.lat, story.lng));

    const group = Storage.getGroupedByPlace().find(
      (g) => g.lat === story.lat && g.lng === story.lng
    );
    if (group) openStoryListPopup(group);
  };

  document.getElementById("composer-overlay").classList.remove("hidden");
}

function closeComposer() {
  document.getElementById("composer-overlay").classList.add("hidden");
  pendingPin = null;
}

function extractHashtags(text) {
  const matches = text.match(/#[^\s#]+/g);
  return matches ? [...new Set(matches)] : [];
}

// ------------------------------------------------------------
// 상단 검색 (카카오 장소 검색)
// ------------------------------------------------------------
function bindUIEvents() {
  document.getElementById("popup-close").onclick = closePopup;
  document.getElementById("composer-close").onclick = closeComposer;

  document.getElementById("btn-my-location").onclick = goToMyLocation;
  document.getElementById("btn-random").onclick = goToRandomStory;

  const searchInput = document.getElementById("search-input");
  const searchResults = document.getElementById("search-results");

  document.getElementById("search-btn").onclick = () => runSearch();
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch();
  });

  function runSearch() {
    const keyword = searchInput.value.trim();
    if (!keyword) return;

    placesService.keywordSearch(keyword, (data, status) => {
      if (status !== kakao.maps.services.Status.OK) {
        searchResults.innerHTML = `<li class="search-empty">검색 결과가 없습니다.</li>`;
        searchResults.classList.remove("hidden");
        return;
      }

      searchResults.innerHTML = data
        .slice(0, 6)
        .map(
          (place) => `
        <li class="search-result-item" data-lat="${place.y}" data-lng="${place.x}" data-name="${escapeHtml(place.place_name)}" data-id="${place.id}">
          <strong>${escapeHtml(place.place_name)}</strong>
          <span>${escapeHtml(place.road_address_name || place.address_name)}</span>
        </li>
      `
        )
        .join("");
      searchResults.classList.remove("hidden");

      searchResults.querySelectorAll(".search-result-item").forEach((item) => {
        item.onclick = () => {
          const lat = parseFloat(item.dataset.lat);
          const lng = parseFloat(item.dataset.lng);
          map.setCenter(new kakao.maps.LatLng(lat, lng));
          map.setLevel(4);
          searchResults.classList.add("hidden");
          searchInput.value = "";

          openComposer({
            lat,
            lng,
            placeName: item.dataset.name,
            placeId: item.dataset.id,
            isFreePin: false,
          });
        };
      });
    });
  }
}

function goToMyLocation() {
  if (!navigator.geolocation) {
    alert("이 브라우저에서는 위치 정보를 사용할 수 없습니다.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      map.setCenter(new kakao.maps.LatLng(latitude, longitude));
      map.setLevel(6);
    },
    () => alert("위치 정보를 가져올 수 없습니다. 위치 권한을 확인해주세요.")
  );
}

function goToRandomStory() {
  const stories = Storage.getVisibleStories();
  if (stories.length === 0) {
    alert("아직 등록된 기록이 없습니다.");
    return;
  }
  const random = stories[Math.floor(Math.random() * stories.length)];
  map.setLevel(5);
  map.panTo(new kakao.maps.LatLng(random.lat, random.lng));
}

// ------------------------------------------------------------
// 유틸
// ------------------------------------------------------------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function formatKoreanDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

function relativeTime(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}일 전`;
}

window.addEventListener("DOMContentLoaded", () => {
  if (
    !CONFIG.KAKAO_APP_KEY ||
    CONFIG.KAKAO_APP_KEY === "YOUR_KAKAO_JAVASCRIPT_KEY_HERE"
  ) {
    document.getElementById("key-warning").classList.remove("hidden");
    return;
  }
  kakao.maps.load(initApp);
});
