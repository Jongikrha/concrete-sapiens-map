// ============================================================
// 카카오 장소+주소 통합 검색 (2026-10-13)
// ============================================================
// 예전엔 메인 검색(js/search.js)과 어드민 발자취 장소 검색(js/admin.js)
// 모두 Places.keywordSearch(장소 이름 검색)만 썼다. 그래서 "서울 도봉구
// 쌍문동 81-356" 같은 지번/도로명 주소를 넣으면 결과가 없었다. 카카오맵
// 앱처럼 Geocoder.addressSearch(주소 검색)도 같이 돌려서, 주소로 찾은
// 결과를 앞에 두고 장소 결과를 뒤에 붙인다.
//
// 결과는 keywordSearch 결과와 같은 모양(place_name/address_name/
// road_address_name/x/y/id)으로 맞춰서 기존 렌더링 코드를 그대로 쓴다.
// 주소 결과는 isAddress: true, id: null이다(카카오 장소 id가 없어 자유 핀).
// 카카오 SDK(services 라이브러리)가 로드된 뒤에 불러야 한다.

function searchKakaoPlacesAndAddresses(query, callback) {
  const { Places, Geocoder, Status } = kakao.maps.services;
  let addressResults = null;
  let placeResults = null;

  const finish = () => {
    if (addressResults === null || placeResults === null) return;
    callback([...addressResults, ...placeResults]);
  };

  new Geocoder().addressSearch(query, (data, status) => {
    addressResults = status === Status.OK ? data.map(toAddressSearchResult) : [];
    finish();
  });
  new Places().keywordSearch(query, (data, status) => {
    placeResults = status === Status.OK ? data : [];
    finish();
  });
}

function toAddressSearchResult(d) {
  const road = d.road_address;
  const jibun = d.address;
  return {
    id: null,
    isAddress: true,
    // 건물 이름이 있으면 그걸 제목으로, 없으면 검색된 주소 자체를 제목으로
    place_name: (road && road.building_name) || d.address_name,
    road_address_name: road ? road.address_name : "",
    address_name: jibun ? jibun.address_name : d.address_name,
    x: d.x,
    y: d.y,
  };
}
