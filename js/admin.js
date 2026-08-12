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
      </div>
    </div>
  `;
}

async function handleCardAction(action, storyId) {
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
    stories = stories.filter((s) => s.content.includes(keyword));
  }
  stories = [...stories].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const html = stories.length
    ? stories.map((s) => storyCardHtml(s, { showRestore: s.status === "HIDDEN" })).join("")
    : `<p class="empty-state">해당하는 기억이 없습니다.</p>`;

  document.getElementById("admin-content").innerHTML = `
    <div class="admin-section-title">전체 콘텐츠 (${stories.length}건)</div>
    <div class="search-row"><input type="text" id="all-search-input" placeholder="내용 검색" value="${escapeHtml(keyword)}" /></div>
    ${html}
  `;
  document.getElementById("all-search-input").addEventListener("input", () => renderAllTab());
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

async function renderVisitsTab() {
  clearDeviceFilterBanner();
  document.getElementById("admin-content").innerHTML = `<p class="empty-state">불러오는 중...</p>`;
  const pageViews = await Storage.listPageViews();
  const dailyCounts = buildDailyVisitCounts(pageViews);
  const maxCount = Math.max(1, ...dailyCounts.map((d) => d.count));

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

  document.getElementById("admin-content").innerHTML = `
    <div class="admin-section-title">방문 현황</div>
    <div class="stat-row">
      <div class="stat-tile"><div class="num">${pageViews.length}</div><div class="label">전체 방문 수</div></div>
      <div class="stat-tile"><div class="num">${dailyCounts[0].count}</div><div class="label">오늘 방문 수</div></div>
      <div class="stat-tile"><div class="num">${Storage.getAllStories().length}</div><div class="label">전체 기억 수</div></div>
    </div>
    <div class="admin-section-title">최근 14일 방문 추이</div>
    <div class="daily-visit-chart">${dailyHtml}</div>
    <div class="admin-section-title">인기 기억 Top 10</div>
    ${topHtml}
  `;
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
  }
  members = null; // 다음 렌더에서 강제로 다시 불러오게
  renderMembersTab();
}

function renderActiveTab() {
  if (activeTab === "queue") renderQueueTab();
  else if (activeTab === "all") renderAllTab();
  else if (activeTab === "words") renderWordsTab();
  else if (activeTab === "visits") renderVisitsTab();
  else if (activeTab === "members") renderMembersTab();
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
  const outputs = await fetch(OUTPUTS_FILE).then((r) => r.json());
  Amplify.configure(outputs);

  if (await isAdminSession()) {
    await bootAdminClient();
    showDashboard();
  } else {
    showLogin();
  }
})();
