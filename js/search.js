// ============================================================
// 상단 검색 (카카오 장소 검색)
// ============================================================

// 검색 결과를 고르면 켜진다 — map.js renderMarkers()가 이 반경 안 마커를
// "내 기억" 모드와 같은 방식으로 밝히고, 모달로 이 동네 기억 개수/연대별
// 분포를 보여준다. "오늘의 질문"에 답하려고 장소를 고르는 경우
// (pendingDailyPrompt가 있을 때)는 이 흐름을 타지 않고 기존처럼 바로
// 작성폼을 연다 — 그때는 동네를 둘러보러 온 게 아니라 정해진 질문에
// 답할 장소를 고르는 것이기 때문이다.
let searchAreaActive = false;
let searchAreaCenter = null;
// 모달 재계산/CTA에 쓰려고 마지막으로 고른 장소 정보를 따로 들고 있는다
// (searchAreaCenter는 map.js가 매 렌더마다 읽는 거리 계산용 최소 정보라
// place 메타데이터까지 얹지 않았다).
let searchAreaPlace = null;

// 명시적으로 "닫기(✕)"를 눌렀을 때만 완전히 끈다 — "다른 기억 둘러보기"/
// "내 기억으로 남기기"로 이어지는 동안은 지도의 불빛을 계속 유지해서,
// 나중에 지도로 돌아왔을 때도 방금 본 동네가 계속 밝혀져 있게 한다.
function clearSearchArea() {
  if (!searchAreaActive) return;
  searchAreaActive = false;
  searchAreaCenter = null;
  searchAreaPlace = null;
  renderMarkers();
  renderMemoryArchiveEntry();
}

function buildSearchAreaQuote(placeName, stories) {
  const count = stories.length;
  if (count === 0) {
    return `"${placeName} 인근에는 아직 남겨진 기억이 없습니다."`;
  }
  const years = stories.map((s) => Storage.getStoryYear(s)).filter((y) => y !== null);
  if (years.length === 0) {
    return `"${placeName} 인근에는 ${count.toLocaleString()}개의 기억이 있습니다."`;
  }
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  if (minYear === maxYear) {
    return `"${placeName} 인근에는 ${minYear}년, ${count.toLocaleString()}개의 기억이 있습니다."`;
  }
  return `"${placeName} 인근에는 ${minYear}년부터 ${maxYear}년까지 ${count.toLocaleString()}개의 기억이 있습니다."`;
}

// 연대(1990s/2000s...)별 개수를 모으고, 이 장소 안에서 가장 기억이 많이
// 몰린 연대를 5점 만점으로 잡아 나머지를 상대 비율로 환산한다(그 장소
// 안에서의 상대적 비중 — 절대 개수 기준 고정 구간이면 기억이 적은 동네는
// 항상 별이 거의 안 채워져 보이는 문제가 있어 이 방식을 택함).
function buildSearchAreaDecadeBreakdown(stories) {
  const counts = {};
  stories.forEach((s) => {
    const year = Storage.getStoryYear(s);
    if (year === null) return;
    const decade = Math.floor(year / 10) * 10;
    counts[decade] = (counts[decade] || 0) + 1;
  });
  const decades = Object.keys(counts).map(Number).sort((a, b) => a - b);
  const maxCount = decades.reduce((max, d) => Math.max(max, counts[d]), 0);
  return decades.map((decade) => ({
    label: `${decade}s`,
    count: counts[decade],
    // 상대 비율로 별을 매기되, 실제 기억 개수보다 별이 많아 보이면 안 되니
    // 개수로 상한을 건다(예: 이 연대에 3개뿐인데 비율상 5개로 반올림되는 걸 방지).
    stars: maxCount > 0 ? Math.min(counts[decade], Math.max(1, Math.round((counts[decade] / maxCount) * 5))) : 0,
  }));
}

/**
 * 모달 DOM을 그린다 — 검색 결과를 처음 고를 때(openSearchAreaModal)와,
 * 그 자리에서 기억을 남긴 직후(composer.js submitStory 성공 콜백) 개수가
 * 바뀐 걸 반영할 때 둘 다에서 쓴다. 모달이 닫혀 있어도(예: 작성폼으로
 * 넘어간 뒤) 호출될 수 있어 매번 최신 상태로 다시 그린다.
 */
function renderSearchAreaModal() {
  if (!searchAreaPlace) return;
  const { lat, lng, placeName, placeId, address } = searchAreaPlace;
  const stories = Storage.getStoriesNear(lat, lng, CONFIG.SEARCH_AREA_RADIUS_METERS);
  const decades = buildSearchAreaDecadeBreakdown(stories);

  const decadeListHtml = decades.length
    ? decades.map((d) => `
        <div class="search-area-decade-row">
          <span class="search-area-decade-label">${d.label}</span>
          <span class="search-area-decade-stars">${"★".repeat(d.stars)}</span>
          <span class="search-area-decade-count">${d.count.toLocaleString()}개의 기억</span>
        </div>
      `).join("")
    : `<p class="search-area-stats-empty">아직 연도가 기록된 기억이 없어요.</p>`;

  const hint = stories.length === 0
    ? "가장 먼저 이곳의 기억을 남겨보세요."
    : "이 동네의 다른 기억을 둘러보거나, 당신의 기억을 더해보세요.";

  const panel = document.getElementById("search-area-panel");
  panel.innerHTML = `
    <div class="search-area-body">
      <div class="search-area-quote-col">
        <p class="search-area-quote">${escapeHtml(buildSearchAreaQuote(placeName, stories))}</p>
        <p class="search-area-quote-hint">${escapeHtml(hint)}</p>
      </div>
      <div class="search-area-stats-col">
        <p class="search-area-place-name">📍 ${escapeHtml(placeName)}</p>
        ${decadeListHtml}
      </div>
    </div>
    <div class="search-area-actions">
      ${stories.length > 0 ? `
        <button class="search-area-action" id="search-area-browse">
          <span class="search-area-action-icon">🔍</span>
          <span>
            <span class="search-area-action-title">다른 기억 둘러보기</span>
            <span class="search-area-action-hint">이 장소의 다양한 기억을 만나보세요.</span>
          </span>
        </button>
      ` : ""}
      <button class="search-area-action search-area-action--primary" id="search-area-write">
        <span class="search-area-action-icon">✏️</span>
        <span>
          <span class="search-area-action-title">내 기억으로 남기기</span>
          <span class="search-area-action-hint">당신의 기억을 지도에 남겨주세요.</span>
        </span>
      </button>
    </div>
  `;

  const browseBtn = document.getElementById("search-area-browse");
  if (browseBtn) browseBtn.onclick = () => openNearbyMemoriesModal();

  document.getElementById("search-area-write").onclick = () => {
    document.getElementById("search-area-overlay").classList.add("hidden");
    requireLogin(() => openComposer({
      lat, lng,
      officialPlaceName: placeName,
      placeId,
      address: address || null,
      isFreePin: false,
    }));
  };
}

function openSearchAreaModal({ lat, lng, placeName, placeId, address }) {
  searchAreaActive = true;
  searchAreaCenter = { lat, lng };
  searchAreaPlace = { lat, lng, placeName, placeId, address };
  renderMarkers();
  renderMemoryArchiveEntry();
  renderSearchAreaModal();
  document.getElementById("search-area-overlay").classList.remove("hidden");
  document.getElementById("search-area-panel").scrollTop = 0;
}

// "✕"로 명시적으로 닫을 때만 지도 불빛까지 끈다(clearSearchArea 주석 참고).
function closeSearchAreaModal() {
  document.getElementById("search-area-overlay").classList.add("hidden");
  clearSearchArea();
}

// ------------------------------------------------------------
// "다른 기억 둘러보기" — 검색 반경 안 기억 목록. "지금까지 쌓인 기억"
// (app.js openRecentMemoriesModal)과 같은 리스트 UI/CSS를 재사용하되
// 검색 반경으로만 걸러서 보여준다.
// ------------------------------------------------------------
function openNearbyMemoriesModal(opts = {}) {
  if (!searchAreaPlace) return;
  const { lat, lng, placeName } = searchAreaPlace;
  document.getElementById("search-area-overlay").classList.add("hidden");

  const panel = document.getElementById("search-nearby-panel");
  const stories = Storage.getStoriesNear(lat, lng, CONFIG.SEARCH_AREA_RADIUS_METERS);
  const listHtml = stories.length
    ? buildSortedListHtml(stories, "timetravel-reverse", renderRecentListItem, { cap: 50 })
    : `<p class="recent-empty">아직 등록된 기억이 없습니다.</p>`;

  panel.innerHTML = `
    <div class="recent-header">
      <h2 class="composer-title" style="margin:0;">${escapeHtml(placeName)} 인근의 기억</h2>
      <button class="recent-close" id="search-nearby-close">✕</button>
    </div>
    ${listHtml}
  `;

  panel.querySelector("#search-nearby-close").onclick = closeNearbyMemoriesModal;

  panel.querySelectorAll(".recent-item[data-id]").forEach((item) => {
    item.onclick = () => {
      const scrollTop = panel.scrollTop;
      closeNearbyMemoriesModal();
      navigateToStoryFromList(item.dataset.id, {
        kind: "searchNearby",
        scrollTop,
        label: `${placeName} 인근의 기억`,
      });
    };
  });

  document.getElementById("search-nearby-overlay").classList.remove("hidden");
  panel.scrollTop = opts.scrollTop || 0;
}

function closeNearbyMemoriesModal() {
  document.getElementById("search-nearby-overlay").classList.add("hidden");
}

function bindSearchEvents() {
  const searchInput = document.getElementById("search-input");
  const searchResults = document.getElementById("search-results");

  // 전용 닫기 버튼이 없으니 카드 바깥(오버레이 자신)을 클릭하면 닫는다.
  bindOverlayClickToClose("search-area-overlay", closeSearchAreaModal);

  document.getElementById("search-btn").onclick = () => runSearch();
  searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(); });

  function runSearch() {
    const keyword = searchInput.value.trim();
    if (!keyword) return;

    placesService.keywordSearch(keyword, (data, status) => {
      if (status !== kakao.maps.services.Status.OK) {
        searchResults.innerHTML = `<li class="search-empty">검색 결과가 없습니다.</li>`;
        searchResults.classList.remove("hidden");
        return;
      }

      searchResults.innerHTML = data.slice(0, 6).map((place) => {
        const rawAddress = place.road_address_name || place.address_name || "";
        return `
        <li class="search-result-item" data-lat="${place.y}" data-lng="${place.x}" data-name="${escapeHtml(place.place_name)}" data-id="${place.id}" data-address="${escapeHtml(rawAddress)}">
          <strong>${escapeHtml(place.place_name)}</strong>
          <span>${escapeHtml(Storage.abbreviateAddress(rawAddress))}</span>
        </li>
      `;
      }).join("");
      searchResults.classList.remove("hidden");

      searchResults.querySelectorAll(".search-result-item").forEach((item) => {
        item.onclick = () => {
          const lat = parseFloat(item.dataset.lat);
          const lng = parseFloat(item.dataset.lng);
          const placeName = item.dataset.name;
          const placeId = item.dataset.id;
          const address = item.dataset.address || null;
          map.setCenter(new kakao.maps.LatLng(lat, lng));
          map.setLevel(4);
          searchResults.classList.add("hidden");
          searchInput.value = "";

          const promptPrefill = consumePendingDailyPrompt();
          if (promptPrefill) {
            requireLogin(() => openComposer({
              lat, lng,
              officialPlaceName: placeName,
              placeId,
              address,
              isFreePin: false,
              prefillContent: promptPrefill,
            }));
            return;
          }

          const areaInfo = { lat, lng, placeName, placeId, address };
          showSearchPin(lat, lng, areaInfo);
          openSearchAreaModal(areaInfo);
        };
      });
    });
  }
}
