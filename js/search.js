// ============================================================
// 상단 검색 (카카오 장소 검색)
// ============================================================

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
          map.setCenter(new kakao.maps.LatLng(lat, lng));
          map.setLevel(4);
          searchResults.classList.add("hidden");
          searchInput.value = "";

          const promptPrefill = consumePendingDailyPrompt();
          requireLogin(() => openComposer({
            lat, lng,
            officialPlaceName: item.dataset.name,
            placeId: item.dataset.id,
            address: item.dataset.address || null,
            isFreePin: false,
            prefillContent: promptPrefill,
          }));
        };
      });
    });
  }
}
