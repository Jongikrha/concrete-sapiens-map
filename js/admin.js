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
  const client = generateClient({ authMode: "userPool" });
  Storage._setClient(client);
  await Storage.refresh();
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

async function renderVisitsTab() {
  clearDeviceFilterBanner();
  document.getElementById("admin-content").innerHTML = `<p class="empty-state">불러오는 중...</p>`;
  const pageViews = await Storage.listPageViews();
  const topStories = [...Storage.getAllStories()]
    .filter((s) => (s.viewCount || 0) > 0)
    .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
    .slice(0, 10);

  const topHtml = topStories.length
    ? topStories.map((s) => `<div class="top-story-row"><span>${escapeHtml(s.content.slice(0, 40))}</span><span>${s.viewCount}회</span></div>`).join("")
    : `<p class="empty-state">아직 조회된 기억이 없습니다.</p>`;

  document.getElementById("admin-content").innerHTML = `
    <div class="admin-section-title">방문 현황</div>
    <div class="stat-row">
      <div class="stat-tile"><div class="num">${pageViews.length}</div><div class="label">전체 방문 수</div></div>
      <div class="stat-tile"><div class="num">${Storage.getAllStories().length}</div><div class="label">전체 기억 수</div></div>
    </div>
    <div class="admin-section-title">인기 기억 Top 10</div>
    ${topHtml}
  `;
}

function renderActiveTab() {
  if (activeTab === "queue") renderQueueTab();
  else if (activeTab === "all") renderAllTab();
  else if (activeTab === "words") renderWordsTab();
  else if (activeTab === "visits") renderVisitsTab();
}

document.getElementById("admin-content").addEventListener("click", (e) => {
  const deviceBtn = e.target.closest(".device-badge");
  if (deviceBtn) {
    setDeviceFilter(deviceBtn.dataset.device);
    return;
  }
  const actionBtn = e.target.closest("[data-action]");
  if (actionBtn) {
    handleCardAction(actionBtn.dataset.action, actionBtn.dataset.id);
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
