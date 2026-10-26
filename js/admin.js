// ============================================================
// 어드민 대시보드 — 신고 검토 / 전체 콘텐츠 / 금칙어 / 방문 현황
// ============================================================
// index.html과 달리 카카오 SDK 타이밍 제약이 없어서(지도 없음) 이 파일
// 하나로 Amplify Auth import + 로그인 + 데이터 로드를 전부 처리한다.
// js/storage.js는 클래식 스크립트로 그대로 재사용하되, 게스트 클라이언트
// 대신 로그인된 관리자 클라이언트를 Storage._setClient로 주입한다.

// esm.sh에서 진입점별로 따로 받으면 하위 패키지의 캐럿 범위(@aws-amplify/core@^6.x)가
// 진입점마다 다른 버전으로 풀릴 수 있다 — 실제로 core 6.19.x 배포 후 Amplify.configure는
// core@6.18.0에, signIn은 core@6.19.2에 붙어 싱글턴이 갈라지면서 "Auth UserPool not
// configured"로 어드민 로그인이 막혔다(2026-10-05). 메인 앱과 같은 버전 고정 번들을 쓴다.
import {
  Amplify,
  signIn,
  signOut,
  fetchAuthSession,
  getCurrentUser,
  generateClient,
  getUrl,
  uploadData,
} from "/js/vendor/aws-amplify.bundle.js";

const isLocalDev = ["localhost", "127.0.0.1"].includes(window.location.hostname);
// /admin(리다이렉트) 경로에서 열릴 수도 있어서 상대경로는 위험하다 — 절대경로로 고정.
const OUTPUTS_FILE = isLocalDev ? "/amplify_outputs.local.json" : "/amplify_outputs.json";

let activeTab = "queue";
let activeDeviceFilter = null;
let storyAuthorEmailById = {};
let storyCountByUserId = {};
let client = null;
// 발자취 작가 계정(Curators 그룹, 2026-10-21)도 이 페이지로 들어온다 — 작가는
// 발자취 탭만 보고 자기 코스만 다룬다. "admin" | "curator"
let sessionRole = null;
let currentUserId = null; // Cognito sub — 작가 코스의 Course.authorId
// 승인 기록(CourseApproval)과 전체 코스 slug는 작가의 userPool 권한으로는 못
// 읽어서(자기 코스만 읽힘) 메인 지도와 같은 공개 읽기(identityPool)로 읽는다.
let publicClient = null;
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

// 관리자면 "admin", 작가면 "curator", 둘 다 아니거나 로그인 전이면 null.
async function getSessionRole() {
  try {
    await getCurrentUser();
    const session = await fetchAuthSession();
    const groups = session.tokens?.idToken?.payload["cognito:groups"] || [];
    if (groups.includes("Admins")) return "admin";
    if (groups.includes("Curators")) return "curator";
    return null;
  } catch (e) {
    return null;
  }
}

async function bootAdminClient(role) {
  sessionRole = role;
  client = generateClient({ authMode: "userPool" });
  publicClient = generateClient({ authMode: "identityPool" });
  const user = await getCurrentUser();
  currentUsername = user.username;
  currentUserId = user.userId;
  // 작가는 기억·회원·방문 데이터를 읽을 권한이 없어 발자취에 필요한 것만 준비한다.
  if (role === "curator") return;
  Storage._setClient(client);
  await Storage.refresh();
  // 어드민 페이지에 로그인한 브라우저도 방문 통계에서 자동 제외(2026-10-19).
  await Storage.ensureDeviceExcluded();

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
  const isCurator = sessionRole === "curator";
  document.getElementById("admin-title").textContent = isCurator
    ? "콘크리트 사피엔스 지도 — 발자취 작가"
    : "콘크리트 사피엔스 지도 — 어드민";
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("hidden", isCurator && b.dataset.tab !== "courses");
  });
  if (isCurator) {
    activeTab = "courses";
    // 작가는 이 화면이 처음이라 안내를 폰만 빼고 펼쳐서 시작한다(2026-10-25). 운영자는 넓은 화면에서만.
    courseGuideOpen = window.matchMedia("(min-width: 768px)").matches;
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("tab-btn--active", b.dataset.tab === "courses"));
  }
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

// 예전엔 모든 실패를 "비밀번호 틀림"으로 보여줘서, Amplify 설정 오류(2026-10-05)를
// 비밀번호 문제로 착각해 원인 파악이 늦어졌다 — 실제로 자격증명이 틀린 경우에만
// 그 문구를 쓰고, 나머지는 에러 이름을 그대로 노출한다.
function getSignInErrorMessage(err) {
  if (err?.name === "NotAuthorizedException") {
    if (/attempts exceeded/i.test(err.message)) {
      return "로그인 시도가 너무 많아 잠시 막혔습니다. 잠시 후 다시 시도해주세요.";
    }
    return "이메일 또는 비밀번호가 올바르지 않습니다.";
  }
  if (err?.name === "UserNotFoundException") return "이메일 또는 비밀번호가 올바르지 않습니다.";
  if (err?.name === "UserNotConfirmedException") return "이메일 인증이 끝나지 않은 계정입니다.";
  if (err?.name === "PasswordResetRequiredException") return "비밀번호 재설정이 필요한 계정입니다.";
  return `로그인 중 오류가 발생했습니다 (비밀번호 문제 아님): ${err?.name || ""} ${err?.message || err}`;
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  // 메인 지도와 같은 도메인이라 그쪽에 관리자 아닌 계정으로 로그인돼 있으면 signIn이
  // UserAlreadyAuthenticatedException으로 막힌다(2026-10-26, concretesapiens.com) — 먼저 끊는다.
  try {
    await getCurrentUser();
    await signOut();
  } catch (e) {}

  try {
    const result = await signIn({ username: email, password });
    if (!result.isSignedIn) {
      showLogin(`로그인을 완료하지 못했습니다. (추가 단계: ${result.nextStep?.signInStep})`);
      return;
    }
  } catch (err) {
    console.error("어드민 로그인 실패", err);
    showLogin(getSignInErrorMessage(err));
    return;
  }

  const role = await getSessionRole();
  if (!role) {
    showLogin("관리자나 발자취 작가 계정이 아닙니다.");
    await signOut();
    return;
  }

  await bootAdminClient(role);
  showDashboard();
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  await signOut();
  // 다른 계정(관리자 ↔ 작가)으로 다시 들어올 때 이전 계정의 목록이 남지 않게
  courses = null;
  members = null;
  selectedCourseId = null;
  editingCourseId = null;
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
// expiresIn/캐시 TTL은 js/photoUpload.js·storySheet.js와 같은 수치로 맞춘다
// — 신고 검토 큐를 오래 열어두다 presigned URL이 만료돼 사진이 깨지는 문제가
// 실제로 있었다(2026-09-01 확인).
const ADMIN_PHOTO_URL_EXPIRES_SECONDS = 3600;
const _adminPhotoUrlCache = new Map(); // photoKey -> { promise, expiresAt }
function resolveAdminPhotoUrl(photoKey) {
  const cached = _adminPhotoUrlCache.get(photoKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise;
  }
  const expiresAt = Date.now() + (ADMIN_PHOTO_URL_EXPIRES_SECONDS - 60) * 1000;
  const promise = getUrl({ path: photoKey, options: { expiresIn: ADMIN_PHOTO_URL_EXPIRES_SECONDS } })
    .then((r) => r.url.toString())
    .catch(() => null);
  _adminPhotoUrlCache.set(photoKey, { promise, expiresAt });
  return promise;
}

function hydrateAdminPhotos() {
  document.querySelectorAll("#admin-content .admin-card-photo[data-photo-key]").forEach((el) => {
    resolveAdminPhotoUrl(el.dataset.photoKey).then((url) => {
      if (!url) { el.remove(); return; }
      const img = document.createElement("img");
      img.alt = "";
      img.src = url;
      img.style.objectPosition = `${el.dataset.focusX || 50}% ${el.dataset.focusY || 50}%`;
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
      ${story.photoKey ? `<div class="admin-card-photo" data-photo-key="${escapeHtml(story.photoKey)}" data-focus-x="${story.photoFocusX ?? 50}" data-focus-y="${story.photoFocusY ?? 50}"></div>` : ""}
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
// createdAt(UTC)을 한국 날짜(YYYY-MM-DD)로 — UTC 그대로 자르면 "어제
// 오전 9시 ~ 오늘 오전 9시"가 한 줄로 묶였다(2026-10-14).
const kstDay = (iso) => new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 10);

// 날짜별 방문 수(사이트를 연 횟수)와 순방문자 수(같은 기기는 하루 1번).
// 기기 ID가 없는 옛 기록(2026-08-25 이전)은 순방문자에서 빠진다.
function buildDailyVisitCounts(pageViews, days = 14) {
  const counts = {};
  const devices = {};
  pageViews.forEach((pv) => {
    if (!pv.createdAt) return;
    const day = kstDay(pv.createdAt);
    counts[day] = (counts[day] || 0) + 1;
    if (pv.deviceId) (devices[day] ||= new Set()).add(pv.deviceId);
  });

  const result = [];
  const now = Date.now();
  for (let i = 0; i < days; i++) {
    const key = kstDay(new Date(now - i * 86400000).toISOString());
    result.push({ date: key, count: counts[key] || 0, unique: devices[key]?.size || 0 });
  }
  return result; // 오늘이 맨 앞
}

// 어제·오늘(한국 날짜) 사이트를 많이 연 기기 — 제외 안 된 내 다른
// 브라우저(카톡 인앱 브라우저, 휴대폰 등)를 눈으로 찾아 바로 제외하려고.
function buildTopDevices(pageViews, dayKeys, limit = 10) {
  const byDevice = {};
  pageViews.forEach((pv) => {
    if (!pv.createdAt || !dayKeys.includes(kstDay(pv.createdAt))) return;
    const key = pv.deviceId || "";
    const d = (byDevice[key] ||= { deviceId: key, count: 0, first: pv.createdAt, last: pv.createdAt, deviceInfo: null });
    d.count += 1;
    if (pv.createdAt < d.first) d.first = pv.createdAt;
    if (pv.createdAt >= d.last) {
      d.last = pv.createdAt;
      // 기기 요약은 2026-10-14부터 남긴다 — 가장 최근 방문 것으로.
      if (pv.deviceInfo) d.deviceInfo = pv.deviceInfo;
    }
  });
  return Object.values(byDevice).sort((a, b) => b.count - a.count).slice(0, limit);
}

// 이벤트 타입별 개수 + "노출→확인" 전환율 — "이맘때 기억"/작성 폼 같은
// 새 기능이 실제로 쓰이는지 나중에 눈으로 확인할 수 있게 한다(2026-08-21).
// 새 이벤트 타입이 추가돼도 이 함수는 그대로 두고 FUNNEL_PAIRS에 한 줄만
// 추가하면 된다.
const FUNNEL_PAIRS = [
  { label: "이맘때 기억", openType: "throwback_opened", confirmType: "throwback_confirmed" },
  { label: "작성 폼", openType: "composer_opened", confirmType: "composer_submitted" },
  { label: "웰컴 모달 → 기억 남기기", openType: "welcome_shown", confirmType: "welcome_write_clicked" },
  { label: "웰컴 모달 → 발자취 걷기", openType: "welcome_shown", confirmType: "welcome_course_clicked" },
  // 가입 퍼널(2026-10-06) — 가입 화면 노출 → 가입 버튼 → 가입 완료.
  { label: "가입 화면 → 가입 버튼 누름", openType: "auth_shown", confirmType: "signup_submitted" },
  { label: "가입 버튼 → 가입 완료", openType: "signup_submitted", confirmType: "signup_succeeded" },
  // 비회원이 마법사에서 기억을 다 적고 게시를 눌렀을 때 가입을 요구받은
  // 횟수 → 가입/로그인 후 실제로 게시까지 간 횟수(2026-10-06).
  { label: "게시 시 가입 요구 → 가입 후 게시", openType: "publish_auth_required", confirmType: "publish_after_auth" },
  // 카카오 로그인(2026-10-06) — 버튼 클릭 → 돌아와서 로그인 완료.
  { label: "카카오 버튼 → 카카오 로그인 완료", openType: "kakao_clicked", confirmType: "kakao_login_succeeded" },
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
  { type: "visit_inapp_instagram", label: "인스타그램 인앱 브라우저 방문" },
  { type: "login_succeeded", label: "로그인 성공(기존 회원)" },
];

// 접두사 하나에 원인/화면이 뒤에 붙는 이벤트(예: "signup_failed:password_mismatch",
// "auth_cancelled:signup") — 종류가 열려 있어 고정 목록 대신 접두사로 묶어
// 세부 항목별 개수를 보여준다.
const PREFIXED_EVENT_GROUPS = [
  // 유입 경로(2026-10-19, js/app.js logVisitSource) — 탭(세션)당 1회.
  { prefix: "visit_source:", label: "유입 경로" },
  { prefix: "auth_cancelled:", label: "가입/로그인 화면 취소" },
  { prefix: "signup_failed:", label: "가입 실패" },
  { prefix: "kakao_failed:", label: "카카오 로그인 시작 실패" },
];

function buildEventCountsHtml(appEvents) {
  const counts = {};
  appEvents.forEach((e) => {
    counts[e.type] = (counts[e.type] || 0) + 1;
  });
  const standalone = STANDALONE_EVENT_LABELS.map(
    ({ type, label }) => `<div class="top-story-row"><span>${escapeHtml(label)}</span><span>${counts[type] || 0}</span></div>`
  ).join("");
  const prefixed = PREFIXED_EVENT_GROUPS.map(({ prefix, label }) =>
    Object.keys(counts)
      .filter((type) => type.startsWith(prefix))
      .sort((a, b) => counts[b] - counts[a])
      .map((type) => `<div class="top-story-row"><span>${escapeHtml(label)} — ${escapeHtml(type.slice(prefix.length))}</span><span>${counts[type]}</span></div>`)
      .join("")
  ).join("");
  return standalone + prefixed;
}

// 체류시간·이어서 읽기(2026-10-19) — app.js startDwellTracking이 남기는
// "dwell:<구간>:<on|off>", "reads:<구간>:<on|off>"를 이어서 읽기를 보는
// 기기(on)와 안 보는 기기(off)로 나눠 비율로 보여준다.
const DWELL_LABELS = ["0-30s", "30s-2m", "2-5m", "5-15m", "15m+"];
const READS_LABELS = ["0", "1", "2-3", "4-9", "10+"];
const CONTINUE_KIND_LABELS = { song: "같은 노래", year: "같은 해", tag: "같은 태그" };

function buildDwellStatsHtml(appEvents) {
  const counts = {};
  appEvents.forEach((e) => {
    counts[e.type] = (counts[e.type] || 0) + 1;
  });
  const row = (prefix, labels, variant, title) => {
    const total = labels.reduce((sum, l) => sum + (counts[`${prefix}:${l}:${variant}`] || 0), 0);
    if (!total) return `<div class="top-story-row"><span>${title}</span><span>기록 없음</span></div>`;
    const parts = labels.map((l) => `${l} ${Math.round(((counts[`${prefix}:${l}:${variant}`] || 0) / total) * 100)}%`).join(" · ");
    return `<div class="top-story-row"><span>${title}<small class="empty-state">${parts}</small></span><span>${total}구간</span></div>`;
  };
  const shown = counts.continue_reading_shown || 0;
  const clicks = Object.keys(CONTINUE_KIND_LABELS).map((k) => ({ k, n: counts[`continue_reading_clicked:${k}`] || 0 }));
  const clickTotal = clicks.reduce((sum, c) => sum + c.n, 0);
  const clickParts = clicks.map((c) => `${CONTINUE_KIND_LABELS[c.k]} ${c.n}`).join(" · ");
  return `
    ${row("dwell", DWELL_LABELS, "on", "머문 시간 — 이어서 읽기 보는 기기")}
    ${row("dwell", DWELL_LABELS, "off", "머문 시간 — 안 보는 기기")}
    ${row("reads", READS_LABELS, "on", "연 기억 카드 수 — 이어서 읽기 보는 기기")}
    ${row("reads", READS_LABELS, "off", "연 기억 카드 수 — 안 보는 기기")}
    <div class="top-story-row"><span>이어서 읽기 — 노출 ${shown} → 클릭 ${clickTotal}<small class="empty-state">${clickParts}</small></span><span>${shown > 0 ? Math.round((clickTotal / shown) * 100) : 0}%</span></div>
  `;
}

// 발자취별 반응(2026-10-19) — course.js가 남기는 "course_<단계>:<slug>"
// 이벤트를 코스마다 단계별로 센다. 발자취가 사람을 끌어오는지(링크 유입·
// 공유), 끝까지 걷게 만드는지(시작→완료) 보려는 표.
const COURSE_FUNNEL_STEPS = [
  { type: "course_detail_opened", label: "소개" },
  { type: "course_started", label: "시작" },
  { type: "course_completed", label: "완료" },
  { type: "course_write", label: "기억 쓰기 시작" },
  // 실제 게시까지 간 수(2026-10-19~) — 그 전엔 "쓰기 시작"만 셌다.
  { type: "course_write_posted", label: "게시" },
  { type: "course_shared", label: "공유" },
  { type: "course_link_opened", label: "링크 유입" },
  // 지도 위 발자취 배지를 눌러 시작한 수(2026-10-20~)
  { type: "course_map_badge_clicked", label: "지도 배지" },
];

function buildCourseStatsHtml(appEvents, courseList, courseViewCounts = []) {
  const bySlug = {};
  appEvents.forEach((e) => {
    const i = e.type.indexOf(":");
    if (i < 0 || !e.type.startsWith("course_")) return;
    const step = e.type.slice(0, i);
    const slug = e.type.slice(i + 1);
    ((bySlug[slug] ||= {})[step] = (bySlug[slug][step] || 0) + 1);
  });
  const slugs = Object.keys(bySlug);
  if (!slugs.length) return `<p class="empty-state">아직 발자취 기록이 없습니다.</p>`;
  const titleOf = (slug) => courseList?.find((c) => c.slug === slug)?.title || slug;
  const opened = (slug) => bySlug[slug].course_detail_opened || 0;
  return slugs
    .sort((a, b) => opened(b) - opened(a))
    .map((slug) => {
      const c = bySlug[slug];
      const started = c.course_started || 0;
      const rate = started > 0 ? ` · 완주 ${Math.round(((c.course_completed || 0) / started) * 100)}%` : "";
      const courseId = courseList?.find((x) => x.slug === slug)?.id;
      const views = courseViewCounts.find((v) => v.courseId === courseId)?.count || 0;
      const steps = [`조회 ${views}회`, ...COURSE_FUNNEL_STEPS.map((st) => `${st.label} ${c[st.type] || 0}`)].join(" · ");
      return `<div class="top-story-row"><span>${escapeHtml(titleOf(slug))}<small class="empty-state">${steps}${rate}</small></span></div>`;
    })
    .join("");
}

// 발자취별 일일 조회(2026-10-24) — 조회수(CourseViewCount)는 누적 숫자 하나라 날짜로 못
// 나눠서, 같은 사건(걸을 때마다 +1)인 "course_started:<slug>" 이벤트를 한국 날짜별로 센다.
// 누적 "조회 N회"는 장소 카드를 한 장이라도 본 경우만 세서 이 숫자와 조금 다를 수 있다.
// appEvents는 어드민 기기를 이미 뺀 목록이다(deviceId가 남기 시작한 10/19 이전은 못 거른다).
function buildCourseDailyHtml(appEvents, courseList, days = 14) {
  const bySlug = {};
  appEvents.forEach((e) => {
    if (!e.createdAt || !e.type.startsWith("course_started:")) return;
    const slug = e.type.slice("course_started:".length);
    const day = kstDay(e.createdAt);
    const c = (bySlug[slug] ||= {});
    c[day] = (c[day] || 0) + 1;
  });
  const now = Date.now();
  const dayKeys = Array.from({ length: days }, (_, i) => kstDay(new Date(now - i * 86400000).toISOString())); // 오늘이 맨 앞
  const rows = Object.entries(bySlug)
    .map(([slug, counts]) => {
      const series = dayKeys.map((date) => ({ date, count: counts[date] || 0 }));
      return { slug, series, total: series.reduce((sum, d) => sum + d.count, 0) };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
  if (!rows.length) return `<p class="empty-state">최근 ${days}일 안에 걷기 시작한 기록이 없습니다.</p>`;
  return rows
    .map((r, idx) => {
      const title = courseList?.find((c) => c.slug === r.slug)?.title || r.slug;
      const max = Math.max(1, ...r.series.map((d) => d.count));
      const bars = r.series
        .map(
          (d) => `
          <div class="daily-visit-row">
            <span class="daily-visit-date">${d.date.slice(5)}</span>
            <div class="daily-visit-bar-track"><div class="daily-visit-bar" style="width:${(d.count / max) * 100}%"></div></div>
            <span class="daily-visit-count">${d.count}회</span>
          </div>`
        )
        .join("");
      return `<details class="course-daily"${idx === 0 ? " open" : ""}>
        <summary><span>${escapeHtml(title)}</span><small class="empty-state">오늘 ${r.series[0].count} · 어제 ${r.series[1].count} · ${days}일 ${r.total}</small></summary>
        <div class="daily-visit-chart">${bars}</div>
      </details>`;
    })
    .join("");
}

// 발자취 조회수 지난 기록 채우기(2026-10-23, 한 번만) — 조회수(CourseViewCount)는
// 배포 시각부터 0으로 시작했다. 그 전에 장소 카드에 들어간 기록 중 가장 가까운
// 이벤트(시작·이어 걷기·새 장소 먼저 보기)를 세서 더한다. deviceId가 있는
// 이벤트(10-19~)는 기기당 1번, 없는 그 전 이벤트는 한 사람이 여러 번 시작한 것도
// 그대로 세져 부풀려진다 — 미리보기에서 둘을 나눠 보여준다.
const COURSE_VIEW_COUNT_SINCE = "2026-10-23T06:07:43Z"; // 조회수 배포(c406450) 시각
const COURSE_VIEW_BACKFILL_DONE = "course_view_backfilled";
const COURSE_VIEW_BACKFILL_STEPS = ["course_started", "course_resumed", "course_new_opened"];

function computeCourseViewBackfill(appEvents, courseList) {
  const bySlug = {};
  appEvents.forEach((e) => {
    if (!e.createdAt || e.createdAt >= COURSE_VIEW_COUNT_SINCE) return;
    const i = e.type.indexOf(":");
    if (i < 0 || !COURSE_VIEW_BACKFILL_STEPS.includes(e.type.slice(0, i))) return;
    const c = (bySlug[e.type.slice(i + 1)] ||= { devices: new Set(), legacy: 0 });
    if (e.deviceId) c.devices.add(e.deviceId);
    else c.legacy += 1;
  });
  return Object.entries(bySlug)
    .map(([slug, c]) => {
      const course = courseList?.find((x) => x.slug === slug);
      return { slug, courseId: course?.id, title: course?.title || slug, devices: c.devices.size, legacy: c.legacy };
    })
    .filter((r) => r.courseId) // 지워진 코스는 넣을 곳이 없다
    .sort((a, b) => b.devices + b.legacy - (a.devices + a.legacy));
}

async function applyCourseViewBackfill(rows, currentCounts) {
  for (const r of rows) {
    const add = r.devices + r.legacy;
    if (!add) continue;
    const existing = currentCounts.find((v) => v.courseId === r.courseId);
    const count = (existing?.count || 0) + add;
    const res = existing
      ? await client.models.CourseViewCount.update({ courseId: r.courseId, count })
      : await client.models.CourseViewCount.create({ courseId: r.courseId, count });
    if (res?.errors) throw new Error(`${r.title}: ${res.errors.map((e) => e.message).join(", ")}`);
  }
  // 두 번 더해지지 않게 끝난 표시를 남긴다(AppEvent create는 identityPool만 허용)
  const done = await publicClient.models.AppEvent.create({ type: COURSE_VIEW_BACKFILL_DONE, deviceId: Storage.getDeviceId() });
  if (done?.errors) console.error("지난 기록 채우기 완료 표시 실패", done.errors);
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
  const allAppEvents = await Storage.listAppEvents();
  const myDeviceId = Storage.getDeviceId();
  const excludedRecords = await Storage.listExcludedDevices();
  const excludedDeviceIds = excludedRecords.map((r) => r.deviceId);
  // 방문 수와 이벤트(발자취 반응·전환율 등) 집계에서 뺀다. AppEvent는
  // 2026-10-19부터 deviceId를 남겨서, 그 전 이벤트는 못 거르고 그대로 센다.
  // 인기 기억 Top10(viewCount)은 별도 카운터라 범위 밖(2026-08-25).
  // viewCount는 2026-10-19부터 "브라우저당 1번·작성자 본인 제외"로 센다
  // (storage.js incrementViewCount) — 그 전 값은 열 때마다 +1이라 더 크다.
  const pageViews = allPageViews.filter((pv) => !excludedDeviceIds.includes(pv.deviceId));
  const appEvents = allAppEvents.filter((e) => !e.deviceId || !excludedDeviceIds.includes(e.deviceId));
  const dailyCounts = buildDailyVisitCounts(pageViews);
  const maxCount = Math.max(1, ...dailyCounts.map((d) => d.count));
  const funnelHtml = buildFunnelHtml(appEvents);
  if (courses === null) {
    try {
      await loadCourses();
    } catch (e) {
      courses = null; // 제목 없이 slug로만 보여준다
    }
  }
  // 발자취 조회수(2026-10-23) — 이벤트가 아니라 CourseViewCount의 누적 숫자라
  // 어드민 기기 제외가 안 된다(걸을 때마다 +1이라 어드민이 본 횟수도 섞인다).
  const courseViewCounts = publicClient.models.CourseViewCount
    ? await listAllRecords(publicClient.models.CourseViewCount).catch((e) => {
      console.error("발자취 조회수 불러오기 실패", e);
      return [];
    })
    : [];
  const courseStatsHtml = buildCourseStatsHtml(appEvents, courses, courseViewCounts);
  const courseDailyHtml = buildCourseDailyHtml(appEvents, courses);
  // 완료 표시는 어드민 기기가 남기니 기기 제외 전 목록에서 찾는다
  const backfillDone = allAppEvents.some((e) => e.type === COURSE_VIEW_BACKFILL_DONE);
  const backfillRows = backfillDone || !publicClient.models.CourseViewCount ? [] : computeCourseViewBackfill(appEvents, courses);
  const backfillHtml = backfillRows.length
    ? `<p class="empty-state">조회수는 10/23 배포부터 셌어요. 그 전 기록(시작·이어 걷기·새 장소 보기)으로 한 번만 채울 수 있어요 — 10/19부터는 기기당 1번, 그 전은 기기 구분이 없어 여러 번 시작한 것도 세져요.</p>
      ${backfillRows.map((r) => `<div class="top-story-row"><span>${escapeHtml(r.title)}<small class="empty-state">기기 기준 ${r.devices} + 10/19 전 ${r.legacy}</small></span><span>+${r.devices + r.legacy}</span></div>`).join("")}
      <button type="button" class="btn-primary" id="course-view-backfill">지난 기록으로 조회수 채우기</button>`
    : "";
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
          <span class="daily-visit-count">${d.unique}명 · ${d.count}회</span>
        </div>
      `
    )
    .join("");

  const kstTime = (iso) =>
    new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const topDevices = buildTopDevices(pageViews, [dailyCounts[0].date, dailyCounts[1].date]);
  const topDevicesHtml = topDevices.length
    ? topDevices
        .map(
          (d) => `
            <div class="top-story-row">
              <span title="${escapeHtml(d.deviceId)}">${d.deviceId ? `${escapeHtml(d.deviceId.slice(0, 8))}…` : "(기기 ID 없음)"}${d.deviceId === myDeviceId ? " (이 브라우저)" : ""}
                <small class="empty-state">${d.deviceInfo ? `${escapeHtml(d.deviceInfo)} · ` : ""}${kstTime(d.first)} ~ ${kstTime(d.last)}</small></span>
              <span>${d.count}회 ${d.deviceId ? `<button type="button" class="btn-secondary" data-exclude-device="${escapeHtml(d.deviceId)}">제외</button>` : ""}</span>
            </div>`
        )
        .join("")
    : `<p class="empty-state">어제·오늘 방문이 없습니다.</p>`;

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
    <p class="empty-state">이 브라우저 기기 ID: <code>${escapeHtml(myDeviceId)}</code> — 아래에 추가하면 방문 수·이벤트 집계에서 빠집니다.</p>
    <form class="banned-word-form" id="excluded-device-form">
      <input type="text" id="excluded-device-input" placeholder="제외할 기기 ID" value="${escapeHtml(myDeviceId)}" />
      <button type="submit" class="btn-primary">제외</button>
    </form>
    <div>${excludedChipsHtml}</div>
    <div class="admin-section-title">방문 현황</div>
    <div class="stat-row">
      <div class="stat-tile"><div class="num">${pageViews.length}</div><div class="label">전체 방문 수</div></div>
      <div class="stat-tile"><div class="num">${dailyCounts[0].count}</div><div class="label">오늘 방문 수</div></div>
      <div class="stat-tile"><div class="num">${dailyCounts[0].unique}</div><div class="label">오늘 순방문자</div></div>
      <div class="stat-tile"><div class="num">${Storage.getAllStories().length}</div><div class="label">전체 기억 수</div></div>
      <div class="stat-tile"><div class="num">${returningRate}%</div><div class="label">재방문 비율(근사)</div></div>
    </div>
    <div class="admin-section-title">최근 14일 방문 추이 (한국 날짜 · 순방문자 · 연 횟수)</div>
    <div class="daily-visit-chart">${dailyHtml}</div>
    <div class="admin-section-title">어제·오늘 많이 연 기기</div>
    <p class="empty-state">같은 기기가 여러 번 열면 여기 위로 올라와요. 내 다른 브라우저(카톡 안 브라우저, 휴대폰 등)면 바로 제외하세요.</p>
    ${topDevicesHtml}
    <div class="admin-section-title">체류시간 · 이어서 읽기 (화면이 보이던 구간 단위 · 2026-10-19~)</div>
    ${buildDwellStatsHtml(appEvents)}
    <div class="admin-section-title">발자취 반응 (전체 기간 · 발자취 버튼 ${appEvents.filter((e) => e.type === "course_toolbar_clicked").length}회)</div>
    ${courseStatsHtml}
    ${backfillHtml}
    <div class="admin-section-title">발자취 일일 조회 (최근 14일 · 걷기 시작 기준, 한국 날짜)</div>
    <p class="empty-state">코스를 걷기 시작한 횟수예요. 위 누적 "조회 N회"는 장소 카드를 한 장이라도 본 경우만 세서 조금 다를 수 있어요. 10/19 전 기록은 내 기기를 못 걸러요.</p>
    ${courseDailyHtml}
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

  document.querySelectorAll("[data-exclude-device]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      await Storage.addExcludedDevice(btn.dataset.excludeDevice);
      renderVisitsTab();
    });
  });

  document.getElementById("course-view-backfill")?.addEventListener("click", async (e) => {
    const total = backfillRows.reduce((sum, r) => sum + r.devices + r.legacy, 0);
    if (!confirm(`발자취 ${backfillRows.length}개에 조회수 합계 ${total}을 더합니다. 한 번만 할 수 있어요. 진행할까요?`)) return;
    e.target.disabled = true;
    try {
      await applyCourseViewBackfill(backfillRows, courseViewCounts);
    } catch (err) {
      console.error("지난 기록 채우기 실패", err);
      alert(`채우다 실패했어요 — ${err.message}`);
    }
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
        ${member.isCurator ? "<span>발자취 작가</span>" : ""}
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
            <button class="btn-restore" data-action="toggle-curator" data-username="${escapeHtml(member.username)}" data-is-curator="${member.isCurator}">
              ${member.isCurator ? "작가 해제" : "작가 지정"}
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
  } else if (action === "toggle-curator") {
    const isCurator = dataset.isCurator === "true";
    const msg = isCurator
      ? `${username} 계정의 발자취 작가 권한을 해제할까요?\n이미 만든 발자취는 그대로 남고, 관리는 관리자가 이어서 할 수 있어요.`
      : `${username} 계정을 발자취 작가로 지정할까요?\n${window.location.origin}/admin.html 에서 자기 발자취를 만들고 관리할 수 있어요. 공개는 관리자 승인 후에 돼요.`;
    if (!confirm(msg)) return;
    await client.mutations.adminSetUserCurator({ username, isCurator: !isCurator });
    alert(isCurator ? "해제했어요." : "지정했어요. 작가가 이미 로그인해 있었다면 로그아웃 후 다시 로그인해야 반영돼요.");
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

// ------------------------------------------------------------
// 발자취(코스) 관리 — 여러 장소를 순서대로 묶은 큐레이션(2026-10-13).
// 첫 코스는 책 『콘크리트 사피엔스』 속 장소. 모델은 amplify/data/
// resource.ts의 Course/CoursePlace. 장소 좌표는 손으로 입력하지 않고
// 카카오 장소 검색으로 고른다 — 어드민 화면엔 원래 지도가 없어서
// 카카오 SDK를 이 탭에 들어올 때만 불러온다.
// ------------------------------------------------------------
const COURSE_KINDS = [
  { value: "book", label: "책" },
  { value: "person", label: "인물" },
  { value: "influencer", label: "크리에이터" },
  { value: "drama", label: "드라마·영화" },
  { value: "music", label: "음악" },
  { value: "org", label: "단체" },
  { value: "etc", label: "기타" },
];

let courses = null; // 발자취 탭 첫 진입 때 로드(지연 로딩) — 작가는 자기 코스만
let coursePlacesById = {}; // courseId -> CoursePlace[] (seq 순)
let approvedCourseIds = new Set(); // CourseApproval — 승인된 작가 코스
let allCourseSlugs = []; // [{ id, slug }] 전체 코스 — 작가도 남의 slug와 겹치지 않게
let curatorEmailById = {}; // 관리자 화면에서 작가 코스 옆에 보여줄 작가 이메일(userId -> email)
let handoverCourseId = null; // "작가에게 넘기기" 선택창이 열린 코스(운영자 화면)
let selectedCourseId = null; // 장소 관리 중인 코스
let editingCourseId = null; // null이면 "새 코스" 폼
let editingPlaceId = null; // null이면 "장소 추가" 폼
let placeDraft = null; // 카카오 검색에서 고른 { name, address, lat, lng }
// 장소 폼의 사진 칸들(최대 COURSE_PLACE_PHOTO_MAX장, 2026-10-16) —
// [{ key, file, focus: { x, y }, title, credit }], 앞이 1번(대표). key는 이미
// 올라간 사진, file은 새로 고른 사진(저장할 때 올린다). 검색 결과를 고르면
// 폼을 다시 그리는데 <input type=file> 값과 끌어둔 크롭은 되살릴 수 없어서
// 여기 들고 있는다. null이면 수정 중인 장소의 저장값으로 다시 채운다.
let placePhotoSlots = null;

// list()는 한 번에 최대 100건이라 nextToken을 끝까지 따라간다. GraphQL
// 에러는 reject가 아니라 errors 배열로 오므로 직접 확인해서 던진다.
async function listAllRecords(model) {
  const all = [];
  let nextToken = null;
  do {
    const { data, errors, nextToken: next } = await model.list({ limit: 1000, nextToken });
    if (errors?.length) throw new Error(errors.map((e) => e.message).join(", "));
    all.push(...(data || []));
    nextToken = next;
  } while (nextToken);
  return all;
}

// create/update/delete 공통 — 실패를 조용히 삼키지 않고 알린다.
async function runCourseMutation(promise, failMessage) {
  try {
    const { data, errors } = await promise;
    if (errors?.length) {
      console.error(failMessage, errors);
      alert(`${failMessage}\n${errors.map((e) => e.message).join("\n")}`);
      return null;
    }
    return data;
  } catch (e) {
    console.error(failMessage, e);
    alert(`${failMessage}\n${e.message || e}`);
    return null;
  }
}

// 저장이 끝나기 전에 버튼을 한 번 더 누르면 같은 장소가 두 줄 만들어졌다
// (2026-10-14 카페서연의집 — 사진 업로드 동안 0.6초 차이로 두 번 create).
// 진행 중엔 다시 눌려도 무시하고 저장 버튼을 잠근다.
function guardDoubleSubmit(handler) {
  let busy = false;
  return async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    const btn = e.target.querySelector('button[type="submit"], button:not([type])');
    if (btn) btn.disabled = true;
    try {
      await handler(e);
    } finally {
      busy = false;
      if (btn?.isConnected) btn.disabled = false;
    }
  };
}

async function loadCourses() {
  const isCurator = sessionRole === "curator";
  // 작가의 userPool 목록은 서버가 authorId = 자기 sub인 것만 돌려준다(owner 규칙).
  const [courseList, placeList, approvals, publicCourses] = await Promise.all([
    listAllRecords(client.models.Course),
    listAllRecords(client.models.CoursePlace),
    listAllRecords(publicClient.models.CourseApproval),
    isCurator ? listAllRecords(publicClient.models.Course) : null,
  ]);
  if (!isCurator && members === null) {
    try {
      members = await loadMembers();
    } catch (e) {
      console.error("작가 이메일 불러오기 실패", e); // 이메일 없이 sub 앞자리로 보여준다
    }
  }
  curatorEmailById = Object.fromEntries((members || []).map((m) => [m.userId, m.email]));
  approvedCourseIds = new Set(approvals.map((a) => a.courseId));
  allCourseSlugs = (publicCourses || courseList).map((c) => ({ id: c.id, slug: c.slug }));
  courses = courseList
    .filter((c) => !isCurator || c.authorId === currentUserId)
    .sort(Storage.compareCourseOrder);
  const courseById = Object.fromEntries(courses.map((c) => [c.id, c]));
  coursePlacesById = {};
  placeList.forEach((p) => {
    // 메인 지도와 같은 기준 — 코스와 authorId가 다른 장소는 붙이지 않는다
    // (js/storage.js fetchPublishedCourses).
    const course = courseById[p.courseId];
    if (!course || (p.authorId || null) !== (course.authorId || null)) return;
    (coursePlacesById[p.courseId] ||= []).push(p);
  });
  Object.values(coursePlacesById).forEach((list) => list.sort((a, b) => a.seq - b.seq));
}

let _kakaoServicesPromise = null;
function loadKakaoServices() {
  if (window.kakao?.maps?.services) return Promise.resolve();
  if (!_kakaoServicesPromise) {
    _kakaoServicesPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${CONFIG.KAKAO_APP_KEY}&autoload=false&libraries=services`;
      script.onload = () => window.kakao.maps.load(resolve);
      script.onerror = () => {
        _kakaoServicesPromise = null;
        reject(new Error("카카오 SDK 로드 실패"));
      };
      document.head.appendChild(script);
    });
  }
  return _kakaoServicesPromise;
}

function kakaoMapLink(name, lat, lng) {
  return `https://map.kakao.com/link/map/${encodeURIComponent(name)},${lat},${lng}`;
}

// 작가 코스는 isPublished가 "공개 요청"이라 승인 여부와 묶어서 상태를 말한다.
function courseStatusLabel(course) {
  if (!course.authorId) return course.isPublished ? "공개" : "비공개";
  const approved = approvedCourseIds.has(course.id);
  if (!course.isPublished) return approved ? "승인됨 · 작가가 내림" : "작성 중";
  return approved ? "공개" : "승인 대기";
}

function isCourseLive(course) {
  return Storage.isCourseLive(course, approvedCourseIds);
}

function courseAuthorLabel(course) {
  if (!course.authorId) return "운영자";
  return `작가 ${curatorEmailById[course.authorId] || course.authorId.slice(0, 8)}`;
}

// "작가에게 넘기기"(2026-10-25) — 운영자가 만든 코스를 작가(Curators) 계정의 것으로 바꾼다.
// 코스와 소속 장소의 authorId를 그 작가의 sub로 바꾸면 작가가 자기 "내 발자취"에서 고칠 수
// 있다(amplify/data/resource.ts Course·CoursePlace의 owner 규칙). 비공개 코스만 넘긴다 —
// 작가 코스는 공개 승인(CourseApproval)이 있어야 지도에 보이므로, 공개 중인 코스를 승인 없이
// 넘기면 지도에서 사라진다. 넘긴 뒤 공개는 작가의 "공개 요청" → 운영자 "승인" 순서다.
function courseHandoverHtml(course) {
  const curators = (members || []).filter((m) => m.isCurator && m.userId);
  if (!curators.length) {
    return `<p class="field-hint course-handover">넘길 작가가 없어요. 회원 탭에서 그 회원을 먼저 "작가 지정"해주세요.
      <button class="btn-delete" data-course-action="handover-cancel" data-course-id="${course.id}">닫기</button></p>`;
  }
  return `
    <div class="admin-card-actions course-handover">
      <select id="course-handover-select">
        ${curators.map((m) => `<option value="${escapeHtml(m.userId)}">${escapeHtml(m.email || m.username)}</option>`).join("")}
      </select>
      <button class="btn-restore" data-course-action="handover-confirm" data-course-id="${course.id}">넘기기</button>
      <button class="btn-delete" data-course-action="handover-cancel" data-course-id="${course.id}">취소</button>
    </div>`;
}

async function handoverCourse(course, authorId) {
  const places = coursePlacesById[course.id] || [];
  const author = (members || []).find((m) => m.userId === authorId);
  const authorLabel = author?.email || author?.username || authorId.slice(0, 8);
  if (!confirm(`"${course.title}" 코스와 장소 ${places.length}곳을 ${authorLabel} 작가에게 넘길까요?\n비공개 그대로 넘어가고, 그 작가의 "내 발자취"에 보여요. 공개는 운영자가 카드의 "공개하기"를 누르거나, 작가가 공개 요청하면 승인해서 할 수 있어요.`)) return false;
  // 장소 먼저, 코스는 마지막 — 중간에 실패하면 이미 바꾼 장소를 되돌린다
  // (코스와 authorId가 다른 장소는 화면에서 안 보이므로 반쯤 바뀐 채 두면 안 된다).
  const done = [];
  const rollback = async () => {
    for (const p of done) await client.models.CoursePlace.update({ id: p.id, authorId: null });
  };
  for (const p of places) {
    const updated = await runCourseMutation(client.models.CoursePlace.update({ id: p.id, authorId }), "장소 넘기기 실패");
    if (!updated) {
      await rollback();
      return false;
    }
    done.push(updated);
  }
  const updatedCourse = await runCourseMutation(client.models.Course.update({ id: course.id, authorId }), "코스 넘기기 실패");
  if (!updatedCourse) {
    await rollback();
    return false;
  }
  courses = courses.map((c) => (c.id === updatedCourse.id ? updatedCourse : c));
  coursePlacesById[course.id] = places.map((p) => done.find((d) => d.id === p.id) || p);
  alert(`넘겼어요. ${authorLabel} 작가의 "내 발자취"에 보여요. (장소 ${done.length}곳)`);
  return true;
}

// "운영자로 되찾기"(2026-10-25) — 작가에게 넘긴(또는 작가가 만든) 코스를 다시 운영자 코스로.
// 넘기기의 반대로 장소 먼저, 코스는 마지막에 authorId를 비우고, 중간에 실패하면 장소를 되돌린다.
// 운영자 코스는 승인 없이 isPublished만으로 지도에 보이므로, 승인 전 "공개 요청" 상태였던 코스는
// 되찾는 순간 공개되지 않게 비공개로 돌린다. 승인 기록은 지운다 — 남겨두면 나중에 다시 넘길 때
// 확인 없이 바로 승인된 상태가 된다. 되찾으면 작가의 "내 발자취"에서는 사라진다.
async function reclaimCourse(course) {
  const places = coursePlacesById[course.id] || [];
  const approved = approvedCourseIds.has(course.id);
  const unpublish = course.isPublished && !approved;
  const authorId = course.authorId;
  if (!confirm(`"${course.title}" 코스와 장소 ${places.length}곳을 운영자 코스로 되찾을까요?\n${courseAuthorLabel(course)}의 "내 발자취"에서는 사라지고, 더는 고칠 수 없어요.${unpublish ? "\n승인 전 공개 요청 상태라 비공개로 돌려서 가져와요." : ""}`)) return false;
  const done = [];
  const rollback = async () => {
    for (const p of done) await client.models.CoursePlace.update({ id: p.id, authorId });
  };
  for (const p of places) {
    const updated = await runCourseMutation(client.models.CoursePlace.update({ id: p.id, authorId: null }), "장소 되찾기 실패");
    if (!updated) {
      await rollback();
      return false;
    }
    done.push(updated);
  }
  const updatedCourse = await runCourseMutation(
    client.models.Course.update({ id: course.id, authorId: null, ...(unpublish ? { isPublished: false } : {}) }),
    "코스 되찾기 실패",
  );
  if (!updatedCourse) {
    await rollback();
    return false;
  }
  courses = courses.map((c) => (c.id === updatedCourse.id ? updatedCourse : c));
  coursePlacesById[course.id] = places.map((p) => done.find((d) => d.id === p.id) || p);
  if (approved && await runCourseMutation(client.models.CourseApproval.delete({ courseId: course.id }), "승인 기록 지우기 실패")) {
    approvedCourseIds.delete(course.id);
  }
  alert(`되찾았어요. 이제 운영자 코스예요. (장소 ${done.length}곳)`);
  return true;
}

function courseCardHtml(course) {
  const places = coursePlacesById[course.id] || [];
  const kindLabel = COURSE_KINDS.find((k) => k.value === course.kind)?.label || course.kind || "-";
  const isSelected = course.id === selectedCourseId;
  const isCurator = sessionRole === "curator";
  const approved = approvedCourseIds.has(course.id);
  const publishLabel = isCurator
    ? (course.isPublished ? (approved ? "비공개로" : "공개 요청 취소") : "공개 요청")
    : (course.isPublished ? "비공개로" : "공개하기");
  return `
    <div class="admin-card${isSelected ? " course-card--selected" : ""}">
      <p class="admin-card-content"><b>${escapeHtml(course.title)}</b></p>
      <div class="admin-card-meta">
        <span>${escapeHtml(course.slug)}</span>
        <span>${escapeHtml(kindLabel)}</span>
        <span>장소 ${places.length}곳</span>
        <span>${courseStatusLabel(course)}</span>
        ${isCurator ? "" : `<span>${escapeHtml(courseAuthorLabel(course))}</span>`}
        ${isCurator ? "" : (course.sortOrder > 0 ? `<span>고정 ${course.sortOrder}</span>` : "")}
        ${course.logoKey ? `<span>로고 있음</span>` : ""}
        ${course.coverKey ? `<span>표지 있음</span>` : ""}
      </div>
      ${course.description ? `<p class="field-hint">${escapeHtml(course.description)}</p>` : ""}
      <div class="admin-card-actions">
        <button class="btn-restore" data-course-action="select" data-course-id="${course.id}">${isSelected ? "장소 관리 닫기" : "장소 관리"}</button>
        <button class="btn-restore" data-course-action="edit" data-course-id="${course.id}">수정</button>
        <button class="btn-restore" data-course-action="toggle-publish" data-course-id="${course.id}">${publishLabel}</button>
        ${!isCurator && course.authorId ? `<button class="btn-restore" data-course-action="toggle-approval" data-course-id="${course.id}">${approved ? "승인 취소" : "승인"}</button>` : ""}
        ${!isCurator && !course.authorId ? `<button class="btn-restore" data-course-action="handover" data-course-id="${course.id}">작가에게 넘기기</button>` : ""}
        ${!isCurator && course.authorId ? `<button class="btn-restore" data-course-action="reclaim" data-course-id="${course.id}">운영자로 되찾기</button>` : ""}
        <button class="btn-restore" data-course-action="copy-link" data-course-id="${course.id}">링크 복사</button>
        <button class="btn-delete" data-course-action="delete" data-course-id="${course.id}">삭제</button>
      </div>
      ${!isCurator && handoverCourseId === course.id ? courseHandoverHtml(course) : ""}
    </div>
  `;
}

// ------------------------------------------------------------
// "어디에 보이나요?" 예시(2026-10-21) — 작가 계정이 생기면서 코스 폼의
// 칸(이름·저자·부제…)이 실제 화면 어디에 나오는지 몰라 헤맬 수 있어서,
// 발자취 탭 오른쪽 여백에 실제 코스(콘크리트 사피엔스) 화면을 캡처해 두고
// 입력 칸을 누르면 그 내용이 나오는 자리를 표시한다. 캡처는 폰 크기(390px)
// 화면이고, 표시 상자 좌표는 캡처할 때 요소 위치를 그대로 잰 값(CSS px)이다 —
// 코스 화면 디자인이 크게 바뀌면 assets/course-guide/의 캡처와 같이 다시 잰다.
// ------------------------------------------------------------
const COURSE_GUIDE_SCREENS = {
  list: {
    label: "발자취 목록",
    img: "/assets/course-guide/list.jpg",
    size: [343, 726],
    spots: { cover: [37, 309, 68, 91], title: [119, 309, 137, 23], author: [119, 336, 68, 20], description: [119, 362, 157, 21], kind: [119, 389, 98, 19] },
  },
  detail: {
    label: "소개 화면",
    img: "/assets/course-guide/detail.jpg",
    size: [350, 654],
    spots: { cover: [110, 66, 130, 170], title: [20, 285, 310, 31], description: [20, 325, 310, 22], intro: [20, 365, 310, 168], linkUrl: [100, 14, 80, 36] },
  },
  place: {
    label: "장소 카드",
    img: "/assets/course-guide/place.jpg",
    size: [390, 844],
    spots: { song: [16, 18, 358, 58], logo: [166, 77, 59, 71], photo: [42, 310, 306, 172], photoMeta: [42, 492, 306, 37], title: [42, 549, 150, 31], label: [42, 592, 306, 20], name: [42, 618, 306, 34], quote: [42, 670, 306, 143] },
  },
};

// 폼 칸 하나 = 예시의 한 항목. spots의 키가 위 화면의 같은 이름 상자다.
// 화면에 안 나오는 칸(slug 등)은 설명만 보여준다.
const COURSE_GUIDE_FIELDS = [
  { key: "title", name: "이름", screens: ["list", "detail", "place"], text: "목록 카드 제목, 소개 화면의 큰 제목, 따라 걷는 동안 장소 카드 윗줄에 나와요." },
  { key: "author", name: "저자", screens: ["list"], text: "목록에서 제목 아래 \"나종익 지음\"처럼 나와요. 종류가 음악·크리에이터면 이름만, 드라마·영화면 \"연출\", 기타면 \"운영\"이 붙어요." },
  { key: "kind", name: "종류", screens: ["list"], text: "목록의 \"책 · 장소 20곳\" 줄에 나오고, 표지 모양도 정해요(책은 입체 책, 인물은 폴라로이드, 음악은 정사각형)." },
  { key: "description", name: "부제(한 줄)", screens: ["list", "detail"], text: "목록에서는 저자 아래, 소개 화면에서는 큰 제목 바로 아래에 나와요." },
  { key: "intro", name: "책·작품 소개", screens: ["detail"], text: "소개 화면의 본문이에요. 표지 아래 큰 글로 나와요." },
  { key: "cover", name: "표지", screens: ["list", "detail"], text: "목록 왼쪽 작은 표지, 소개 화면 맨 위의 큰 표지로 나와요." },
  { key: "logo", name: "로고", screens: ["place"], text: "따라 걷는 동안 지도 위 장소 핀(동그라미)에 들어가요." },
  { key: "linkUrl", name: "바깥 링크", screens: ["detail"], text: "소개 화면 위쪽에 버튼으로 나와요. 인스타그램·유튜브 주소면 그 아이콘과 이름으로, 그 밖이면 \"더 알아보기\"로 보여요(이 예시엔 링크가 없어서 버튼 자리만 표시했어요)." },
  { key: "slug", name: "영문 식별자", screens: [], text: "화면에는 안 나오고 공유 링크 주소 끝에 붙어요. 예: concretesapiens.com/?course=concrete-sapiens" },
  { key: "photo", name: "장소 사진", screens: ["place"], text: "장소 카드 맨 위에 나와요. 보통은 가로(16:9)로, 코스의 \"장소 사진 모양\"이 세로면 3:4로 잘려 나와요. 여러 장이면 옆으로 넘겨 봐요." },
  { key: "photoMeta", name: "사진 제목·출처", screens: ["place"], text: "사진 바로 아래 작은 글씨로 나와요. 출처는 \"출처 | 서울기록원\"처럼 보여요." },
  { key: "label", name: "꼬리표", screens: ["place"], text: "장소 이름 위에 주황색 작은 글씨로 나와요. 책이면 쪽수나 장 제목을 적어요." },
  { key: "name", name: "지도에 보일 이름", screens: ["place"], text: "장소 카드의 큰 제목이에요." },
  { key: "quote", name: "인용", screens: ["place"], text: "장소 이름 아래 왼쪽에 주황 줄이 있는 글로 나와요. 책 속 한두 문장을 옮겨요." },
  { key: "song", name: "이 장소의 노래", screens: ["place"], text: "그 장소에 오면 화면 맨 위 플레이어에서 흘러요. 아티스트·곡 제목이 거기에 나와요." },
];

// 폼 칸 name → 예시 항목 key
const COURSE_GUIDE_INPUT_KEYS = {
  title: "title", author: "author", slug: "slug", kind: "kind", description: "description", intro: "intro",
  linkUrl: "linkUrl", logo: "logo", removeLogo: "logo", cover: "cover", removeCover: "cover", coverSpineRatio: "cover",
  name: "name", label: "label", quote: "quote", youtubeUrl: "song", musicArtist: "song", musicTitle: "song",
};

let guideScreen = "detail";
// 넓은 화면에선 오른쪽 여백에 펼쳐 두고, 좁은 화면에선 접어 둔다(폼 위에 길게 끼어들지 않게).
let courseGuideOpen = window.matchMedia("(min-width: 1240px)").matches;
let guideKey = null;

function courseGuideKeyForInput(el) {
  if (!el?.closest?.("#course-form, #place-form")) return null;
  if (el.id === "place-search-input") return "name";
  if (el.dataset?.slotField) return "photoMeta";
  if (el.closest(".course-place-photos")) return "photo";
  return COURSE_GUIDE_INPUT_KEYS[el.name] || null;
}

function courseGuideHtml() {
  const screen = COURSE_GUIDE_SCREENS[guideScreen];
  const [w, h] = screen.size;
  const field = COURSE_GUIDE_FIELDS.find((f) => f.key === guideKey) || null;
  // 이 화면에 나오는 항목만 번호를 매긴다(폼 순서대로).
  const onScreen = COURSE_GUIDE_FIELDS.filter((f) => f.screens.includes(guideScreen) && screen.spots[f.key]);
  const pct = (v, total) => `${((v / total) * 100).toFixed(2)}%`;
  const spotsHtml = onScreen.map((f, i) => {
    const [x, y, sw, sh] = screen.spots[f.key];
    const active = f.key === guideKey;
    return `<button type="button" class="course-guide-spot${active ? " course-guide-spot--active" : ""}" data-guide-key="${f.key}"
      style="left:${pct(x, w)};top:${pct(y, h)};width:${pct(sw, w)};height:${pct(sh, h)}" aria-label="${escapeHtml(f.name)}">
      <span class="course-guide-spot-num">${i + 1}</span></button>`;
  }).join("");
  return `
    <div class="course-guide-head">
      <b>어디에 보이나요?</b>
      <p class="field-hint">입력 칸을 누르면 그 내용이 실제 화면 어디에 나오는지 표시해요. 예시는 「콘크리트 사피엔스」 발자취예요.</p>
    </div>
    <div class="course-guide-tabs">
      ${Object.entries(COURSE_GUIDE_SCREENS).map(([id, sc]) => {
        const has = field?.screens.includes(id);
        return `<button type="button" class="course-guide-tab${id === guideScreen ? " course-guide-tab--active" : ""}${has ? " course-guide-tab--has" : ""}" data-guide-screen="${id}">${sc.label}</button>`;
      }).join("")}
    </div>
    ${field ? `<div class="course-guide-now"><b>${escapeHtml(field.name)}</b> — ${escapeHtml(field.text)}</div>` : ""}
    <div class="course-guide-phone${field ? " course-guide-phone--focused" : ""}" style="aspect-ratio:${w} / ${h};width:min(100%, calc(58vh * ${(w / h).toFixed(3)}))">
      <img src="${screen.img}" alt="${escapeHtml(screen.label)} 예시 화면" />
      ${spotsHtml}
    </div>
    <ol class="course-guide-legend">
      ${onScreen.map((f) => `<li><button type="button" class="${f.key === guideKey ? "course-guide-legend--active" : ""}" data-guide-key="${f.key}">${escapeHtml(f.name)}</button></li>`).join("")}
    </ol>
  `;
}

function renderCourseGuide() {
  const el = document.getElementById("course-guide-body");
  if (el) el.innerHTML = courseGuideHtml();
}

// 칸을 고르면 그 항목이 나오는 화면으로 넘긴다(지금 화면에도 나오면 그대로).
function selectCourseGuideKey(key) {
  if (!key) return;
  const field = COURSE_GUIDE_FIELDS.find((f) => f.key === key);
  guideKey = key;
  if (field.screens.length && !field.screens.includes(guideScreen)) guideScreen = field.screens[0];
  renderCourseGuide();
}

// 소개 화면 본문 최대 글자 수 — 시안(2026-10-13)의 소개 글 길이(116자).
// 이보다 길면 소개 화면에서 책 표지보다 글이 길게 늘어진다.
const COURSE_INTRO_MAX = 116;

function bindCourseIntroCounter() {
  const input = document.getElementById("course-intro-input");
  const count = document.getElementById("course-intro-count");
  const update = () => {
    count.textContent = `${input.value.length} / ${COURSE_INTRO_MAX}자`;
  };
  input.addEventListener("input", update);
  update();
}

let pendingCoverBlob = null; // 새로 고른 표지를 정리한 이미지(cleanBookCoverImage)

// 표지 편집기 — 평면 이미지 위 세로선(책등 경계)과 입체 미리보기(js/book3d.js)를
// 슬라이더와 같이 움직인다. 새 파일을 고르면 책등 경계를 자동으로 찾아
// 슬라이더를 맞춰둔다(detectBookSpineRatio). 기존 표지는 S3 URL이라 픽셀을
// 못 읽어서 저장된 값 그대로 시작한다.
function bindCourseCoverEditor() {
  pendingCoverBlob = null;
  const input = document.getElementById("course-cover-input");
  const editor = document.getElementById("course-cover-editor");
  const flat = document.getElementById("course-cover-flat");
  const line = document.getElementById("course-cover-flat-line");
  const book = document.getElementById("course-cover-3d");
  const spineRow = document.getElementById("course-cover-spine-row");
  const slider = document.getElementById("course-cover-spine");
  const valueEl = document.getElementById("course-cover-spine-value");
  const kindSelect = document.querySelector('#course-form select[name="kind"]');
  const guide = document.getElementById("course-cover-guide");
  let url = null;

  // 책등 경계는 책 코스만 쓴다(2026-10-16) — 다른 종류는 슬라이더와 경계선을
  // 숨기고, 미리보기도 그 종류 모양(js/book3d.js renderCourseCover)으로.
  const refresh = () => {
    const isBook = isBookCourseKind(kindSelect.value);
    const r = isBook ? parseFloat(slider.value) || 0 : 0;
    valueEl.textContent = r > 0 ? `왼쪽 ${Math.round(r * 1000) / 10}%` : "없음(앞표지만)";
    line.style.left = `${r * 100}%`;
    line.classList.toggle("hidden", r === 0);
    spineRow.classList.toggle("hidden", !url || !isBook);
    guide.innerHTML = COURSE_COVER_GUIDES[kindSelect.value] || COURSE_COVER_GUIDES.etc;
    if (url) renderCourseCover(book, url, kindSelect.value, r);
  };
  const show = (newUrl) => {
    url = newUrl;
    let img = flat.querySelector("img");
    if (!img) {
      img = document.createElement("img");
      img.alt = "";
      flat.prepend(img);
    }
    img.src = newUrl;
    editor.classList.remove("hidden");
    refresh();
  };

  slider.addEventListener("input", refresh);
  kindSelect.addEventListener("change", refresh);
  input.addEventListener("change", (e) => {
    const file = e.target.files[0];
    pendingCoverBlob = null;
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    // 책등 찾기·여백 자르기는 책 표지 전용 — 포스터·앨범 등은 올린 그대로
    if (!isBookCourseKind(kindSelect.value)) {
      slider.value = "0";
      show(objectUrl);
      return;
    }
    const probe = new Image();
    probe.onload = () => {
      // 바깥 여백·책등과 앞표지 사이 틈을 잘라낸 이미지로 미리보기하고, 저장도
      // 이 이미지로 한다(pendingCoverBlob). 정리에 실패하면 원본 그대로.
      const { canvas, spineRatio } = cleanBookCoverImage(probe);
      canvas.toBlob((blob) => {
        if (!blob) {
          slider.value = String(detectBookSpineRatio(probe));
          show(objectUrl);
          return;
        }
        URL.revokeObjectURL(objectUrl);
        pendingCoverBlob = blob;
        slider.value = String(spineRatio ?? detectBookSpineRatio(canvas));
        show(URL.createObjectURL(blob));
      }, "image/jpeg", 0.92);
    };
    probe.src = objectUrl;
  });
  if (flat.dataset.photoKey) {
    resolveAdminPhotoUrl(flat.dataset.photoKey).then((existingUrl) => {
      if (existingUrl && !url) show(existingUrl);
    });
  }
}

// 표지 안내 — 종류마다 올릴 이미지와 소개 화면에 보이는 모양이 다르다
// (js/book3d.js renderCourseCover). 종류를 바꾸면 바로 바뀐다.
const COURSE_COVER_GUIDES = {
  book: `<p><b>책등(스파인)과 겉표지(앞표지)를 한 장으로 올려주세요.</b> 펼친 표지 파일에서 <b>왼쪽 책등 + 오른쪽 앞표지</b> 부분만 잘라서 올리면, 소개 화면에 책이 옆면(책등)까지 보이는 입체로 세워져요.</p>
    <p>책등 경계는 올리면 자동으로 찾아요. 아래 미리보기를 보면서 슬라이더로 맞춰주세요. 앞표지만 있으면 슬라이더를 0으로 두면 돼요(책등은 표지 왼쪽 끝 색으로 채워져요).</p>`,
  music: `<p><b>정사각형 앨범 커버를 올려주세요.</b> 소개 화면에 앨범 커버 뒤로 LP판이 삐져나온 모양으로 보이고, 목록에서도 정사각형으로 보여요.</p>`,
  drama: `<p><b>세로 포스터를 올려주세요.</b> 소개 화면에 포스터 한 장으로 보여요.</p>`,
  person: `<p><b>인물 사진을 올려주세요.</b> 소개 화면에 폴라로이드 사진처럼 보여요. 얼굴이 가운데 오게 잘라 올리면 좋아요.</p>`,
  influencer: `<p><b>계정 대표 이미지나 대표 사진을 올려주세요.</b> 소개 화면에 이미지가 평평하게 그대로 보이고, 목록에선 세로로 긴 칸에 맞춰 잘려요. 목록 작가 줄엔 이름만 나와요.</p>`,
  etc: `<p>소개 화면에 올린 이미지가 평평하게 그대로 보여요. 목록에선 세로로 긴 칸에 맞춰 잘려요.</p>`,
};

function courseFormHtml() {
  const c = editingCourseId ? courses.find((x) => x.id === editingCourseId) : null;
  const v = (field) => escapeHtml(c?.[field] ?? "");
  return `
    <form class="course-form" id="course-form">
      <div class="admin-section-title">${c ? `코스 수정 — ${escapeHtml(c.title)}` : "새 코스 만들기"}</div>
      <label>이름<input type="text" name="title" value="${v("title")}" placeholder="예: 콘크리트 사피엔스" required /></label>
      <label>저자(선택)<input type="text" name="author" value="${v("author")}" maxlength="30" placeholder="예: 채만식" /></label>
      <p class="field-hint">코스 목록 제목 아래 "채만식 지음"처럼 보여요(음악·크리에이터는 이름만, 드라마·영화는 "OOO 연출", 기타는 "OOO 운영"). 이름에는 작품 제목만 적어주세요.</p>
      <label>영문 식별자(공유 링크용)<input type="text" name="slug" value="${v("slug")}" placeholder="예: concrete-sapiens" pattern="[a-z0-9-]+" required /></label>
      <label>종류
        <select name="kind">
          ${COURSE_KINDS.map((k) => `<option value="${k.value}"${(c?.kind || "book") === k.value ? " selected" : ""}>${k.label}</option>`).join("")}
        </select>
      </label>
      <label>부제(한 줄)<input type="text" name="description" value="${v("description")}" maxlength="40" placeholder="예: 콘크리트 사피엔스의 발자취" /></label>
      <p class="field-hint">소개 화면 제목 바로 아래, 코스 목록에도 보여요.</p>
      <label>책·작품 소개<textarea name="intro" id="course-intro-input" rows="4" maxlength="${COURSE_INTRO_MAX}" placeholder="소개 화면 본문 — 최대 ${COURSE_INTRO_MAX}자">${v("intro")}</textarea></label>
      <p class="field-hint course-intro-count" id="course-intro-count"></p>
      <label>바깥 링크(선택)<input type="url" name="linkUrl" value="${v("linkUrl")}" placeholder="만든 사람 인스타그램·유튜브, 책 소개 페이지 등" /></label>
      <label>로고(선택)<input type="file" name="logo" id="course-logo-input" accept="image/*" /></label>
      <div class="course-logo-preview" id="course-logo-preview"${c?.logoKey ? ` data-photo-key="${escapeHtml(c.logoKey)}"` : ""}></div>
      ${c?.logoKey ? `<label class="course-photo-remove"><input type="checkbox" name="removeLogo" /> 로고 빼기</label>` : ""}
      <p class="field-hint">지도 위 장소 핀(동그라미)에 번호 대신 들어가요. 없으면 번호로 보여요.<br /><b>정사각형</b>으로 만들고 글자·핵심 그림은 <b>가운데 원 안쪽</b>에 두세요 — 올릴 때 가운데를 정사각형으로 자르고, 핀에서는 동그랗게 잘려 보여요. 배경까지 꽉 찬 이미지가 가장 선명해요.</p>
      <label>표지(선택)<input type="file" name="cover" id="course-cover-input" accept="image/*" /></label>
      <div class="course-cover-guide" id="course-cover-guide">${COURSE_COVER_GUIDES[c?.kind || "book"] || COURSE_COVER_GUIDES.etc}</div>
      <div class="course-cover-editor${c?.coverKey ? "" : " hidden"}" id="course-cover-editor">
        <div class="course-cover-flat" id="course-cover-flat"${c?.coverKey ? ` data-photo-key="${escapeHtml(c.coverKey)}"` : ""}>
          <div class="course-cover-flat-line" id="course-cover-flat-line"></div>
        </div>
        <div class="course-cover-3d" id="course-cover-3d"></div>
      </div>
      <label class="course-cover-spine${c?.coverKey && isBookCourseKind(c.kind) ? "" : " hidden"}" id="course-cover-spine-row">책등 경계 <span id="course-cover-spine-value"></span>
        <input type="range" name="coverSpineRatio" id="course-cover-spine" min="0" max="0.4" step="0.002" value="${c?.coverSpineRatio ?? 0}" />
      </label>
      ${c?.coverKey ? `<label class="course-photo-remove"><input type="checkbox" name="removeCover" /> 표지 빼기</label>` : ""}
      <label>장소 사진 모양<select name="photoRatio">
        <option value="landscape"${c?.photoRatio === "portrait" ? "" : " selected"}>가로 (16:9, 기본)</option>
        <option value="portrait"${c?.photoRatio === "portrait" ? " selected" : ""}>세로 (9:16 사진 위주)</option>
      </select></label>
      <p class="field-hint">이 발자취의 모든 장소 카드와 사진 올리는 칸에 같은 모양으로 적용돼요. 보일 부분은 장소 사진에서 끌어 맞추고, 카드에서 사진을 탭하면 전체를 크게 볼 수 있어요.</p>
      ${sessionRole === "curator" ? "" : `<label>목록 고정(1 이상이면 맨 앞에 고정, 작을수록 앞 · 0이면 조회수 많은 순)<input type="number" name="sortOrder" min="0" value="${c?.sortOrder ?? 0}" /></label>`}
      <div class="admin-card-actions">
        <button type="submit" class="btn-restore">${c ? "수정 저장" : "코스 만들기"}</button>
        ${c ? `<button type="button" class="btn-delete" data-course-action="cancel-edit">취소</button>` : ""}
      </div>
      ${c ? "" : sessionRole === "curator"
        ? `<p class="field-hint">새 코스는 비공개로 만들어져요. 장소를 다 넣은 뒤 "공개 요청"을 누르면 관리자가 확인하고 공개해요.</p>`
        : `<p class="field-hint">새 코스는 비공개로 만들어져요. 장소를 다 넣은 뒤 "공개하기"를 누르세요.</p>`}
    </form>
  `;
}

function placeRowHtml(place, index, total) {
  return `
    <div class="admin-card course-place-row">
      <div class="course-place-seq">${index + 1}</div>
      <div class="course-place-body">
        <p class="admin-card-content"><b>${escapeHtml(place.name)}</b>${place.label ? ` <span class="course-place-label">${escapeHtml(place.label)}</span>` : ""}</p>
        <div class="admin-card-meta">
          <span>${escapeHtml(place.address || "-")}</span>
          <a href="${kakaoMapLink(place.name, place.lat, place.lng)}" target="_blank" rel="noopener">카카오맵에서 위치 확인</a>
        </div>
        ${place.description ? `<p class="field-hint">${escapeHtml(place.description)}</p>` : ""}
        ${place.quote ? `<p class="course-place-quote">“${escapeHtml(place.quote)}”</p>` : ""}
        ${place.youtubeUrl ? `<p class="field-hint">♪ ${escapeHtml([place.musicArtist, place.musicTitle].filter(Boolean).join(" - ") || "이 장소의 노래")}</p>` : ""}
        ${place.photoKey ? `<div class="admin-card-photo" data-photo-key="${escapeHtml(place.photoKey)}" data-focus-x="${place.photoFocusX ?? 50}" data-focus-y="${place.photoFocusY ?? 50}"></div>` : ""}
        ${Storage.getCoursePlacePhotos(place).length > 1 ? `<p class="field-hint">사진 ${Storage.getCoursePlacePhotos(place).length}장 (대표 사진만 보여요)</p>` : ""}
        <div class="admin-card-actions">
          <button class="btn-restore" data-place-action="up" data-place-id="${place.id}"${index === 0 ? " disabled" : ""}>↑</button>
          <button class="btn-restore" data-place-action="down" data-place-id="${place.id}"${index === total - 1 ? " disabled" : ""}>↓</button>
          <button class="btn-restore" data-place-action="edit" data-place-id="${place.id}">수정</button>
          <button class="btn-delete" data-place-action="delete" data-place-id="${place.id}">삭제</button>
        </div>
      </div>
    </div>
  `;
}

function placePickedHtml() {
  return placeDraft
    ? `<p class="course-place-picked">📍 <b>${escapeHtml(placeDraft.name)}</b> · ${escapeHtml(placeDraft.address || "")}
         <a href="${kakaoMapLink(placeDraft.name, placeDraft.lat, placeDraft.lng)}" target="_blank" rel="noopener">위치 확인</a></p>`
    : `<p class="field-hint">장소를 검색해 고르거나, 지도를 돌아다니다 원하는 곳을 찍으세요.</p>`;
}

function placeFormHtml() {
  const p = editingPlaceId ? (coursePlacesById[selectedCourseId] || []).find((x) => x.id === editingPlaceId) : null;
  const v = (field) => escapeHtml(p?.[field] ?? "");
  return `
    <form class="course-form" id="place-form">
      <div class="admin-section-title">${p ? `장소 수정 — ${escapeHtml(p.name)}` : "장소 추가"}</div>
      <div class="course-place-search">
        <input type="text" id="place-search-input" placeholder="장소 이름이나 주소로 검색 (예: 세운상가)" />
        <button type="button" class="btn-restore" data-place-action="search">검색</button>
      </div>
      <ul class="course-place-results" id="place-search-results"></ul>
      <div class="place-pick-map" id="place-pick-map"></div>
      <div id="place-picked">${placePickedHtml()}</div>
      <label>지도에 보일 이름<input type="text" name="name" value="${escapeHtml(p?.name ?? placeDraft?.name ?? "")}" placeholder="검색 결과 이름을 바꾸고 싶을 때만 수정" /></label>
      <label>꼬리표(선택)<input type="text" name="label" value="${v("label")}" data-max-nonspace="${PLACE_LABEL_MAX}" placeholder='예: "3장", "1443년"' /></label>
      <p class="field-hint field-count" data-count-for="label"></p>
      <label>인용(선택)<textarea name="quote" rows="3" data-max-nonspace="${PLACE_QUOTE_MAX}" placeholder="책 속 한두 문장">${v("quote")}</textarea></label>
      <p class="field-hint field-count" data-count-for="quote"></p>
      ${placePhotoFieldHtml()}
      <label>이 장소의 노래 — 유튜브 링크(선택)<input type="url" name="youtubeUrl" value="${v("youtubeUrl")}" placeholder="따라 걷는 동안 장소 노래들이 차례로 흘러요" /></label>
      <div class="course-music-row">
        <label>아티스트<input type="text" name="musicArtist" value="${v("musicArtist")}" /></label>
        <label>곡 제목<input type="text" name="musicTitle" value="${v("musicTitle")}" /></label>
      </div>
      <div class="admin-card-actions">
        <button type="submit" class="btn-restore">${p ? "수정 저장" : "장소 추가"}</button>
        ${p ? `<button type="button" class="btn-delete" data-place-action="cancel-edit">취소</button>` : ""}
      </div>
    </form>
  `;
}

// 코스 로고 — 지도 핀이 동그라미라(2026-10-20) 가운데를 정사각형으로 잘라
// 192px PNG로 줄인다(투명 배경 로고는 투명 그대로). 예전엔 왼쪽 위 색과
// 비슷한 픽셀을 투명하게 지우고 여백을 잘라냈는데, 표지 그림 같은 로고는
// 종이·하늘 부분이 반투명하게 뚫려 흐릿해 보이고, 그 때문에 꽉 채운
// 로고로 인식되지 않아 동그라미 안에 작게 떠 보였다.
function resizeLogoFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const side = Math.min(img.width, img.height);
      if (!side) {
        reject(new Error("로고에서 내용을 찾지 못했어요."));
        return;
      }
      const size = Math.min(192, side);
      const out = document.createElement("canvas");
      out.width = size;
      out.height = size;
      out
        .getContext("2d")
        .drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("로고를 처리할 수 없어요."))), "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("로고를 읽을 수 없어요."));
    };
    img.src = objectUrl;
  });
}

// 장소 사진(선택, 최대 COURSE_PLACE_PHOTO_MAX장, 2026-10-16) — 카드에 16:9로
// 잘려 보이므로 가로 사진이 좋고, 카드에서 옆으로 넘겨 본다. 1번이 대표
// 사진이다. 직접 찍었거나 사용 허락을 받은 사진만 올린다.
function getPlacePhotoSlots() {
  if (!placePhotoSlots) {
    const p = editingPlaceId ? (coursePlacesById[selectedCourseId] || []).find((x) => x.id === editingPlaceId) : null;
    placePhotoSlots = Storage.getCoursePlacePhotos(p).map((ph) => ({
      key: ph.key,
      file: null,
      focus: { x: ph.focusX, y: ph.focusY },
      title: ph.title,
      credit: ph.credit,
    }));
  }
  return placePhotoSlots;
}

// 미리보기 칸은 장소 카드 사진 칸과 같은 16:9 — 기억 카드 사진(js/composer.js
// 사진 미리보기)처럼 사진을 끌어 보일 부분을 고른다(WYSIWYG). 사진마다
// 제목/출처를 따로 단다(카드에서 넘길 때 같이 바뀐다).
function placePhotoFieldHtml() {
  const slots = getPlacePhotoSlots();
  // 미리보기 칸 모양은 코스 설정(사진 모양)을 따른다 — 카드에서 실제로 보일 모양 그대로
  const photoCourse = courses && courses.find((c) => c.id === selectedCourseId);
  const cropClass = photoCourse && photoCourse.photoRatio === "portrait" ? " course-place-photo-crop--portrait" : "";
  const slotHtml = (slot, i) => {
    const focusAttrs = `data-focus-x="${slot.focus.x}" data-focus-y="${slot.focus.y}"`;
    if (slot.file && !slot.previewUrl) slot.previewUrl = URL.createObjectURL(slot.file);
    const preview = slot.file
      ? `<div class="admin-card-photo course-place-photo-crop${cropClass}" data-slot="${i}" ${focusAttrs}><img src="${slot.previewUrl}" alt="" style="object-position:${slot.focus.x}% ${slot.focus.y}%" /></div>`
      : `<div class="admin-card-photo course-place-photo-crop${cropClass}" data-slot="${i}" data-photo-key="${escapeHtml(slot.key)}" ${focusAttrs}></div>`;
    return `
      <div class="course-place-photo-slot">
        <div class="course-place-photo-slot-head">
          <b>사진 ${i + 1}${i === 0 ? " · 대표" : ""}</b>
          ${i > 0 ? `<button type="button" class="btn-restore" data-photo-slot-action="forward" data-slot="${i}">앞으로</button>` : ""}
          <label class="btn-restore course-place-photo-replace">바꾸기<input type="file" accept="image/*" data-photo-slot-replace="${i}" hidden /></label>
          <button type="button" class="btn-delete" data-photo-slot-action="remove" data-slot="${i}">빼기</button>
        </div>
        ${preview}
        <label>사진 제목(선택)<input type="text" name="photoTitle${i}" value="${escapeHtml(slot.title)}" data-slot="${i}" data-slot-field="title" data-max-nonspace="${PLACE_PHOTO_TITLE_MAX}" placeholder="사진 바로 아래에 한 줄로 작게 보여요" /></label>
        <p class="field-hint field-count" data-count-for="photoTitle${i}"></p>
        <label>사진 출처(선택)<input type="text" name="photoCredit${i}" value="${escapeHtml(slot.credit)}" data-slot="${i}" data-slot-field="credit" maxlength="30" placeholder="예: 군산시" /></label>
      </div>
    `;
  };
  return `
    <div class="course-place-photos">
      ${slots.map(slotHtml).join("")}
      ${slots.length < COURSE_PLACE_PHOTO_MAX ? `
        <label>사진 추가(선택, ${slots.length} / ${COURSE_PLACE_PHOTO_MAX}장)<input type="file" id="place-photo-input" accept="image/*" /></label>
      ` : ""}
      <p class="field-hint">카드에 가로로 납작하게(16:9) 잘려 보이고, 여러 장이면 옆으로 넘겨 봐요. 1번이 대표 사진이에요. 발자취 설정에서 사진 모양을 "세로"로 두면 이 칸도 키 큰 모양이 돼요(카드에서도 같은 모양). ${slots.length ? "<b>사진을 위아래(좌우)로 끌어서</b> 보일 부분을 맞춰주세요. " : ""}출처는 "출처 | 군산시"처럼 보이니 이름만 적어주세요. 직접 찍었거나 사용 허락을 받은 사진만 올려주세요.</p>
    </div>
  `;
}

// 사진 칸 조작(추가/바꾸기/빼기/앞으로) 뒤에는 폼을 다시 그린다. 사진 칸이
// 아닌 다른 칸에 적어둔 값은 keepPlaceFormFields가 지킨다.
function bindPlacePhotoSlots(form) {
  form.querySelectorAll("[data-slot-field]").forEach((input) => {
    input.addEventListener("input", () => {
      getPlacePhotoSlots()[Number(input.dataset.slot)][input.dataset.slotField] = input.value;
    });
  });
  document.getElementById("place-photo-input")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    getPlacePhotoSlots().push({ key: null, file, focus: { x: 50, y: 50 }, title: "", credit: "" });
    keepPlaceFormFields(renderCoursesTab);
  });
  form.querySelectorAll("[data-photo-slot-replace]").forEach((input) => {
    input.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const slot = getPlacePhotoSlots()[Number(input.dataset.photoSlotReplace)];
      Object.assign(slot, { key: null, file, previewUrl: null, focus: { x: 50, y: 50 } });
      keepPlaceFormFields(renderCoursesTab);
    });
  });
  form.querySelectorAll("[data-photo-slot-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slots = getPlacePhotoSlots();
      const i = Number(btn.dataset.slot);
      if (btn.dataset.photoSlotAction === "remove") slots.splice(i, 1);
      else [slots[i - 1], slots[i]] = [slots[i], slots[i - 1]];
      keepPlaceFormFields(renderCoursesTab);
    });
  });
}

// 미리보기 사진 끌기 — js/composer.js 사진 미리보기와 같은 계산(넘치는 만큼을
// 0~100%로 환산). 기존 사진은 hydrateAdminPhotos가 img를 나중에 넣으므로
// 칸에 이벤트를 걸고 누를 때 img를 찾는다.
function bindPlacePhotoCrop() {
  document.querySelectorAll(".course-place-photo-crop[data-slot]").forEach((box) => {
    const slot = getPlacePhotoSlots()[Number(box.dataset.slot)];
    let drag = null;
    box.addEventListener("pointerdown", (e) => {
      const img = box.querySelector("img");
      if (!img || !img.naturalWidth) return;
      const scale = Math.max(box.clientWidth / img.naturalWidth, box.clientHeight / img.naturalHeight);
      const overflowX = img.naturalWidth * scale - box.clientWidth;
      const overflowY = img.naturalHeight * scale - box.clientHeight;
      if (overflowX <= 0 && overflowY <= 0) return;
      e.preventDefault();
      box.setPointerCapture(e.pointerId);
      drag = { img, overflowX, overflowY, startX: e.clientX, startY: e.clientY, start: { ...slot.focus } };
      box.classList.add("dragging");
    });
    box.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const focus = { ...drag.start };
      if (drag.overflowX > 0) focus.x = Math.min(100, Math.max(0, drag.start.x - ((e.clientX - drag.startX) / drag.overflowX) * 100));
      if (drag.overflowY > 0) focus.y = Math.min(100, Math.max(0, drag.start.y - ((e.clientY - drag.startY) / drag.overflowY) * 100));
      slot.focus = focus;
      drag.img.style.objectPosition = `${focus.x}% ${focus.y}%`;
    });
    ["pointerup", "pointercancel"].forEach((evt) => {
      box.addEventListener(evt, () => {
        drag = null;
        box.classList.remove("dragging");
      });
    });
  });
}

async function renderCoursesTab() {
  clearDeviceFilterBanner();
  const content = document.getElementById("admin-content");
  if (courses === null) {
    content.innerHTML = `<p class="empty-state">불러오는 중...</p>`;
    try {
      await loadCourses();
    } catch (e) {
      console.error("발자취 불러오기 실패", e);
      content.innerHTML = `<p class="empty-state">발자취를 불러오지 못했어요. 백엔드 배포(npm run deploy)가 됐는지 확인해주세요.<br>${escapeHtml(e.message || String(e))}</p>`;
      courses = null;
      return;
    }
  }

  const selected = courses.find((c) => c.id === selectedCourseId) || null;
  const places = selected ? coursePlacesById[selected.id] || [] : [];

  content.innerHTML = `
    <div class="course-tab-layout">
    <div class="course-tab-main">
    <div class="admin-section-title">${sessionRole === "curator" ? "내 발자취" : "발자취"} (${courses.length}개 코스)</div>
    <p class="field-hint">여러 장소를 순서대로 묶은 코스예요. 지도 화면에서 "따라 걷기"로 보여줘요.</p>
    ${courses.length ? courses.map(courseCardHtml).join("") : `<p class="empty-state">아직 코스가 없어요.</p>`}
    ${selected ? `
      <div class="course-places-panel">
        <div class="admin-section-title">${escapeHtml(selected.title)} — 장소 ${places.length}곳 (따라 걷기 순서)</div>
        ${places.length ? places.map((p, i) => placeRowHtml(p, i, places.length)).join("") : `<p class="empty-state">아직 장소가 없어요.</p>`}
        ${placeFormHtml()}
      </div>
    ` : ""}
    ${courseFormHtml()}
    </div>
    <aside class="course-guide" id="course-guide">
      <details id="course-guide-details"${courseGuideOpen ? " open" : ""}>
        <summary>📍 입력한 내용이 화면 어디에 보이나요?</summary>
        <div id="course-guide-body">${courseGuideHtml()}</div>
      </details>
    </aside>
    </div>
  `;
  document.getElementById("course-guide-details").addEventListener("toggle", (e) => {
    courseGuideOpen = e.target.open;
  });

  document.getElementById("course-form").addEventListener("submit", guardDoubleSubmit(handleCourseSubmit));
  document.getElementById("course-logo-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const preview = document.getElementById("course-logo-preview");
    preview.innerHTML = `<img src="${URL.createObjectURL(file)}" alt="" />`;
  });
  const logoPreview = document.getElementById("course-logo-preview");
  if (logoPreview.dataset.photoKey) {
    resolveAdminPhotoUrl(logoPreview.dataset.photoKey).then((url) => {
      if (url && !logoPreview.firstChild) logoPreview.innerHTML = `<img src="${url}" alt="" />`;
    });
  }
  bindCourseIntroCounter();
  bindCourseCoverEditor();
  const placeForm = document.getElementById("place-form");
  if (placeForm) {
    placeForm.addEventListener("submit", guardDoubleSubmit(handlePlaceSubmit));
    bindNonSpaceLimits(placeForm);
    const searchInput = document.getElementById("place-search-input");
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handlePlaceSearch();
      }
    });
    bindPlacePhotoSlots(placeForm);
    bindPlacePickMap();
  }
  hydrateAdminPhotos();
  bindPlacePhotoCrop();
}

// 폼을 다시 그려도 적어둔 이름/꼬리표/인용/노래는 남게 한다. 사진 제목·출처는
// 사진 칸(placePhotoSlots)이 들고 있다.
function keepPlaceFormFields(rerender) {
  const form = document.getElementById("place-form");
  const kept = Object.fromEntries(["name", "label", "quote", "youtubeUrl", "musicArtist", "musicTitle"].map((k) => [k, form.elements[k].value]));
  rerender();
  const newForm = document.getElementById("place-form");
  Object.entries(kept).forEach(([k, val]) => {
    newForm.elements[k].value = val;
  });
  bindNonSpaceLimits(newForm);
}

// 장소 글자 수 제한(2026-10-13, 공백 제외) — 장소 카드가 폰에서 한 화면에
// 들어오게. 사진 제목(description 필드)은 사진 바로 아래 한 줄 캡션이다.
const PLACE_LABEL_MAX = 25;
const PLACE_PHOTO_TITLE_MAX = 20;
const PLACE_QUOTE_MAX = 80;

const countNonSpace = (text) => text.replace(/\s/g, "").length;

// data-max-nonspace가 붙은 칸은 공백을 뺀 글자 수가 한도를 넘으면 마지막
// 입력을 되돌리고, 바로 아래 .field-count에 "n / 한도자(공백 제외)"를 띄운다.
// 폼을 다시 그린 뒤(값을 코드로 채운 뒤)에도 다시 불러 숫자를 맞춘다.
function bindNonSpaceLimits(form) {
  form.querySelectorAll("[data-max-nonspace]").forEach((input) => {
    const max = Number(input.dataset.maxNonspace);
    const counter = form.querySelector(`.field-count[data-count-for="${input.name}"]`);
    let lastValid = input.value;
    const update = () => {
      if (countNonSpace(input.value) > max) input.value = lastValid;
      lastValid = input.value;
      if (counter) counter.textContent = `${countNonSpace(input.value)} / ${max}자(공백 제외)`;
    };
    input.oninput = update;
    update();
  });
}

async function handleCourseSubmit(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const fields = {
    title: f.get("title").trim(),
    author: f.get("author").trim() || null,
    slug: f.get("slug").trim(),
    kind: f.get("kind"),
    description: f.get("description").trim() || null,
    linkUrl: f.get("linkUrl").trim() || null,
  };
  const editing = editingCourseId ? courses.find((c) => c.id === editingCourseId) : null;
  // 정렬 순서는 관리자만 정한다(작가 폼엔 칸이 없음).
  if (sessionRole !== "curator") fields.sortOrder = parseInt(f.get("sortOrder"), 10) || 0;
  else if (!editing) fields.sortOrder = 0;
  let logoKey = editing?.logoKey || null;
  if (f.get("removeLogo")) logoKey = null;
  const logoFile = f.get("logo");
  if (logoFile && logoFile.size) {
    try {
      const blob = await resizeLogoFile(logoFile);
      logoKey = `story-photos/course-logo-${Date.now()}.png`;
      await uploadData({ path: logoKey, data: blob, options: { contentType: "image/png" } }).result;
    } catch (err) {
      console.error("코스 로고 업로드 실패", err);
      alert(`로고를 올리지 못했어요. ${err.message || ""}`);
      return;
    }
  }
  fields.logoKey = logoKey;
  // 표지는 사진과 같은 방식(JPEG로 줄여서)으로 올린다 — 로고처럼 투명
  // 배경이 필요 없다.
  let coverKey = editing?.coverKey || null;
  if (f.get("removeCover")) coverKey = null;
  const coverFile = f.get("cover");
  if (coverFile && coverFile.size) {
    try {
      const blob = await PhotoUpload.resizeImageFile(pendingCoverBlob || coverFile);
      coverKey = `story-photos/course-cover-${Date.now()}.jpg`;
      await uploadData({ path: coverKey, data: blob, options: { contentType: "image/jpeg" } }).result;
    } catch (err) {
      console.error("코스 표지 업로드 실패", err);
      alert(`표지를 올리지 못했어요. ${err.message || ""}`);
      return;
    }
  }
  fields.coverKey = coverKey;
  fields.coverSpineRatio = coverKey ? (isBookCourseKind(fields.kind) ? parseFloat(f.get("coverSpineRatio")) || 0 : 0) : null;
  fields.intro = (f.get("intro") || "").trim().slice(0, COURSE_INTRO_MAX) || null;
  // 백엔드에 photoRatio 필드가 배포되기 전엔 보내면 저장이 거부되므로, 세로를 고르거나
  // 이미 값이 있는 코스를 바꿀 때만 담는다(가로=기본이라 비워도 같은 결과).
  const photoRatio = f.get("photoRatio") === "portrait" ? "portrait" : null;
  if (photoRatio || editing?.photoRatio) fields.photoRatio = photoRatio;
  if (allCourseSlugs.some((c) => c.slug === fields.slug && c.id !== editingCourseId)) {
    alert(`"${fields.slug}" 식별자는 이미 다른 코스가 쓰고 있어요.`);
    return;
  }
  if (editingCourseId) {
    const updated = await runCourseMutation(client.models.Course.update({ id: editingCourseId, ...fields }), "코스 수정 실패");
    if (!updated) return;
    courses = courses.map((c) => (c.id === updated.id ? updated : c));
    allCourseSlugs = allCourseSlugs.map((c) => (c.id === updated.id ? { id: c.id, slug: updated.slug } : c));
    editingCourseId = null;
  } else {
    // 작가가 만들면 자기 sub를 authorId로 직접 채운다 — 이 값이 있어야 이후
    // 수정·삭제 권한(owner 규칙)이 잡힌다.
    const authorId = sessionRole === "curator" ? currentUserId : null;
    const created = await runCourseMutation(client.models.Course.create({ ...fields, isPublished: false, authorId }), "코스 만들기 실패");
    if (!created) return;
    courses.push(created);
    allCourseSlugs.push({ id: created.id, slug: created.slug });
    selectedCourseId = created.id;
  }
  courses.sort(Storage.compareCourseOrder);
  renderCoursesTab();
}

async function handleCourseAction(action, courseId) {
  const course = courses.find((c) => c.id === courseId);
  if (action === "copy-link") {
    // 메인 사이트에서 이 코스를 바로 여는 공유 링크(js/course.js openCourseFromLink).
    // 비공개 코스는 일반 링크로 안 열리므로 시안 미리보기 링크(&preview=1)를 준다 —
    // 링크를 아는 사람만 볼 수 있고 방문·반응 집계에는 잡히지 않는다.
    const base = `${window.location.origin}/?course=${encodeURIComponent(course.slug)}`;
    const live = isCourseLive(course);
    // 공개 코스는 카톡 미리보기가 코스별로 나오는 공유 페이지 주소(js/courseSharePages.js)
    const sharePage = live && typeof COURSE_SHARE_PAGES !== "undefined" && Object.hasOwn(COURSE_SHARE_PAGES, course.slug);
    const url = sharePage ? `${window.location.origin}/c/${encodeURIComponent(course.slug)}` : live ? base : `${base}&preview=1`;
    try {
      await navigator.clipboard.writeText(url);
      alert(`링크를 복사했어요.\n${url}${live ? "" : "\n\n아직 비공개라 시안 미리보기 링크예요. 링크를 아는 사람은 누구나 볼 수 있으니 허락받을 분께만 보내세요."}`);
    } catch (e) {
      prompt("아래 링크를 복사해주세요.", url);
    }
    return;
  }
  if (action === "handover") {
    handoverCourseId = handoverCourseId === courseId ? null : courseId;
  } else if (action === "reclaim") {
    if (sessionRole === "curator" || !course.authorId) return;
    await reclaimCourse(course);
  } else if (action === "handover-cancel") {
    handoverCourseId = null;
  } else if (action === "handover-confirm") {
    const authorId = document.getElementById("course-handover-select")?.value;
    if (!authorId || sessionRole === "curator" || course.authorId) return;
    if (course.isPublished) {
      alert("공개 중인 코스예요. 먼저 \"비공개로\" 돌린 뒤 넘겨주세요. (작가 코스는 승인이 있어야 지도에 보여서, 공개 상태로 넘기면 지도에서 사라져요.)");
      return;
    }
    if (await handoverCourse(course, authorId)) handoverCourseId = null;
  } else if (action === "select") {
    selectedCourseId = selectedCourseId === courseId ? null : courseId;
    editingPlaceId = null;
    placeDraft = null;
    placePhotoSlots = null;
  } else if (action === "edit") {
    editingCourseId = courseId;
    renderCoursesTab();
    document.getElementById("course-form").scrollIntoView({ behavior: "smooth" });
    return;
  } else if (action === "cancel-edit") {
    editingCourseId = null;
  } else if (action === "toggle-publish") {
    const places = coursePlacesById[courseId] || [];
    if (!course.isPublished && places.length === 0) {
      // 장소 없는 코스는 지도에 어차피 안 보인다(js/storage.js fetchPublishedCourses).
      if (sessionRole === "curator") {
        alert("장소를 하나 이상 넣은 뒤에 공개 요청할 수 있어요.");
        return;
      }
      if (!confirm("장소가 하나도 없어요. 그래도 공개할까요?")) return;
    }
    // 운영자가 작가 코스를 "공개하기"하면 승인도 함께 한다(2026-10-25) — 작가의 "공개 요청"을
    // 기다리지 않고 바로 지도에 올리려는 경우(넘긴 코스를 운영자가 먼저 공개). 승인이 없으면
    // 공개 상태여도 지도에 안 보여서 따로 "승인"을 한 번 더 눌러야 했다.
    const alsoApprove = sessionRole !== "curator" && course.authorId && !course.isPublished && !approvedCourseIds.has(courseId);
    if (alsoApprove && !confirm(`"${course.title}"을(를) 바로 공개할까요?\n작가 코스라 승인도 함께 처리돼요. 승인 뒤에 작가가 고친 내용은 다시 확인 없이 바로 반영돼요.`)) return;
    const updated = await runCourseMutation(
      client.models.Course.update({ id: courseId, isPublished: !course.isPublished }),
      "공개 상태 변경 실패",
    );
    if (!updated) return;
    courses = courses.map((c) => (c.id === updated.id ? updated : c));
    if (alsoApprove) {
      const ok = await runCourseMutation(client.models.CourseApproval.create({ courseId }), "승인 실패");
      if (ok) approvedCourseIds.add(courseId);
      else alert("공개로 바꿨지만 승인이 안 됐어요. 카드의 \"승인\" 버튼을 눌러주세요.");
    }
  } else if (action === "toggle-approval") {
    const approved = approvedCourseIds.has(courseId);
    const msg = approved
      ? `"${course.title}" 승인을 취소할까요? 지도에서 바로 내려가요.`
      : `"${course.title}"을(를) 승인할까요?${course.isPublished ? " 지도에 바로 공개돼요." : " 작가가 공개 요청하면 바로 공개돼요."}\n승인 뒤에 작가가 고친 내용은 다시 확인 없이 바로 반영돼요.`;
    if (!confirm(msg)) return;
    const ok = await runCourseMutation(
      approved
        ? client.models.CourseApproval.delete({ courseId })
        : client.models.CourseApproval.create({ courseId }),
      approved ? "승인 취소 실패" : "승인 실패",
    );
    if (!ok) return;
    if (approved) approvedCourseIds.delete(courseId);
    else approvedCourseIds.add(courseId);
  } else if (action === "delete") {
    const places = coursePlacesById[courseId] || [];
    if (!confirm(`"${course.title}" 코스와 장소 ${places.length}곳을 완전히 삭제할까요? 되돌릴 수 없습니다.`)) return;
    for (const p of places) {
      const ok = await runCourseMutation(client.models.CoursePlace.delete({ id: p.id }), "장소 삭제 실패");
      if (!ok) return;
    }
    const ok = await runCourseMutation(client.models.Course.delete({ id: courseId }), "코스 삭제 실패");
    if (!ok) return;
    // 승인 기록은 관리자만 지울 수 있다 — 작가가 지운 코스의 승인은 남아도
    // 가리킬 코스가 없어 아무 데도 안 쓰인다.
    if (sessionRole !== "curator" && approvedCourseIds.has(courseId)) {
      await runCourseMutation(client.models.CourseApproval.delete({ courseId }), "승인 기록 삭제 실패");
      approvedCourseIds.delete(courseId);
    }
    courses = courses.filter((c) => c.id !== courseId);
    allCourseSlugs = allCourseSlugs.filter((c) => c.id !== courseId);
    delete coursePlacesById[courseId];
    if (selectedCourseId === courseId) selectedCourseId = null;
    if (editingCourseId === courseId) editingCourseId = null;
  }
  renderCoursesTab();
}

async function handlePlaceSearch() {
  const query = document.getElementById("place-search-input").value.trim();
  const resultsEl = document.getElementById("place-search-results");
  if (!query) return;
  resultsEl.innerHTML = `<li class="field-hint">검색 중...</li>`;
  try {
    await loadKakaoServices();
  } catch (e) {
    resultsEl.innerHTML = `<li class="field-hint">카카오 장소 검색을 불러오지 못했어요. 이 도메인이 카카오 콘솔에 등록돼 있는지 확인해주세요.</li>`;
    return;
  }
  // 장소 이름뿐 아니라 지번/도로명 주소로도 찾는다(js/kakaoSearch.js).
  searchKakaoPlacesAndAddresses(query, (data) => {
    if (!data.length) {
      resultsEl.innerHTML = `<li class="field-hint">검색 결과가 없어요.</li>`;
      return;
    }
    resultsEl.innerHTML = data.slice(0, 8).map((d, i) => `
      <li><button type="button" data-place-action="pick" data-result-index="${i}">
        <b>${escapeHtml(d.place_name)}</b> <span>${escapeHtml(d.road_address_name || d.address_name)}</span>
      </button></li>
    `).join("");
    resultsEl._results = data;
  });
}

function pickSearchResult(index) {
  const d = document.getElementById("place-search-results")._results?.[index];
  if (!d) return;
  // 고르기 전에 폼에 적어둔 꼬리표/인용/노래는 다시 그려도 남게 한다.
  const form = document.getElementById("place-form");
  const kept = Object.fromEntries(["label", "quote", "youtubeUrl", "musicArtist", "musicTitle"].map((k) => [k, form.elements[k].value]));
  placeDraft = {
    name: d.place_name,
    address: d.road_address_name || d.address_name || null,
    lat: parseFloat(d.y),
    lng: parseFloat(d.x),
  };
  renderCoursesTab();
  const newForm = document.getElementById("place-form");
  newForm.elements.name.value = placeDraft.name;
  Object.entries(kept).forEach(([k, val]) => {
    newForm.elements[k].value = val;
  });
  bindNonSpaceLimits(newForm);
}

// 지도에서 찍어 장소 고르기(2026-10-25) — 검색에 안 나오거나, 같은 도로명
// 주소를 쓰는 아파트 동처럼 주소 검색 좌표가 한 점으로 겹치는 곳도 지도를
// 돌아다니다 찍어서(또는 핀을 끌어서) 정확한 자리에 놓을 수 있게. 검색으로
// 고르면 그 자리로 옮겨와 핀을 보여주니, 찍어서 위치만 다듬어도 된다.
// 이 코스의 다른 장소는 순서 번호로 같이 보여준다.
const PLACE_PICK_DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 }; // 서울시청

async function bindPlacePickMap() {
  const el = document.getElementById("place-pick-map");
  if (!el) return;
  try {
    await loadKakaoServices();
  } catch (e) {
    el.innerHTML = `<p class="field-hint">카카오 지도를 불러오지 못했어요.</p>`;
    return;
  }
  // SDK를 기다리는 사이 탭이 다시 그려졌으면 이 지도는 버린다.
  if (!el.isConnected) return;
  const { maps } = kakao;
  const list = coursePlacesById[selectedCourseId] || [];
  const editing = editingPlaceId ? list.find((p) => p.id === editingPlaceId) : null;
  const current = placeDraft || editing;
  const fallback = list[list.length - 1] || PLACE_PICK_DEFAULT_CENTER;
  const center = current || fallback;
  const map = new maps.Map(el, {
    center: new maps.LatLng(center.lat, center.lng),
    level: current ? 3 : list.length ? 5 : 7,
  });
  list.forEach((p, i) => {
    if (p.id === editingPlaceId) return;
    new maps.CustomOverlay({
      map,
      position: new maps.LatLng(p.lat, p.lng),
      content: `<div class="place-pick-map-seq" title="${escapeHtml(p.name)}">${i + 1}</div>`,
      yAnchor: 0.5,
    });
  });
  const marker = new maps.Marker({
    map: current ? map : null,
    position: new maps.LatLng(center.lat, center.lng),
    draggable: true,
  });
  maps.event.addListener(map, "click", (e) => {
    marker.setPosition(e.latLng);
    marker.setMap(map);
    pickMapPoint(e.latLng.getLat(), e.latLng.getLng());
  });
  maps.event.addListener(marker, "dragend", () => {
    const pos = marker.getPosition();
    pickMapPoint(pos.getLat(), pos.getLng());
  });
}

// 찍은 자리의 주소를 거꾸로 찾아 채운다. 이름은 검색으로 골랐거나 수정 중인
// 장소의 이름을 그대로 두고(위치만 다듬는 경우), 처음 찍을 때만 건물 이름이나
// 주소로 채운다. 탭을 다시 그리지 않고 고른 장소 줄만 바꿔서 지도 위치를 지킨다.
function pickMapPoint(lat, lng) {
  const editing = editingPlaceId ? (coursePlacesById[selectedCourseId] || []).find((p) => p.id === editingPlaceId) : null;
  const keptName = placeDraft?.name || editing?.name || null;
  placeDraft = { name: keptName || "지도에서 고른 곳", address: null, lat, lng };
  const draft = placeDraft;
  const render = () => {
    const pickedEl = document.getElementById("place-picked");
    if (pickedEl) pickedEl.innerHTML = placePickedHtml();
    const nameInput = document.getElementById("place-form")?.elements.name;
    if (nameInput && !nameInput.value.trim()) nameInput.value = placeDraft.name;
  };
  const { Geocoder, Status } = kakao.maps.services;
  new Geocoder().coord2Address(lng, lat, (result, status) => {
    // 그 사이 다른 곳을 또 찍었으면 늦게 온 응답은 버린다.
    if (placeDraft !== draft) return;
    const r = status === Status.OK ? result[0] : null;
    const road = r?.road_address;
    const address = road?.address_name || r?.address?.address_name || null;
    draft.address = address;
    if (!keptName) draft.name = road?.building_name || address || draft.name;
    render();
  });
}

// 유튜브 영상을 다른 사이트(우리 미니 플레이어)에서 틀 수 있는지(2026-10-21) —
// 퍼가기를 꺼둔 영상은 oEmbed가 401, 지워졌거나 비공개면 404를 준다. 둘 다
// 지도에서 소리가 안 나므로 저장 전에 알린다. 네트워크 실패처럼 알 수 없으면
// 막지 않는다(true). 서울 1995 첫 곡이 이래서 코스 전체가 무음이었다.
async function isYoutubeEmbeddable(videoId) {
  try {
    const watchUrl = encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`);
    const res = await fetch(`https://www.youtube.com/oembed?url=${watchUrl}&format=json`);
    return !(res.status === 401 || res.status === 403 || res.status === 404);
  } catch (e) {
    return true;
  }
}

async function handlePlaceSubmit(e) {
  e.preventDefault();
  const f = new FormData(e.target);
  const list = coursePlacesById[selectedCourseId] || [];
  const existing = editingPlaceId ? list.find((p) => p.id === editingPlaceId) : null;
  const location = placeDraft || existing;
  if (!location) {
    alert("장소를 먼저 검색해서 골라주세요.");
    return;
  }
  const youtubeUrl = f.get("youtubeUrl").trim() || null;
  if (youtubeUrl && !Storage.extractYoutubeVideoId(youtubeUrl)) {
    alert("유튜브 링크를 알아볼 수 없어요. 영상 주소를 그대로 붙여넣어 주세요.");
    return;
  }
  const changedSong = youtubeUrl && Storage.extractYoutubeVideoId(youtubeUrl) !== Storage.extractYoutubeVideoId(existing?.youtubeUrl || "");
  if (changedSong && !(await isYoutubeEmbeddable(Storage.extractYoutubeVideoId(youtubeUrl)))) {
    const ok = confirm(
      "이 영상은 유튜브에서 다른 사이트 재생을 막아뒀거나 지워진 영상이라 지도에서 소리가 안 나요.\n" +
        "같은 곡의 다른 영상(공식 음원·뮤직비디오 등)으로 바꾸는 걸 권해요. 그래도 저장할까요?",
    );
    if (!ok) return;
  }
  // 사진 칸 순서대로 — 새로 고른 사진만 올리고, 1번은 예전 필드에, 나머지는
  // extraPhotos에 담는다(Storage.getCoursePlacePhotos와 반대 방향).
  const photos = [];
  for (const slot of getPlacePhotoSlots()) {
    let key = slot.key;
    if (slot.file) {
      try {
        const blob = await PhotoUpload.resizeImageFile(slot.file);
        key = `story-photos/course-${selectedCourseId}-${Date.now()}-${photos.length}.jpg`;
        await uploadData({ path: key, data: blob, options: { contentType: "image/jpeg" } }).result;
        // 저장이 뒤에서 실패해도 다시 누를 때 또 올리지 않게
        Object.assign(slot, { key, file: null });
      } catch (err) {
        console.error("장소 사진 업로드 실패", err);
        alert(`사진을 올리지 못했어요. ${err.message || ""}`);
        return;
      }
    }
    photos.push({
      key,
      focusX: Math.round(slot.focus.x),
      focusY: Math.round(slot.focus.y),
      title: slot.title.trim() || null,
      credit: slot.credit.trim() || null,
    });
  }
  const [first, ...extras] = photos;
  const fields = {
    photoKey: first?.key || null,
    photoFocusX: first ? first.focusX : null,
    photoFocusY: first ? first.focusY : null,
    // 사진 없는 장소의 description은 예전에 쓰던 본문 글이라 그대로 둔다
    // (사진이 있다가 다 뺀 경우엔 사진 제목이었으니 지운다).
    description: first ? first.title : existing?.photoKey ? null : existing?.description ?? null,
    photoCredit: first ? first.credit : null,
    extraPhotos: extras.length ? extras : null,
    name: f.get("name").trim() || location.name,
    lat: location.lat,
    lng: location.lng,
    address: location.address || null,
    label: f.get("label").trim() || null,
    quote: f.get("quote").trim() || null,
    youtubeUrl,
    musicArtist: f.get("musicArtist").trim() || null,
    musicTitle: f.get("musicTitle").trim() || null,
  };
  if (existing) {
    const updated = await runCourseMutation(client.models.CoursePlace.update({ id: existing.id, ...fields }), "장소 수정 실패");
    if (!updated) return;
    coursePlacesById[selectedCourseId] = list.map((p) => (p.id === updated.id ? updated : p));
    editingPlaceId = null;
  } else {
    const seq = list.length ? Math.max(...list.map((p) => p.seq)) + 1 : 1;
    // 장소의 authorId는 코스와 같아야 지도에 붙는다(js/storage.js fetchPublishedCourses).
    const authorId = courses.find((c) => c.id === selectedCourseId)?.authorId || null;
    const created = await runCourseMutation(
      client.models.CoursePlace.create({ courseId: selectedCourseId, seq, authorId, ...fields }),
      "장소 추가 실패",
    );
    if (!created) return;
    coursePlacesById[selectedCourseId] = [...list, created];
  }
  placeDraft = null;
  placePhotoSlots = null;
  renderCoursesTab();
}

async function handlePlaceAction(action, placeId) {
  if (action === "search") {
    handlePlaceSearch();
    return;
  }
  const list = coursePlacesById[selectedCourseId] || [];
  const index = list.findIndex((p) => p.id === placeId);
  const place = list[index];
  if (action === "edit") {
    editingPlaceId = placeId;
    placeDraft = null;
    placePhotoSlots = null;
    renderCoursesTab();
    document.getElementById("place-form").scrollIntoView({ behavior: "smooth" });
    return;
  } else if (action === "cancel-edit") {
    editingPlaceId = null;
    placeDraft = null;
    placePhotoSlots = null;
  } else if (action === "up" || action === "down") {
    const other = list[action === "up" ? index - 1 : index + 1];
    if (!other) return;
    // seq를 맞바꾼다 — 둘 중 하나만 저장되면 순서가 같은 값으로 겹치므로
    // 실패하면 목록을 다시 불러와 실제 상태를 보여준다.
    const a = await runCourseMutation(client.models.CoursePlace.update({ id: place.id, seq: other.seq }), "순서 변경 실패");
    const b = a && await runCourseMutation(client.models.CoursePlace.update({ id: other.id, seq: place.seq }), "순서 변경 실패");
    if (!a || !b) {
      courses = null;
      renderCoursesTab();
      return;
    }
    coursePlacesById[selectedCourseId] = list.map((p) => (p.id === a.id ? a : p.id === b.id ? b : p)).sort((x, y) => x.seq - y.seq);
  } else if (action === "delete") {
    if (!confirm(`"${place.name}"을(를) 이 코스에서 삭제할까요?`)) return;
    const ok = await runCourseMutation(client.models.CoursePlace.delete({ id: placeId }), "장소 삭제 실패");
    if (!ok) return;
    coursePlacesById[selectedCourseId] = list.filter((p) => p.id !== placeId);
    if (editingPlaceId === placeId) editingPlaceId = null;
  }
  renderCoursesTab();
}

function renderActiveTab() {
  if (activeTab === "queue") renderQueueTab();
  else if (activeTab === "all") renderAllTab();
  else if (activeTab === "words") renderWordsTab();
  else if (activeTab === "visits") renderVisitsTab();
  else if (activeTab === "members") renderMembersTab();
  else if (activeTab === "bulk") renderBulkTab();
  else if (activeTab === "courses") renderCoursesTab();
  hydrateAdminPhotos();
}

document.getElementById("admin-content").addEventListener("focusin", (e) => {
  selectCourseGuideKey(courseGuideKeyForInput(e.target));
});

document.getElementById("admin-content").addEventListener("click", (e) => {
  const guideScreenBtn = e.target.closest("[data-guide-screen]");
  if (guideScreenBtn) {
    guideScreen = guideScreenBtn.dataset.guideScreen;
    renderCourseGuide();
    return;
  }
  const guideKeyBtn = e.target.closest("[data-guide-key]");
  if (guideKeyBtn) {
    guideKey = guideKeyBtn.dataset.guideKey;
    renderCourseGuide();
    return;
  }
  const deviceBtn = e.target.closest(".device-badge");
  if (deviceBtn) {
    setDeviceFilter(deviceBtn.dataset.device);
    return;
  }
  const courseBtn = e.target.closest("[data-course-action]");
  if (courseBtn) {
    handleCourseAction(courseBtn.dataset.courseAction, courseBtn.dataset.courseId);
    return;
  }
  const placeBtn = e.target.closest("[data-place-action]");
  if (placeBtn) {
    if (placeBtn.dataset.placeAction === "pick") pickSearchResult(Number(placeBtn.dataset.resultIndex));
    else handlePlaceAction(placeBtn.dataset.placeAction, placeBtn.dataset.placeId);
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

  const role = await getSessionRole();
  if (role) {
    await bootAdminClient(role);
    showDashboard();
  } else {
    showLogin();
  }
})();
