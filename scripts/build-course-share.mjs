// 발자취별 공유 페이지 + 카톡 미리보기 이미지 만들기(2026-10-22)
//
// 카톡 등은 링크를 붙여넣으면 HTML의 og:image만 읽고 자바스크립트는 실행하지
// 않는다. 공유 링크(/?course=<slug>)는 어느 코스든 같은 index.html이라 미리보기가
// 다 똑같았다. 빌드 없는 정적 사이트라 코스마다 작은 정적 페이지(c/<slug>.html,
// 주소는 /c/<slug>)를 만들어 og 태그를 따로 두고, 열면 바로 /?course=<slug>로 넘긴다.
//
// 코스 데이터·표지는 라이브 사이트를 헤드리스 Chrome으로 열어 그 페이지 안에서
// 읽고, 미리보기 이미지(1200x630)도 그 안의 canvas로 그린다 — 별도 의존성·AWS 키
// 없이 손님(guest) 권한 그대로 쓴다. 공개(지도에 보이는) 코스만 만든다.
//
// 새 발자취가 공개되거나 표지·제목이 바뀌면 다시 돌리고 커밋+push한다:
//   node scripts/build-course-share.mjs
// 그 전까지 페이지가 없는 코스는 공유하기가 예전 주소(/?course=)를 쓴다
// (js/courseSharePages.js 목록에 있는 코스만 /c/ 주소를 쓴다).
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://concretesapiens.com";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 라이브 페이지 안에서 돌린다 — publishedCourses / resolveStoryPhotoUrl는 js/course.js·storage.js 전역.
const RENDER_IN_PAGE = `(async () => {
  for (let i = 0; i < 60 && !publishedCourses.length; i++) await new Promise((r) => setTimeout(r, 500));
  // 웹폰트가 글자 묶음(dynamic subset)으로 나뉘어 있어서, 실제로 그릴 글자로 받아둬야
  // 그 글자들이 빠짐없이 그 폰트로 그려진다.
  const allText = publishedCourses.map((c) => [c.title, c.author, c.description, c.intro].join(" ")).join(" ")
    + " 발자취 · 장소 곳 책 인물 드라마 영화 음악 단체 지음 노래 연출 콘크리트 사피엔스 지도 0123456789…";
  // 글자 묶음 하나가 잠깐 못 받아져도(NetworkError) 멈추지 않고 한 번 더 받아본다
  const fontSpecs = ['700 60px "Maru Buri"', "600 28px Pretendard", "500 22px Pretendard", "400 30px Pretendard"];
  for (let attempt = 0; attempt < 2; attempt++) {
    const results = await Promise.allSettled(fontSpecs.map((f) => document.fonts.load(f, allText)));
    if (results.every((r) => r.status === "fulfilled")) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  const KIND = { book: "책", person: "인물", drama: "드라마·영화", music: "음악", org: "단체" };
  const loadImage = (url) => new Promise((res) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
  // 폭에 맞춰 단어(띄어쓰기) 단위로 줄바꿈 — 한 단어가 한 줄보다 길 때만 글자
  // 단위로 자른다. 최대 줄 수를 넘으면 마지막 줄을 말줄임.
  const wrap = (ctx, text, maxW, maxLines) => {
    const fits = (t) => ctx.measureText(t).width <= maxW;
    const lines = [];
    let line = "";
    for (const word of text.split(/\\s+/).filter(Boolean)) {
      const next = line ? line + " " + word : word;
      if (fits(next)) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      let rest = word;
      while (!fits(rest)) {
        let cut = rest.length - 1;
        while (cut > 1 && !fits(rest.slice(0, cut))) cut--;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    if (line) lines.push(line);
    if (lines.length <= maxLines) return lines;
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (last && !fits(last + "…")) last = last.slice(0, -1);
    kept[maxLines - 1] = last.trimEnd() + "…";
    return kept;
  };
  const out = [];
  for (const c of publishedCourses) {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext("2d");
    // 기본 공유 이미지(assets/og-image.png)와 같은 구성 — 왼쪽 회색 면, 오른쪽 종이색에 글
    ctx.fillStyle = "#F4F3EF";
    ctx.fillRect(0, 0, 1200, 630);
    ctx.fillStyle = "#E7E4DF";
    ctx.fillRect(0, 0, 480, 630);

    // 표지 — 책은 3:4(책등 비율만큼 왼쪽을 잘라 앞표지만), 음악은 정사각형
    const music = c.kind === "music";
    const boxW = music ? 360 : 330;
    const boxH = music ? 360 : 440;
    const x = (480 - boxW) / 2;
    const y = (630 - boxH) / 2;
    const url = c.coverKey ? await resolveStoryPhotoUrl(c.coverKey) : null;
    const img = url ? await loadImage(url) : null;
    ctx.save();
    ctx.shadowColor = "rgba(47, 48, 49, 0.28)";
    ctx.shadowBlur = 32;
    ctx.shadowOffsetY = 14;
    ctx.fillStyle = "#2F3031";
    ctx.fillRect(x, y, boxW, boxH);
    ctx.restore();
    if (img) {
      const spine = c.kind === "book" ? Math.min(0.5, Math.max(0, c.coverSpineRatio || 0)) : 0;
      let sx = img.naturalWidth * spine;
      let sw = img.naturalWidth - sx;
      let sy = 0;
      let sh = img.naturalHeight;
      // object-fit: cover — 칸 비율에 맞춰 남는 쪽을 가운데 기준으로 자른다
      const boxRatio = boxW / boxH;
      if (sw / sh > boxRatio) {
        const w = sh * boxRatio;
        sx += (sw - w) / 2;
        sw = w;
      } else {
        const h = sw / boxRatio;
        sy = (sh - h) / 2;
        sh = h;
      }
      ctx.drawImage(img, sx, sy, sw, sh, x, y, boxW, boxH);
    } else {
      ctx.fillStyle = "#fff";
      ctx.font = '700 34px "Maru Buri"';
      wrap(ctx, c.title, boxW - 48, 4).forEach((l, i) => ctx.fillText(l, x + 24, y + 60 + i * 46));
    }

    // 오른쪽 글
    const tx = 548;
    const tw = 1200 - tx - 70;
    let ty = 150;
    ctx.fillStyle = "#FF5A36";
    ctx.font = "600 28px Pretendard";
    ctx.fillText("발자취 · " + (KIND[c.kind] ? KIND[c.kind] + " · " : "") + "장소 " + c.places.length + "곳", tx, ty);
    ty += 82;
    ctx.fillStyle = "#2F3031";
    ctx.font = '700 60px "Maru Buri"';
    for (const l of wrap(ctx, c.title, tw, 2)) {
      ctx.fillText(l, tx, ty);
      ty += 76;
    }
    if (c.author) {
      ctx.fillStyle = "#777875";
      ctx.font = "400 28px Pretendard";
      const suffix = { music: "노래", drama: "연출" }[c.kind] || "지음";
      ctx.fillText(c.author + " " + suffix, tx, ty - 14);
      ty += 32;
    }
    ty += 6;
    ctx.fillStyle = "#CFCDC8";
    ctx.fillRect(tx, ty - 24, tw, 2);
    ty += 30;
    const desc = c.description || c.intro || "";
    if (desc) {
      ctx.fillStyle = "#2F3031";
      ctx.font = "400 30px Pretendard";
      for (const l of wrap(ctx, desc, tw, 2)) {
        ctx.fillText(l, tx, ty);
        ty += 46;
      }
    }
    ctx.fillStyle = "#8A8B88";
    ctx.font = "500 22px Pretendard";
    ctx.fillText("콘크리트 사피엔스 지도", tx, 572);

    out.push({
      slug: c.slug,
      title: c.title,
      description: c.description || "",
      intro: c.intro || "",
      hasCover: !!img,
      jpeg: canvas.toDataURL("image/jpeg", 0.88).split(",")[1],
    });
  }
  return out;
})()`;

async function renderCourses() {
  const profile = mkdtempSync(join(tmpdir(), "cs-og-"));
  const port = 9400 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
  try {
    let targets;
    for (let i = 0; i < 50 && !targets; i++) {
      try {
        targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      } catch {
        await sleep(200);
      }
    }
    const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r));
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
    });
    const send = (method, params = {}) => new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
    // 헤드리스 Chrome은 방문 통계에서 자동 제외된다(js/storage.js isAutomatedBrowser)
    await send("Page.enable");
    await send("Page.navigate", { url: `${SITE}/` });
    await sleep(8000);
    const r = await send("Runtime.evaluate", { expression: RENDER_IN_PAGE, awaitPromise: true, returnByValue: true });
    ws.close();
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || "페이지 안에서 실패");
    return r.result.result.value;
  } finally {
    chrome.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
}

function sharePageHtml(c, imageUrl) {
  const target = `/?course=${encodeURIComponent(c.slug)}&from=course_link`;
  const desc = c.description || c.intro || "이야기가 머문 장소를 따라 도시를 걸어보세요.";
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <!-- scripts/build-course-share.mjs가 만든 파일 — 직접 고치지 말고 스크립트를 다시 돌린다 -->
  <title>${esc(c.title)} · 발자취 | 콘크리트 사피엔스 지도</title>
  <meta name="description" content="${esc(desc)}" />
  <meta property="og:title" content="${esc(c.title)} · 발자취" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:site_name" content="콘크리트 사피엔스 지도" />
  <meta property="og:url" content="${SITE}/c/${esc(c.slug)}" />
  <meta property="og:image" content="${esc(imageUrl)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="ko_KR" />
  <meta name="twitter:card" content="summary_large_image" />
  <!-- 이동은 자바스크립트로만 — 미리보기 수집기(카톡 등)는 스크립트를 안 돌려서 이
       페이지의 og를 읽는다. meta refresh·canonical은 따라가는 수집기가 있어 안 쓴다. -->
  <script>location.replace(${JSON.stringify(target)});</script>
</head>
<body>
  <p><a href="${esc(target)}">${esc(c.title)} 발자취 열기</a></p>
</body>
</html>
`;
}

const courses = await renderCourses();
if (!courses?.length) throw new Error("공개된 발자취를 못 받았어요");

const pageDir = join(ROOT, "c");
const imageDir = join(ROOT, "assets", "og");
mkdirSync(pageDir, { recursive: true });
mkdirSync(imageDir, { recursive: true });
// 비공개로 돌리거나 지운 코스의 예전 파일은 지운다
const keep = new Set(courses.map((c) => c.slug));
for (const f of readdirSync(pageDir)) if (f.endsWith(".html") && !keep.has(f.slice(0, -5))) unlinkSync(join(pageDir, f));
for (const f of readdirSync(imageDir)) {
  const m = f.match(/^course-(.+)\.jpg$/);
  if (m && !keep.has(m[1])) unlinkSync(join(imageDir, f));
}

const pages = {};
for (const c of courses) {
  const jpeg = Buffer.from(c.jpeg, "base64");
  // 카톡은 이미지를 주소 기준으로 오래 캐시해서, 내용이 바뀌면 주소(?v=)도 바뀌게 한다
  const version = createHash("sha1").update(jpeg).digest("hex").slice(0, 8);
  writeFileSync(join(imageDir, `course-${c.slug}.jpg`), jpeg);
  writeFileSync(join(pageDir, `${c.slug}.html`), sharePageHtml(c, `${SITE}/assets/og/course-${c.slug}.jpg?v=${version}`));
  pages[c.slug] = version;
  console.log(`${c.slug}  ${c.title}${c.hasCover ? "" : "  (표지 없음 — 제목으로 대신)"}`);
}

writeFileSync(
  join(ROOT, "js", "courseSharePages.js"),
  `// scripts/build-course-share.mjs가 만든 파일 — 직접 고치지 말고 스크립트를 다시 돌린다.
// 공유 페이지(c/<slug>.html, 카톡 미리보기용)가 있는 발자취 — 여기 있는 코스만
// 공유하기가 /c/<slug> 주소를 쓰고, 없으면 예전처럼 /?course=<slug>(js/course.js buildCourseUrl).
const COURSE_SHARE_PAGES = ${JSON.stringify(pages, null, 2)};
`,
);
console.log(`\n${courses.length}개 만들었어요 — c/, assets/og/, js/courseSharePages.js를 커밋하세요.`);
