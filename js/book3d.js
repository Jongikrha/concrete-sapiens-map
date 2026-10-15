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
  const iw = img.naturalWidth || img.width; // canvas도 받는다(cleanBookCoverImage 결과)
  const ih = img.naturalHeight || img.height;
  const h = Math.max(1, Math.round((ih / iw) * w));
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

/**
 * 올린 표지 이미지를 정리한다 — (1) 바깥 배경 여백(왼쪽 위 픽셀 색)을 잘라내고
 * (2) 책등과 앞표지가 배경 틈을 두고 따로 놓인 이미지면 그 틈을 빼서 책등에
 * 앞표지를 바로 붙인다. 틈이 남아 있으면 책등 경계를 틈 앞쪽에 잡아도 작은
 * 썸네일 왼쪽에 책등 끝 + 흰 틈이 같이 보였다(채만식 <탁류>, 2026-10-15).
 * @returns {{ canvas: HTMLCanvasElement, spineRatio: number|null }} 틈을 찾았으면
 *   spineRatio는 정확한 책등 비율, 못 찾았으면 null(detectBookSpineRatio로 추정)
 */
function cleanBookCoverImage(img) {
  const s = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * s);
  const h = Math.round(img.naturalHeight * s);
  const work = document.createElement("canvas");
  work.width = w;
  work.height = h;
  work.getContext("2d").drawImage(img, 0, 0, w, h);
  const { data } = work.getContext("2d").getImageData(0, 0, w, h);
  const [br, bg, bb] = data;
  const isBg = (x, y) => {
    const i = (y * w + x) * 4;
    return Math.max(Math.abs(data[i] - br), Math.abs(data[i + 1] - bg), Math.abs(data[i + 2] - bb)) < 28;
  };
  const colBgShare = (x, y0, y1) => {
    let hit = 0, n = 0;
    for (let y = y0; y < y1; y += 2, n++) if (isBg(x, y)) hit++;
    return hit / n;
  };
  const rowBgShare = (y, x0, x1) => {
    let hit = 0, n = 0;
    for (let x = x0; x < x1; x += 2, n++) if (isBg(x, y)) hit++;
    return hit / n;
  };
  // 한 줄의 98% 이상이 배경색이면 배경 줄(종이 질감·노이즈 몇 점은 봐준다).
  // 가장자리 그림자·둥근 모서리 줄은 반쯤만 배경이라, 배경 줄을 찾은 뒤엔
  // 절반 이상 배경인 이웃 줄까지 같이 잘라 흰 실선이 안 남게 한다.
  const colIsBg = (x, y0, y1) => colBgShare(x, y0, y1) >= 0.98;
  const rowIsBg = (y, x0, x1) => rowBgShare(y, x0, x1) >= 0.98;
  let left = 0, right = w, top = 0, bottom = h;
  while (left < w && colIsBg(left, 0, h)) left++;
  while (right > left && colIsBg(right - 1, 0, h)) right--;
  while (top < h && rowIsBg(top, left, right)) top++;
  while (bottom > top && rowIsBg(bottom - 1, left, right)) bottom--;
  if (left > 0) while (left < right && colBgShare(left, top, bottom) >= 0.5) left++;
  if (right < w) while (right > left && colBgShare(right - 1, top, bottom) >= 0.5) right--;
  if (top > 0) while (top < bottom && rowBgShare(top, left, right) >= 0.5) top++;
  if (bottom < h) while (bottom > top && rowBgShare(bottom - 1, left, right) >= 0.5) bottom--;
  // 거의 다 배경으로 보이면(표지 자체가 배경색과 같은 단색 등) 손대지 않는다
  if (right - left < w * 0.3 || bottom - top < h * 0.3) {
    left = 0; right = w; top = 0; bottom = h;
  }
  const tw = right - left;
  const th = bottom - top;
  // 책등과 앞표지 사이 틈 — 왼쪽 3~45% 안에서 처음 나오는 배경 세로줄 묶음.
  // 바깥 여백이 있던 이미지만(여백이 없으면 왼쪽 위 색이 표지 그림 색이라
  // 단색 표지를 틈으로 오인할 수 있다), 틈은 전체 폭의 10% 미만만 인정.
  let gapStart = -1, gapEnd = -1;
  if (left > 0 || top > 0) {
    for (let x = left + Math.round(tw * 0.03); x < left + Math.round(tw * 0.45); x++) {
      if (colIsBg(x, top, bottom)) {
        if (gapStart < 0) gapStart = x;
        gapEnd = x + 1;
      } else if (gapStart >= 0) break;
    }
    if (gapStart >= 0) {
      while (gapStart > left && colBgShare(gapStart - 1, top, bottom) >= 0.5) gapStart--;
      while (gapEnd < right && colBgShare(gapEnd, top, bottom) >= 0.5) gapEnd++;
      if (gapEnd - gapStart >= tw * 0.1 || gapEnd >= right) gapStart = -1;
    }
  }
  const out = document.createElement("canvas");
  const octx = out.getContext("2d");
  if (gapStart < 0) {
    out.width = tw;
    out.height = th;
    octx.drawImage(work, left, top, tw, th, 0, 0, tw, th);
    return { canvas: out, spineRatio: null };
  }
  const spineW = gapStart - left;
  const frontW = right - gapEnd;
  out.width = spineW + frontW;
  out.height = th;
  octx.drawImage(work, left, top, spineW, th, 0, 0, spineW, th);
  octx.drawImage(work, gapEnd, top, frontW, th, spineW, 0, frontW, th);
  return { canvas: out, spineRatio: Math.round((spineW / out.width) * 1000) / 1000 };
}
