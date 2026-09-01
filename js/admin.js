// ============================================================
// 어드민 대시보드 — 신고 검토 / 전체 콘텐츠 / 금칙어 / 방문 현황
// ============================================================
// index.html과 달리 카카오 SDK 타이밍 제약이 없어서(지도 없음) 이 파일
// 하나로 Amplify Auth import + 로그인 + 데이터 로드를 전부 처리한다.
// js/storage.js는 클래식 스크립트로 그대로 재사용하되, 게스트 클라이언트
// 대신 로그인된 관리자 클라이언트를 Storage._setClient로 주입한다.

import { Amplify } from "https://esm.sh/aws-amplify@6.20.0";
import { signIn, signOut, fetchAuthSession, getCurrentUser } from "https://esm.sh/aws-amplify@6.20.0/auth";
import { generateClient } from "https://esm.sh/aws-amplify@6.20.0/data";
import { getUrl } from "https://esm.sh/aws-amplify@6.20.0/storage";

const isLocalDev = ["localhost", "127.0.0.1"].includes(window.location.hostname);
// /admin(리다이렉트) 경로에서 열릴 수도 있어서 상대경로는 위험하다 — 절대경로로 고정.
const OUTPUTS_FILE = isLocalDev ? "/amplify_outputs.local.json" : "/amplify_outputs.json";

let activeTab = "queue";
let activeDeviceFilter = null;
let storyAuthorEmailById = {};
let storyCountByUserId = {};
let client = null;
let currentUsername = null;
let members = null; // 회원관리 탭에서만 필요해서 첫 진입 때 로드(지연 로딩)
let flagsByUserId = {}; // userId -> UserFlag 레코드(id, note) — 있으면 깃발 켜짐

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// 벌크 등록 탭에서 "프롬프트 복사" 버튼으로 그대로 복사되는 텍스트.
// 실제 DB에 등록된 글(2026-08-12 기준) 몇 개를 톤 예시로 넣어서, 과장되거나
// 설명적인 문체가 아니라 절제된 1인칭 회고체로 나오게 유도한다.
const BULK_PROMPT = `콘크리트 사피엔스 지도는 특정 장소에 얽힌 개인적인 "기억"을 짧은 글로 남기는 서비스야.
아래는 실제로 등록된 글 3개야 — 문체와 분량, 감정의 절제 정도를 그대로 참고해서
비슷한 느낌의 "가상의" 기억 데이터를 CSV로 20개 만들어줘.

[실제 등록된 글 예시]
1. (양화대교, 2016년 1월, #양화대교 #그리움 #첫사랑)
첫사랑에 실패한 그해 겨울, 그 때는 이상하게 많이 걷고 싶었다.
양화대교를 건널 때면 늘 자이언티의 「양화대교」를 들었다. 이어폰을 꽂고, 마치 내가
자이언티라도 된 것처럼 온갖 기교를 다 부려가며 큰 소리로 따라 불렀다.
가끔 그 시절이 그립다.

2. (여의도성모병원, 2017년 9월, #할머니 #추모 #그리움)
무더위가 조금씩 물러가고, 찬 바람과 더운 바람이 번갈아 불던 그때 할머니가 돌아가셨다.
불행인지 다행인지, 병원에서 오래 고생하지 않으시고 일주일 만에 떠나셨다.
시간이 꽤 흘렀는데도 그때처럼 바람이 불면 문득 할머니가 생각난다.
보고 싶어요, 할머니.

3. (신촌역, 2017년 6월, #첫사랑 #고백)
"나 사실 너 좋아해." 수십 번 연습했다.
결국 그날 내가 한 말은 "조심히 들어가."
그게 끝이었다.

[CSV 형식]
첫 줄은 헤더로 아래 컬럼명을 그대로 쓰고, 그 아래 20줄에 데이터를 채워줘:
content,lat,lng,placeName,year,month,hashtags,authorName,reactionCount,viewCount

- content: 2~4문장(또는 짧게 줄바꿈되는 여러 줄)짜리 담백한 1인칭 회고. 위 예시처럼
  설명하지 않고 장면과 감정만 남기는 절제된 톤. 과장된 수식어, 설명체 금지.
- lat, lng: 실존하는 대한민국 내 장소의 대략적인 위도/경도(소수점 5~6자리, 정확하지
  않아도 됨 — 그 지역 대략 좌표면 충분)
- placeName: 장소 이름(구체적인 상호/건물/지명일수록 좋음)
- year, month: 기억의 시점(선택 — 모르면 완전히 빈칸으로 둬서 "시점 모름"으로 처리)
- hashtags: 세미콜론(;)으로 구분한 해시태그 2~3개, 전부 #으로 시작
- authorName: 대부분 빈칸(빈칸이면 "익명" 처리됨), 가끔만 닉네임 하나
- reactionCount, viewCount: 0~40 사이 임의 숫자

[진짜 익명의 사람이 쓴 것처럼 보이게 하는 디테일]
- 20개 중 절반(약 10개) 정도에만, 본인만 알 수 있는 아주 구체적인 디테일을
  하나씩 슬쩍 끼워넣어줘 — 예: 그때 유행하던 별명, 가게 간판 색깔, 정확한
  버스/지하철 번호, 남들은 몰라도 되는 브랜드명이나 물건 이름 같은, 남이
  보면 별 의미 없어 보이지만 본인한테는 생생한 디테일. 나머지 절반은 이런
  디테일 없이 담백하게 — 전부 다 넣으면 오히려 부자연스러워지니까 절반만.
- 20개 전부가 같은 사람이 쓴 것처럼 보이면 안 돼. 글투(말투)를 항목마다
  랜덤하게 다르게 섞어줘 — 예를 들어 음슴체(~했음, ~함), 반말 일기체(~다),
  존댓말 회고체(~했어요), 친구한테 말하듯 편한 구어체, 약간 건조하고
  짧은 문어체 등. 어떤 글은 맞춤법이 살짝 흐트러지거나 이모티콘/ㅋㅋ 같은
  것도 가끔 섞여도 좋아. 서로 다른 사람들이 각자 쓴 것처럼 문체가 들쭉날쭉
  해야 진짜 같아 보여.

내용(content)에 콤마(,)나 줄바꿈이 들어가면 그 필드 전체를 큰따옴표로 감싸줘.
설명이나 코드블록 표시 없이 CSV 텍스트만 그대로 출력해줘.`;

/**
 * 최소한의 CSV 파서 — 큰따옴표로 감싼 필드 안의 콤마/줄바꿈/이스케이프된
 * 큰따옴표("")까지 처리한다. 외부 라이브러리 없이 붙여넣기 텍스트만 다루면
 * 되는 범위라 이 정도로 충분하다.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function csvRowsToObjects(rows) {
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, i) => {
      obj[h] = (r[i] || "").trim();
    });
    return obj;
  });
}

async function isAdminSession() {
  try {
    await getCurrentUser();
    const session = await fetchAuthSession();
    const groups = session.tokens?.idToken?.payload["cognito:groups"] || [];
    return groups.includes("Admins");
  } catch (e) {
    return false;
  }
}

async function bootAdminClient() {
  client = generateClient({ authMode: "userPool" });
  Storage._setClient(client);
  await Storage.refresh();

  currentUsername = (await getCurrentUser()).username;

  const authors = await Storage.listStoryAuthors();
  storyAuthorEmailById = {};
  storyCountByUserId = {};
  authors.forEach((a) => {
    storyAuthorEmailById[a.storyId] = a.email;
    storyCountByUserId[a.userId] = (storyCountByUserId[a.userId] || 0) + 1;
  });
}

function showDashboard() {
  document.getElementById("login-view").classList.add("hidden");
  document.getElementById("dashboard-view").classList.remove("hidden");
  renderActiveTab();
}

function showLogin(errorMessage) {
  document.getElementById("login-view").classList.remove("hidden");
  document.getElementById("dashboard-view").classList.add("hidden");
  const errEl = document.getElementById("login-error");
  if (errorMessage) {
    errEl.textContent = errorMessage;
    errEl.classList.remove("hidden");
  } else {
    errEl.classList.add("hidden");
  }
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  try {
    const result = await signIn({ username: email, password });
    if (!result.isSignedIn) {
      showLogin("로그인을 완료하지 못했습니다.");
      return;
    }
  } catch (err) {
    showLogin("이메일 또는 비밀번호가 올바르지 않습니다.");
    return;
  }

  if (!(await isAdminSession())) {
    showLogin("관리자 계정이 아닙니다.");
    await signOut();
    return;
  }

  await bootAdminClient();
  showDashboard();
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  await signOut();
  showLogin();
});

document.getElementById("admin-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  activeTab = btn.dataset.tab;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("tab-btn--active", b === btn));
  renderActiveTab();
});

document.getElementById("device-filter-clear").addEventListener("click", () => {
  activeDeviceFilter = null;
  renderActiveTab();
});

function setDeviceFilter(deviceId) {
  activeDeviceFilter = deviceId;
  const banner = document.getElementById("device-filter-banner");
  const count = Storage.getAllStories().filter((s) => s.authorDeviceId === deviceId).length;
  document.getElementById("device-filter-label").textContent = `이 브라우저가 쓴 기억 ${count}개만 보는 중`;
  banner.classList.remove("hidden");
  renderActiveTab();
}

function clearDeviceFilterBanner() {
  document.getElementById("device-filter-banner").classList.add("hidden");
}

function applyDeviceFilter(stories) {
  if (!activeDeviceFilter) return stories;
  return stories.filter((s) => s.authorDeviceId === activeDeviceFilter);
}

function deviceBadgeHtml(story) {
  if (!story.authorDeviceId) return "";
  const count = Storage.getAllStories().filter((s) => s.authorDeviceId === story.authorDeviceId).length;
  return `<button class="device-badge" data-device="${escapeHtml(story.authorDeviceId)}">이 브라우저 기억 ${count}개</button>`;
}

// 신고 사유가 "사진이 부적절함"인 경우 텍스트만 보고는 판단할 수 없어서
// 신고 검토 큐/전체 콘텐츠 목록에도 사진 미리보기를 넣는다(2026-09-01).
// index.html 쪽 js/photoUpload.js와 같은 이유로 presigned URL을 photoKey
// 기준으로 캐싱해서 재렌더링마다 다시 요청하지 않는다 — 다만 admin.html은
// 카카오맵 타이밍 제약이 없어 이 파일 하나로 Amplify import까지 직접 하는
// 구조라(파일 위쪽 주석 참고) PhotoUpload 전역 대신 getUrl을 여기서 바로 쓴다.
const _adminPhotoUrlCache = new Map();
function resolveAdminPhotoUrl(photoKey) {
  if (!_adminPhotoUrlCache.has(photoKey)) {
    _adminPhotoUrlCache.set(photoKey, getUrl({ path: photoKey }).then((r) => r.url.toString()).catch(() => null));
  }
  return _adminPhotoUrlCache.get(photoKey);
}

function hydrateAdminPhotos() {
  document.querySelectorAll("#admin-content .admin-card-photo[data-photo-key]").forEach((el) => {
    resolveAdminPhotoUrl(el.dataset.photoKey).then((url) => {
      if (!url) { el.remove(); return; }
      const img = document.createElement("img");
      img.alt = "";
      img.src = url;
      el.replaceChildren(img);
    });
  });
}

function storyCardHtml(story, { showRestore }) {
  const title = Storage.getGroupTitle({
    placeId: story.placeId,
    officialPlaceName: story.officialPlaceName,
    address: story.address,
    customName: story.customName,
    stories: [story],
  });
  return `
    <div class="admin-card" data-id="${story.id}">
      ${story.photoKey ? `<div class="admin-card-photo" data-photo-key="${escapeHtml(story.photoKey)}"></div>` : ""}
      <p class="admin-card-content">${escapeHtml(story.content)}</p>
      <div class="admin-card-meta">
        <span>${escapeHtml(title)}</span>
        <span>신고 ${story.reportCount || 0}회</span>
        <span>조회 ${story.viewCount || 0}회</span>
        <span>상태 ${story.status}</span>
        <span>${storyAuthorEmailById[story.id] ? `회원 ${escapeHtml(storyAuthorEmailById[story.id])}` : "계정 미연결(로그인 게이트 이전 글)"}</span>
        ${deviceBadgeHtml(story)}
      </div>
      <div class="admin-card-actions">
        ${showRestore ? `<button class="btn-restore" data-action="restore" data-id="${story.id}">복구</button>` : `<button class="btn-restore" data-action="hide" data-id="${story.id}">숨기기</button>`}
        <button class="btn-delete" data-action="delete" data-id="${story.id}">완전 삭제</button>
        ${story.youtubeUrl ? `<button class="btn-restore" data-action="toggle-music-edit" data-id="${story.id}">🎧 곡 정보 수정</button>` : ""}
      </div>
      ${story.youtubeUrl ? musicEditPanelHtml(story) : ""}
    </div>
  `;
}

// 유튜브 링크에서 자동 추출한 아티스트/곡명이 틀리게 들어오는 경우를 대비해,
// 다른 내용은 건드리지 않고 이 두 필드만 고칠 수 있게 한다(2026-08-24) —
// 본문/장소/작성자 표시 등은 작성자 본인만 고칠 수 있는 영역이라 어드민은
// 손대지 않는다.
function musicEditPanelHtml(story) {
  return `
    <div class="admin-music-edit hidden" id="music-edit-${story.id}">
      <input type="text" class="admin-music-input" id="music-artist-${story.id}" placeholder="아티스트" value="${escapeHtml(story.musicArtist || "")}" />
      <input type="text" class="admin-music-input" id="music-title-${story.id}" placeholder="곡 제목" value="${escapeHtml(story.musicTitle || "")}" />
      <div class="admin-music-edit-actions">
        <button class="btn-primary" data-action="save-music" data-id="${story.id}">저장</button>
        <button class="btn-restore" data-action="toggle-music-edit" data-id="${story.id}">취소</button>
      </div>
    </div>
  `;
}

async function handleCardAction(action, storyId) {
  // toggle-music-edit는 패널 보이기/감추기일 뿐 서버 반영이 없어, 아래
  // renderActiveTab() 재렌더링을 안 거치고 여기서 바로 끝낸다 — 재렌더링을
  // 타면 스크롤 위치도 흔들리고 방금 입력 중이던 값도 날아간다.
  if (action === "toggle-music-edit") {
    document.getElementById(`music-edit-${storyId}`)?.classList.toggle("hidden");
    return;
  }
  if (action === "save-music") {
    const artistInput = document.getElementById(`music-artist-${storyId}`);
    const titleInput = document.getElementById(`music-title-${storyId}`);
    const musicArtist = artistInput.value.trim() || null;
    const musicTitle = titleInput.value.trim() || null;
    Storage.updateStory(storyId, { musicArtist, musicTitle }, {
      onFail: () => alert("곡 정보가 저장되지 않았어요. 잠시 후 다시 시도해주세요."),
    });
    renderActiveTab();
    return;
  }
  if (action === "restore") {
    await Storage.restoreStory(storyId);
  } else if (action === "hide") {
    await Storage.hideStory(storyId);
  } else if (action === "delete") {
    if (!confirm("정말 완전히 삭제할까요? 되돌릴 수 없습니다.")) return;
    await Storage.deleteStory(storyId);
  }
  renderActiveTab();
}

function renderQueueTab() {
  clearDeviceFilterBanner();
  const stories = applyDeviceFilter(Storage.getAllStories().filter((s) => s.status === "HIDDEN"));
  const html = stories.length
    ? stories.map((s) => storyCardHtml(s, { showRestore: true })).join("")
    : `<p class="empty-state">신고로 숨겨진 기억이 없습니다.</p>`;
  document.getElementById("admin-content").innerHTML = `
    <div class="admin-section-title">신고 검토 큐 (${stories.length}건)</div>
    ${html}
  `;
}

function renderAllTab() {
  const keyword = document.getElementById("all-search-input")?.value.trim() || "";
  let stories = applyDeviceFilter(Storage.getAllStories());
  if (keyword) {
    // 이전엔 본문(content)만 봐서 "가수/곡명"으로 검색하면 곡 정보가 본문에
    // 그대로 안 적혀 있는 한 못 찾았다 — musicArtist/musicTitle도 같이
    // 본다(2026-08-24, "노래 검색이 안 된다" 피드백). 대소문자 구분 없이.
    const needle = keyword.toLowerCase();
    stories = stories.filter((s) =>
      s.content.toLowerCase().includes(needle) ||
      (s.musicArtist || "").toLowerCase().includes(needle) ||
      (s.musicTitle || "").toLowerCase().includes(needle)
    );
  }
  stories = [...stories].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const html = stories.length
    ? stories.map((s) => storyCardHtml(s, { showRestore: s.status === "HIDDEN" })).join("")
    : `<p class="empty-state">해당하는 기억이 없습니다.</p>`;

  document.getElementById("admin-content").innerHTML = `
    <div class="admin-section-title">전체 콘텐츠 (${stories.length}건)</div>
    <div class="search-row"><input type="text" id="all-search-input" placeholder="내용/가수/곡명 검색" value="${escapeHtml(keyword)}" /></div>
    ${html}
  `;
  // renderAllTab이 admin-content 전체를 innerHTML로 새로 그려서, 매 키
  // 입력마다 이 input 자체도 통째로 새 DOM 노드로 교체된다 — 그러면 입력
  // 포커스가 body로 빠져버려 다음 글자부터 안 써지는 것처럼 보인다
  // (2026-08-24, "검색에 글이 안 써진다" 피드백). 재렌더링 직후 새 input을
  // 다시 포커스하고 커서 위치까지 복원한다.
  document.getElementById("all-search-input").addEventListener("input", (e) => {
    const cursorPos = e.target.selectionStart;
    renderAllTab();
    const input = document.getElementById("all-search-input");
    input.focus();
    input.setSelectionRange(cursorPos, cursorPos);
  });
}

function renderWordsTab() {
  clearDeviceFilterBanner();
  const words = Storage.getBannedWords();
  const html = words.length
    ? words.map((w) => `<span class="banned-word-chip">${escapeHtml(w.word)}<button data-id="${w.id}">✕</button></span>`).join("")
    : `<p class="empty-state">등록된 금칙어가 없습니다.</p>`;

  document.getElementById("admin-content").innerHTML = `
    <div class="admin-section-title">금칙어 관리</div>
    <form class="banned-word-form" id="banned-word-form">
      <input type="text" id="banned-word-input" placeholder="추가할 단어" required />
      <button type="submit" class="btn-primary">추가</button>
    </form>
    <div>${html}</div>
  `;

  document.getElementById("banned-word-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("banned-word-input");
    const word = input.value.trim();
    if (!word) return;
    await Storage.addBannedWord(word);
    renderWordsTab();
  });

  document.querySelectorAll(".banned-word-chip button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await Storage.removeBannedWord(btn.dataset.id);
      renderWordsTab();
    });
  });
}

/**
 * 최근 14일 방문 수를 날짜별로 묶는다. 데이터 없는 날도 0으로 채워서
 * 빈 날짜가 조용히 사라지지 않게 한다(추세를 한눈에 보려면 빠진 날도 보여야 함).
 */
function buildDailyVisitCounts(pageViews, days = 14) {
  const counts = {};
  pageViews.forEach((pv) => {
    const day = (pv.createdAt || "").slice(0, 10);
    if (!day) return;
    counts[day] = (counts[day] || 0) + 1;
  });

  const result = [];
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push({ date: key, count: counts[key] || 0 });
  }
  return result; // 오늘이 맨 앞
}

// 이벤트 타입별 개수 + "노출→확인" 전환율 — "이맘때 기억"/작성 폼 같은
// 새 기능이 실제로 쓰이는지 나중에 눈으로 확인할 수 있게 한다(2026-08-21).
// 새 이벤트 타입이 추가돼도 이 함수는 그대로 두고 FUNNEL_PAIRS에 한 줄만
// 추가하면 된다.
const FUNNEL_PAIRS = [
  { label: "이맘때 기억", openType: "throwback_opened", confirmType: "throwback_confirmed" },
  { label: "작성 폼", openType: "composer_opened", confirmType: "composer_submitted" },
  { label: "웰컴 모달 → 내 위치에 기억 남기기", openType: "welcome_shown", confirmType: "welcome_write_clicked" },
];

function buildFunnelHtml(appEvents) {
  const counts = {};
  appEvents.forEach((e) => {
    counts[e.type] = (counts[e.type] || 0) + 1;
  });
  return FUNNEL_PAIRS.map(({ label, openType, confirmType }) => {
    const opened = counts[openType] || 0;
    const confirmed = counts[confirmType] || 0;
    const rate = opened > 0 ? Math.round((confirmed / opened) * 100) : 0;
    return `<div class="top-story-row"><span>${escapeHtml(label)} — 노출 ${opened} → 확인 ${confirmed}</span><span>${rate}%</span></div>`;
  }).join("");
}

// 짝(open→confirm)이 없는 단독 카운트 — 재방문율은 특정 유저 식별 없이
// 로컬스토리지 첫방문 플래그로만 근사한다(js/app.js logVisitKind, 2026-08-23).
const STANDALONE_EVENT_LABELS = [
  { type: "story_card_opened", label: "기억 카드 열람" },
  { type: "share_clicked", label: "나의 기억 지도 공유 클릭" },
];

function buildEventCountsHtml(appEvents) {
  const counts = {};
  appEvents.forEach((e) => {
    counts[e.type] = (counts[e.type] || 0) + 1;
  });
  return STANDALONE_EVENT_LABELS.map(
    ({ type, label }) => `<div class="top-story-row"><span>${escapeHtml(label)}</span><span>${counts[type] || 0}</span></div>`
  ).join("");
}

function computeReturningVisitRate(appEvents) {
  const first = appEvents.filter((e) => e.type === "visit_first").length;
  const returning = appEvents.filter((e) => e.type === "visit_returning").length;
  const total = first + returning;
  return total > 0 ? Math.round((returning / total) * 100) : 0;
}

async function renderVisitsTab() {
  clearDeviceFilterBanner();
  document.getElementById("admin-content").innerHTML = `<p class="empty-state">불러오는 중...</p>`;
  const allPageViews = await Storage.listPageViews();
  const appEvents = await Storage.listAppEvents();
  const myDeviceId = Storage.getDeviceId();
  const excludedRecords = await Storage.listExcludedDevices();
  const excludedDeviceIds = excludedRecords.map((r) => r.deviceId);
  // 방문 수 집계에서만 제외한다 — AppEvent는 deviceId가 없어 못 거르고,
  // 인기 기억 Top10(viewCount)도 별도 카운터라 범위 밖(2026-08-25).
  const pageViews = allPageViews.filter((pv) => !excludedDeviceIds.includes(pv.deviceId));
  const dailyCounts = buildDailyVisitCounts(pageViews);
  const maxCount = Math.max(1, ...dailyCounts.map((d) => d.count));
  const funnelHtml = buildFunnelHtml(appEvents);
  const eventCountsHtml = buildEventCountsHtml(appEvents);
  const returningRate = computeReturningVisitRate(appEvents);

  const topStories = [...Storage.getAllStories()]
    .filter((s) => (s.viewCount || 0) > 0)
    .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
    .slice(0, 10);

  const topHtml = topStories.length
    ? topStories.map((s) => `<div class="top-story-row"><span>${escapeHtml(s.content.slice(0, 40))}</span><span>${s.viewCount}회</span></div>`).join("")
    : `<p class="empty-state">아직 조회된 기억이 없습니다.</p>`;

  const dailyHtml = dailyCounts
    .map(
      (d) => `
        <div class="daily-visit-row">
          <span class="daily-visit-date">${d.date.slice(5)}</span>
          <div class="daily-visit-bar-track"><div class="daily-visit-bar" style="width:${(d.count / maxCount) * 100}%"></div></div>
          <span class="daily-visit-count">${d.count}</span>
        </div>
      `
    )
    .join("");

  const excludedChipsHtml = excludedRecords.length
    ? excludedRecords
        .map(
          (r) =>
            `<span class="banned-word-chip" title="${escapeHtml(r.deviceId)}">${escapeHtml(r.deviceId.slice(0, 8))}…<button data-exclude-record-id="${escapeHtml(r.id)}">✕</button></span>`
        )
        .join("")
    : `<p class="empty-state">제외 중인 기기가 없습니다.</p>`;

  document.getElementById("admin-content").innerHTML = `
    <div class="admin-section-title">내 방문 제외</div>
    <p class="empty-state">이 브라우저 기기 ID: <code>${escapeHtml(myDeviceId)}</code> — 아래에 추가하면 방문 수 집계에서 빠집니다.</p>
    <form class="banned-word-form" id="excluded-device-form">
      <input type="text" id="excluded-device-input" placeholder="제외할 기기 ID" value="${escapeHtml(myDeviceId)}" />
      <button type="submit" class="btn-primary">제외</button>
    </form>
    <div>${excludedChipsHtml}</div>
    <div class="admin-section-title">방문 현황</div>
    <div class="stat-row">
      <div class="stat-tile"><div class="num">${pageViews.length}</div><div class="label">전체 방문 수</div></div>
      <div class="stat-tile"><div class="num">${dailyCounts[0].count}</div><div class="label">오늘 방문 수</div></div>
      <div class="stat-tile"><div class="num">${Storage.getAllStories().length}</div><div class="label">전체 기억 수</div></div>
      <div class="stat-tile"><div class="num">${returningRate}%</div><div class="label">재방문 비율(근사)</div></div>
    </div>
    <div class="admin-section-title">최근 14일 방문 추이</div>
    <div class="daily-visit-chart">${dailyHtml}</div>
    <div class="admin-section-title">인기 기억 Top 10</div>
    ${topHtml}
    <div class="admin-section-title">기능별 전환율</div>
    ${funnelHtml}
    <div class="admin-section-title">그 외 이벤트</div>
    ${eventCountsHtml}
  `;

  document.getElementById("excluded-device-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("excluded-device-input");
    const deviceId = input.value.trim();
    if (!deviceId || excludedDeviceIds.includes(deviceId)) return;
    await Storage.addExcludedDevice(deviceId);
    renderVisitsTab();
  });

  document.querySelectorAll("[data-exclude-record-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await Storage.removeExcludedDevice(btn.dataset.excludeRecordId);
      renderVisitsTab();
    });
  });
}

/**
 * 회원 목록은 Cognito Admin API(ListUsers)를 거쳐서 매번 새로 불러오는 게
 * 다른 탭보다 느리다 — 탭 진입 시 한 번만 불러오고 액션 후에만 다시 부른다.
 */
async function loadMembers() {
  const { data, errors } = await client.queries.adminListUsers();
  if (errors) {
    console.error("회원 목록 조회 실패", errors);
    return [];
  }

  const { data: flags, errors: flagErrors } = await client.models.UserFlag.list();
  if (flagErrors) {
    console.error("회원 깃발 조회 실패", flagErrors);
  }
  flagsByUserId = {};
  (flags || []).forEach((f) => {
    flagsByUserId[f.userId] = f;
  });

  return [...data].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function memberRowHtml(member) {
  const isSelf = member.username === currentUsername;
  const joinedDate = member.createdAt ? member.createdAt.slice(0, 10) : "-";
  const storyCount = storyCountByUserId[member.userId] || 0;
  const flag = flagsByUserId[member.userId];

  return `
    <div class="admin-card" data-username="${escapeHtml(member.username)}">
      <div class="admin-card-meta">
        <span>${escapeHtml(member.email)}</span>
        <span>가입 ${joinedDate}</span>
        <span>작성 ${storyCount}건</span>
        <span>${member.enabled ? "정상" : "정지됨"}</span>
        <span>${member.isAdmin ? "관리자" : "일반회원"}</span>
        ${isSelf ? '<span class="admin-self-badge">나</span>' : ""}
        ${flag ? `<span class="admin-flag-badge">🚩 ${escapeHtml(flag.note || "깃발")}</span>` : ""}
      </div>
      <div class="admin-card-actions">
        <button class="btn-restore" data-action="toggle-flag" data-username="${escapeHtml(member.username)}" data-user-id="${escapeHtml(member.userId)}" data-flagged="${!!flag}">
          ${flag ? "깃발 해제" : "깃발 달기"}
        </button>
        ${isSelf
          ? ""
          : `
            <button class="btn-restore" data-action="toggle-enabled" data-username="${escapeHtml(member.username)}" data-enabled="${member.enabled}">
              ${member.enabled ? "정지" : "정지 해제"}
            </button>
            <button class="btn-restore" data-action="toggle-admin" data-username="${escapeHtml(member.username)}" data-is-admin="${member.isAdmin}">
              ${member.isAdmin ? "관리자 해제" : "관리자 지정"}
            </button>
            <button class="btn-restore" data-action="reset-password" data-username="${escapeHtml(member.username)}" data-email="${escapeHtml(member.email)}">비밀번호 재설정</button>
            <button class="btn-delete" data-action="delete-member" data-username="${escapeHtml(member.username)}">계정 삭제</button>
          `}
      </div>
    </div>
  `;
}

async function renderMembersTab() {
  clearDeviceFilterBanner();
  if (members === null) {
    document.getElementById("admin-content").innerHTML = `<p class="empty-state">불러오는 중...</p>`;
    members = await loadMembers();
  }

  const keyword = document.getElementById("member-search-input")?.value.trim() || "";
  const filtered = keyword ? members.filter((m) => m.email.includes(keyword)) : members;

  const html = filtered.length
    ? filtered.map(memberRowHtml).join("")
    : `<p class="empty-state">해당하는 회원이 없습니다.</p>`;

  document.getElementById("admin-content").innerHTML = `
    <div class="admin-section-title">회원관리 (${members.length}명)</div>
    <div class="search-row"><input type="text" id="member-search-input" placeholder="이메일 검색" value="${escapeHtml(keyword)}" /></div>
    ${html}
  `;
  document.getElementById("member-search-input").addEventListener("input", () => renderMembersTab());
}

async function handleMemberAction(action, username, dataset) {
  if (action === "toggle-flag") {
    const flagged = dataset.flagged === "true";
    if (flagged) {
      if (!confirm(`${username} 깃발을 해제할까요?`)) return;
      await client.models.UserFlag.delete({ userId: dataset.userId });
    } else {
      const note = prompt("깃발 메모(선택, 비워도 됨):", "") || "";
      await client.models.UserFlag.create({ userId: dataset.userId, note: note || null });
    }
  } else if (action === "toggle-enabled") {
    const enabled = dataset.enabled === "true";
    const verb = enabled ? "정지" : "정지 해제";
    if (!confirm(`${username} 계정을 ${verb}할까요?`)) return;
    await client.mutations.adminSetUserEnabled({ username, enabled: !enabled });
  } else if (action === "toggle-admin") {
    const isAdmin = dataset.isAdmin === "true";
    const verb = isAdmin ? "관리자 권한을 해제" : "관리자로 지정";
    if (!confirm(`${username} 계정을 ${verb}할까요?`)) return;
    await client.mutations.adminSetUserAdmin({ username, isAdmin: !isAdmin });
  } else if (action === "delete-member") {
    if (!confirm(`${username} 계정을 완전히 삭제할까요? 되돌릴 수 없습니다.`)) return;
    await client.mutations.adminDeleteUser({ username });
  } else if (action === "reset-password") {
    // 재설정 코드 메일이 스팸으로 분류돼 사용자가 스스로 복구하지 못할 때
    // 쓰는 수동 창구다(2026-08-24, SES 프로덕션 액세스 반려 상황).
    const email = dataset.email || username;
    const password = prompt(
      `${email} 계정에 설정할 새 비밀번호를 입력하세요(8자 이상).\n` +
        `여기서 정한 비밀번호를 본인 확인 후 직접 전달해야 합니다.`,
      ""
    );
    if (!password) return;
    if (password.length < 8) {
      alert("비밀번호는 8자 이상이어야 합니다.");
      return;
    }
    await client.mutations.adminSetUserPassword({ username, password });
    alert(`${email} 비밀번호를 변경했습니다.\n사용자에게 전달하고, 로그인 후 직접 변경하도록 안내해주세요.`);
  }
  members = null; // 다음 렌더에서 강제로 다시 불러오게
  renderMembersTab();
}

function renderBulkTab() {
  clearDeviceFilterBanner();
  const seedCount = Storage.getAllStories().filter((s) => s.isSeed).length;

  document.getElementById("admin-content").innerHTML = `
    <div class="admin-section-title">벌크 등록 (가라 스토리 CSV 붙여넣기)</div>
    <p class="field-hint">
      아래 프롬프트를 복사해서 ChatGPT/Claude 등에 붙여넣고, 나온 CSV를 그 밑
      textarea에 붙여넣은 뒤 "일괄 등록"을 누르세요.
    </p>
    <div class="bulk-prompt-box">
      <pre id="bulk-prompt-text">${escapeHtml(BULK_PROMPT)}</pre>
    </div>
    <button class="btn-primary" id="bulk-copy-prompt">이 프롬프트를 복사해서 하단에 붙여넣으세요</button>
    <textarea id="bulk-csv-input" class="bulk-csv-textarea" placeholder="여기에 CSV를 붙여넣으세요 (헤더 포함)"></textarea>
    <div class="admin-card-actions">
      <button class="btn-primary" id="bulk-submit">일괄 등록</button>
      <button class="btn-delete" id="bulk-delete-all">가라 스토리 전체 삭제 (${seedCount}건)</button>
    </div>
    <p class="field-hint" id="bulk-result"></p>
  `;

  document.getElementById("bulk-copy-prompt").onclick = async (e) => {
    await navigator.clipboard.writeText(BULK_PROMPT);
    const btn = e.currentTarget;
    const original = btn.textContent;
    btn.textContent = "복사됐습니다!";
    setTimeout(() => {
      btn.textContent = original;
    }, 1500);
  };

  document.getElementById("bulk-submit").onclick = handleBulkSubmit;
  document.getElementById("bulk-delete-all").onclick = handleBulkDeleteAll;
}

async function handleBulkSubmit() {
  const resultEl = document.getElementById("bulk-result");
  const raw = document.getElementById("bulk-csv-input").value.trim();
  if (!raw) {
    resultEl.textContent = "CSV를 붙여넣어주세요.";
    return;
  }

  const rows = parseCsv(raw);
  if (rows.length < 2) {
    resultEl.textContent = "헤더 + 데이터가 최소 1줄 이상 필요합니다.";
    return;
  }
  const records = csvRowsToObjects(rows);
  if (!confirm(`${records.length}개의 가라 스토리를 등록할까요?`)) return;

  resultEl.textContent = "등록 중...";
  let success = 0;
  let failed = 0;

  for (const r of records) {
    const lat = parseFloat(r.lat);
    const lng = parseFloat(r.lng);
    if (!r.content || Number.isNaN(lat) || Number.isNaN(lng)) {
      failed++;
      continue;
    }
    const hashtags = r.hashtags
      ? r.hashtags.split(";").map((t) => t.trim()).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`))
      : [];
    const hasDate = r.year && r.month;

    const story = {
      id: crypto.randomUUID(),
      publicId: Storage.generatePublicId(),
      lat,
      lng,
      placeId: null,
      officialPlaceName: null,
      address: null,
      customName: r.placeName || null,
      content: r.content,
      hashtags,
      authorMode: r.authorName ? "custom" : "anonymous",
      displayAuthorName: r.authorName || "익명",
      dateMode: hasDate ? "past" : "unknown",
      referenceDate: hasDate ? `${r.year}-${String(r.month).padStart(2, "0")}` : null,
      createdAt: new Date().toISOString(),
      reportCount: 0,
      status: "ACTIVE",
      reactionCount: parseInt(r.reactionCount, 10) || 0,
      shareCount: 0,
      viewCount: parseInt(r.viewCount, 10) || 0,
      authorDeviceId: null,
      isSeed: true,
    };

    const { errors } = await client.models.Story.create(story);
    if (errors) {
      console.error("벌크 등록 실패", errors, story);
      failed++;
    } else {
      success++;
    }
  }

  await Storage.refresh();
  resultEl.textContent = `등록 완료 — 성공 ${success}건, 실패 ${failed}건`;
}

async function handleBulkDeleteAll() {
  const seedStories = Storage.getAllStories().filter((s) => s.isSeed);
  if (seedStories.length === 0) {
    alert("삭제할 가라 스토리가 없습니다.");
    return;
  }
  if (!confirm(`가라 스토리 ${seedStories.length}개를 전부 완전히 삭제할까요? 되돌릴 수 없습니다.`)) return;

  const resultEl = document.getElementById("bulk-result");
  resultEl.textContent = "삭제 중...";
  for (const s of seedStories) {
    await Storage.deleteStory(s.id);
  }
  renderBulkTab();
}

function renderActiveTab() {
  if (activeTab === "queue") renderQueueTab();
  else if (activeTab === "all") renderAllTab();
  else if (activeTab === "words") renderWordsTab();
  else if (activeTab === "visits") renderVisitsTab();
  else if (activeTab === "members") renderMembersTab();
  else if (activeTab === "bulk") renderBulkTab();
  hydrateAdminPhotos();
}

document.getElementById("admin-content").addEventListener("click", (e) => {
  const deviceBtn = e.target.closest(".device-badge");
  if (deviceBtn) {
    setDeviceFilter(deviceBtn.dataset.device);
    return;
  }
  const actionBtn = e.target.closest("[data-action]");
  if (actionBtn) {
    if (actionBtn.dataset.username) {
      handleMemberAction(actionBtn.dataset.action, actionBtn.dataset.username, actionBtn.dataset);
    } else {
      handleCardAction(actionBtn.dataset.action, actionBtn.dataset.id);
    }
  }
});

(async function boot() {
  initFadeScrollbars();
  const outputs = await fetch(OUTPUTS_FILE).then((r) => r.json());
  Amplify.configure(outputs);

  if (await isAdminSession()) {
    await bootAdminClient();
    showDashboard();
  } else {
    showLogin();
  }
})();
