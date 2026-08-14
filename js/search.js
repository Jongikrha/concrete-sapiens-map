// ============================================================
// 상단 검색 (카카오 장소 검색)
// ============================================================

// 검색 결과를 고르면 켜진다 — map.js renderMarkers()가 이 반경 안 마커를
// "내 기억" 모드와 같은 방식으로 밝히고, 배너에 이 동네 기억 개수/연도범위를
// 보여준다. "오늘의 질문"에 답하려고 장소를 고르는 경우(pendingDailyPrompt가
// 있을 때)는 이 흐름을 타지 않고 기존처럼 바로 작성폼을 연다 — 그때는 동네를
// 둘러보러 온 게 아니라 정해진 질문에 답할 장소를 고르는 것이기 때문이다.
let searchAreaActive = false;
let searchAreaCenter = null;
// 배너 CTA/재계산에 쓰려고 마지막으로 고른 장소 정보를 따로 들고 있는다
// (searchAreaCenter는 map.js가 매 렌더마다 읽는 거리 계산용 최소 정보라
// place 메타데이터까지 얹지 않았다).
let searchAreaPlace = null;

function clearSearchArea() {
  if (!searchAreaActive) return;
  searchAreaActive = false;
  searchAreaCenter = null;
  searchAreaPlace = null;
  document.getElementById("search-area-banner").classList.add("hidden");
  renderMarkers();
  renderTotalCountBanner();
}

function buildSearchAreaBannerText(placeName, stories) {
  const count = stories.length;
  if (count === 0) {
    return `${placeName} 인근에는 아직 남겨진 기억이 없어요. 첫 기억을 남겨보세요.`;
  }
  const years = stories.map((s) => Storage.getStoryYear(s)).filter((y) => y !== null);
  if (years.length === 0) {
    return `${placeName} 근처에 ${count.toLocaleString()}개의 기억이 남아 있습니다.`;
  }
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  if (minYear === maxYear) {
    return `${placeName} 인근에는 ${minYear}년, ${count.toLocaleString()}개의 기억이 남아 있습니다.`;
  }
  return `${placeName} 인근에는 ${minYear}년부터 ${maxYear}년까지 ${count.toLocaleString()}개의 기억이 남아 있습니다.`;
}

/**
 * 배너 DOM만 다시 그린다(마커는 건드리지 않음) — 검색 결과를 처음
 * 고를 때(showSearchArea)와, 그 자리에서 기억을 남긴 직후(composer.js
 * submitStory 성공 콜백) 개수가 바뀐 걸 반영할 때 둘 다에서 쓴다.
 */
function renderSearchAreaBanner() {
  if (!searchAreaActive || !searchAreaPlace) return;
  const { lat, lng, placeName, placeId, address } = searchAreaPlace;

  const stories = Storage.getStoriesNear(lat, lng, CONFIG.SEARCH_AREA_RADIUS_METERS);
  const banner = document.getElementById("search-area-banner");
  banner.innerHTML = `
    <span>${escapeHtml(buildSearchAreaBannerText(placeName, stories))}</span>
    <div class="search-area-banner-actions">
      <button class="search-area-cta" id="search-area-cta">기억 남기기</button>
      <button class="filter-banner-clear" id="search-area-close">✕</button>
    </div>
  `;
  banner.classList.remove("hidden");

  document.getElementById("search-area-cta").onclick = () => {
    requireLogin(() => openComposer({
      lat, lng,
      officialPlaceName: placeName,
      placeId,
      address: address || null,
      isFreePin: false,
    }));
  };
  document.getElementById("search-area-close").onclick = clearSearchArea;
}

function showSearchArea({ lat, lng, placeName, placeId, address }) {
  searchAreaActive = true;
  searchAreaCenter = { lat, lng };
  searchAreaPlace = { lat, lng, placeName, placeId, address };
  renderMarkers();
  renderTotalCountBanner();
  renderSearchAreaBanner();
}

function bindSearchEvents() {
  const searchInput = document.getElementById("search-input");
  const searchResults = document.getElementById("search-results");

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

      searchResults.innerHTML = data.slice(0, 6).map((place) => `
        <li class="search-result-item" data-lat="${place.y}" data-lng="${place.x}" data-name="${escapeHtml(place.place_name)}" data-id="${place.id}" data-address="${escapeHtml(place.road_address_name || place.address_name || "")}">
          <strong>${escapeHtml(place.place_name)}</strong>
          <span>${escapeHtml(place.road_address_name || place.address_name)}</span>
        </li>
      `).join("");
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

          showSearchArea({ lat, lng, placeName, placeId, address });
        };
      });
    });
  }
}
