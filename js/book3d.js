// ============================================================
// 입체 책 표지 (2026-10-13)
// ============================================================
// 발자취 소개 화면(js/course.js openCourseDetail)과 어드민 표지 미리보기
// (js/admin.js)가 같이 쓴다. 어드민에서 "책등 + 앞표지"를 한 장으로 올리면
// (책등이 왼쪽), 책등이 차지하는 왼쪽 폭 비율(Course.coverSpineRatio)로
// 이미지를 둘로 나눠 앞표지는 정면, 책등은 왼쪽 측면에 세워 CSS 3D로 그린다.
// 비율이 0/없으면 앞표지만 있는 이미지로 보고, 표지 왼쪽 끝을 어둡게 늘려
// 책등을 흉내낸다. 모양은 css/book3d.css.
//
// 크기는 컨테이너의 CSS 변수 --book-w(앞표지 폭)로 정한다 — 높이와 책등
// 두께는 그 값에 이미지 실제 비율을 곱해 계산하므로 화면 폭별로
// --book-w만 바꾸면 된다.

const BOOK3D_FAKE_SPINE_K = 0.08; // 책등 없는 표지일 때 두께(앞표지 폭 대비)

/**
 * container 안에 입체 책을 그린다. 이미지를 받아 실제 비율을 안 뒤에
 * 그리므로, 그사이 다른 표지로 바뀌었으면(token) 무시한다.
 * @returns {Promise<boolean>} 그렸으면 true, 이미지를 못 받았으면 false
 */
function renderBook3d(container, url, spineRatio) {
  const token = String(Math.random());
  container.dataset.book3dToken = token;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (container.dataset.book3dToken !== token) return resolve(false);
      const r = Math.min(0.5, Math.max(0, Number(spineRatio) || 0));
      const frontW = img.naturalWidth * (1 - r);
      const aspect = img.naturalHeight / frontW; // 앞표지 높이 / 폭
      const spineK = r > 0 ? r / (1 - r) : BOOK3D_FAKE_SPINE_K;
      const cssUrl = `url("${url.replace(/"/g, "%22").replace(/'/g, "%27")}")`;
      const frontStyle = r > 0
        ? `background-image:${cssUrl};background-size:${100 / (1 - r)}% 100%;background-position:right top`
        : `background-image:${cssUrl};background-size:100% 100%`;
      // 책등 없는 표지는 왼쪽 끝 4%를 책등 폭만큼 늘리고 어둡게(.book3d-spine--fake)
      const spineStyle = r > 0
        ? `background-image:${cssUrl};background-size:${100 / r}% 100%;background-position:left top`
        : `background-image:${cssUrl};background-size:2500% 100%;background-position:left top`;
      container.innerHTML = `
        <div class="book3d" style="--book-aspect:${aspect};--spine-k:${spineK}">
          <div class="book3d-body">
            <div class="book3d-spine${r > 0 ? "" : " book3d-spine--fake"}" style='${spineStyle}'></div>
            <div class="book3d-front" style='${frontStyle}'></div>
          </div>
        </div>`;
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

/**
 * 책등+앞표지 이미지에서 책등 경계(왼쪽부터의 폭 비율)를 추정한다 — 왼쪽
 * 40% 안에서 세로로 가장 뚜렷하게 색이 바뀌는 선(책등과 앞표지 사이 접힘)을
 * 찾는다. 같은 출처 이미지(방금 고른 파일의 object URL)여야 픽셀을 읽을 수
 * 있다. 어드민이 슬라이더로 다시 맞출 수 있으니 대략이면 된다.
 */
function detectBookSpineRatio(img) {
  const w = 300;
  const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const lum = (x, y) => {
    const i = (y * w + x) * 4;
    return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  };
  // 점수는 행별 밝기 차이의 "중앙값" — 책등 글씨 가장자리는 몇몇 행에서만
  // 크게 튀고, 책등/앞표지 경계는 약해도 위에서 아래까지 이어진다. 합계로
  // 매기면 책등 글씨에 끌려가서(샘플에서 0.1 대신 0.06) 중앙값을 쓴다.
  let bestX = 0;
  let bestScore = 0;
  for (let x = Math.round(w * 0.03); x < Math.round(w * 0.4); x++) {
    const diffs = [];
    for (let y = 0; y < h; y += 2) diffs.push(Math.abs(lum(x, y) - lum(x + 1, y)));
    diffs.sort((a, b) => a - b);
    const score = diffs[Math.floor(diffs.length / 2)];
    if (score > bestScore) {
      bestScore = score;
      bestX = x + 1;
    }
  }
  return Math.round((bestX / w) * 1000) / 1000;
}
