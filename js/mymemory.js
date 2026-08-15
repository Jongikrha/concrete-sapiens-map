// ============================================================
// GNB(계정 아바타) — 내가 남긴/떠올린/전달한 기억 목록 + 로그아웃
// ============================================================
// 로그인 상태일 때만 화면 오른쪽 상단에 이메일 첫 글자를 담은 동그라미가
// 뜬다. "내가 남긴 기억"은 오직 계정 연결(StoryAuthor, owner 기반 서버
// 조회)만 본다 — 브라우저 기기ID(authorDeviceId)는 절대 안 쓴다
// (2026-08-14, 같은 브라우저에서 계정을 바꾸면 이전 계정 글이 새 계정의
// "내 기억"에 섞여 보이던 사고 이후). "떠올린/전달한 기억"은 계정과
// 무관하게 "내가 반응/공유했는지"라 기존처럼 localStorage 기록을 쓴다.

const MY_MEMORY_TITLES = {
  posted: "내가 남긴 기억",
  reacted: "내가 떠올린 기억",
  shared: "전달한 기억",
};

const MY_MEMORY_EMPTY = {
  posted: "아직 남긴 기억이 없습니다.",
  reacted: "아직 떠올린 기억이 없습니다.",
  shared: "아직 전달한 기억이 없습니다.",
};

// ------------------------------------------------------------
// 아바타 알림 뱃지 — "누가" 반응했는지/썼는지는 알려주지 않는(느슨한
// SNS) 대신, 내가 남긴 기억에 (1) 떠올랐어요가 늘었거나 (2) 같은
// 장소에 새 기억이 생겼으면 점 하나만 켠다. 실시간이 아니라 로그인
// 상태로 앱을 열 때마다(=Storage가 서버에서 새로 받아온 시점) 확인하는
// 걸로 충분하다는 전제(2026-08-14 논의). "확인했다"는 계정 메뉴를 여는
// 순간으로 치고, 그때 스냅샷을 localStorage에 저장해 다음 비교 기준으로
// 삼는다 — 그 전까지는(예: 새로고침) 뱃지가 계속 떠 있어야 실제로 본 게
// 된다.
// v1 배포 당시 nearbyYearCount 버그(처음 계산되는 순간 실제 값을 그대로
// 기준값으로 조용히 저장해버려, 이미 존재하던 근처 겹침은 영원히 알림이
// 안 뜨던 문제, 2026-08-14 확인)로 잘못 저장된 v1 기록은 정상 값과
// 구분할 방법이 없어 키 자체를 올려 전체 사용자를 한 번 리셋한다 —
// reactionCount/addressCount도 같이 리셋되지만 그쪽은 원래도 "처음
// 계산 시 조용히 기준값만 저장"이 맞는 동작이라 알림이 갑자기 몰아쳐
// 뜨는 부작용은 없다.
const NOTIF_SEEN_KEY = "concrete_sapiens_notif_seen_v2";
// "장소는 달라도 걸어서 닿을 거리"의 기준(2026-08-14, storySheet.js
// story-overlap-caption과는 별개 — 카드 캡션은 정확히 같은 장소만, 알림은
// 반경까지 넓혀 "우연히 겹치는" 발견 범위를 키운다).
const NEARBY_YEAR_RADIUS_METERS = 1000;
let _pendingNotifState = null;

function _getNotifSeenState() {
  const raw = localStorage.getItem(NOTIF_SEEN_KEY);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function _saveNotifSeenState(state) {
  localStorage.setItem(NOTIF_SEEN_KEY, JSON.stringify(state));
}

// 로그인한 사용자만 대상 — 비로그인 상태는 아바타 자체가 없어(위
// renderAccountAvatar) 뱃지를 붙일 자리가 없다.
async function refreshNotificationBadge() {
  const dot = document.getElementById("account-notif-dot");
  if (!dot) return;

  const user = Auth.getCurrentUser();
  if (!user) {
    dot.classList.add("hidden");
    _pendingNotifState = null;
    return;
  }

  const myStories = await buildMyMemoryList("posted");
  const seen = _getNotifSeenState();
  const currentState = {};
  let hasNew = false;
  let seenUpdated = false;

  myStories.forEach((story) => {
    const reactionCount = story.reactionCount || 0;
    const addressCount = Storage.getStoriesAtSamePlace(story).length;
    const nearbyYearCount = Storage.getNearbySameYearStories(story, NEARBY_YEAR_RADIUS_METERS).length;
    currentState[story.id] = { reactionCount, addressCount, nearbyYearCount };

    const prev = seen[story.id];
    if (!prev) {
      // 뱃지 도입 이후 처음 추적하는 내 글. reactionCount/addressCount는
      // 이 알림 기능 이전부터 카드에 이미 보이던 값이라, 과거 활동이
      // 한꺼번에 "새 알림"으로 안 터지게 지금 값을 그대로 기준값으로
      // 조용히 저장한다. 반면 nearbyYearCount(반경 1000m 알림)는 이
      // 뱃지 말고는 어디에도 노출된 적 없는 정보라 "처음 계산되는 순간"이
      // 곧 사용자에게는 "새로 발견하는 순간"과 같다 — 그래서 기준값을
      // 0으로 저장해, 이미 존재하던 근처 기억도 다음 새로고침에서
      // 정상적으로 알려준다(실제 값은 계정 메뉴를 열 때 currentState로
      // 확정 저장된다 — 아래 markNotificationsSeen 참고).
      seen[story.id] = { reactionCount, addressCount, nearbyYearCount: 0 };
      seenUpdated = true;
      if (nearbyYearCount > 0) hasNew = true;
      return;
    }
    if (
      reactionCount > prev.reactionCount ||
      addressCount > prev.addressCount ||
      // prev.nearbyYearCount가 없는(이 지표 도입 전에 저장된) 기록도
      // ||0로 0 기준 취급되어 위와 같은 원칙으로 동작한다.
      nearbyYearCount > (prev.nearbyYearCount || 0)
    ) {
      hasNew = true;
    }
  });

  if (seenUpdated) _saveNotifSeenState(seen);
  _pendingNotifState = currentState;
  dot.classList.toggle("hidden", !hasNew);
}

// 계정 메뉴를 열어야 "확인했다"로 치고 스냅샷을 저장한다 — 아바타만
// 보고 지나치거나 새로고침만 하는 건 확인으로 안 친다.
function markNotificationsSeen() {
  if (_pendingNotifState) _saveNotifSeenState(_pendingNotifState);
  document.getElementById("account-notif-dot").classList.add("hidden");
}

function renderAccountAvatar() {
  const wrap = document.getElementById("account-menu-wrap");
  const avatar = document.getElementById("account-avatar");
  const user = Auth.getCurrentUser();

  if (!user) {
    wrap.classList.add("hidden");
    closeAccountMenu();
    return;
  }

  wrap.classList.remove("hidden");
  avatar.textContent = (user.email || "?").charAt(0).toUpperCase();
  document.getElementById("account-menu-email").textContent = user.email || "";
  refreshNotificationBadge();
}

function toggleAccountMenu() {
  const menu = document.getElementById("account-menu");
  const opening = menu.classList.contains("hidden");
  menu.classList.toggle("hidden");
  if (opening) markNotificationsSeen();
}

function closeAccountMenu() {
  document.getElementById("account-menu").classList.add("hidden");
}

// "posted"는 오직 계정 연결(StoryAuthor, owner 기반 조회)만 본다 —
// 브라우저 기기ID(authorDeviceId) 매칭은 완전히 뺐다(2026-08-14). 원래는
// 로그인 없이 게스트로 쓴 글도 "내 기억"에 남게 하려던 용도였는데,
// requireLogin이 글쓰기 진입점을 전부 막고 있어 로그인 없이는 애초에
// 글을 쓸 수 없다 — 그런데도 기기ID 매칭이 남아있어서, 같은 브라우저에서
// 계정을 바꿔 로그인하면 이전 계정이 쓴 글이 새 계정의 "내 기억"에도
// 그대로 보이는 문제가 있었다(실제 사고: 새로 가입한 계정에 다른
// 계정이 쓴 당현천 글이 "내 기억"으로 뜸). 로그인 안 한 상태에서는 팔로우할
// 계정이 없으니 빈 목록을 반환한다.
async function buildMyMemoryList(kind) {
  const all = Storage.getAllStories();
  if (kind === "posted") {
    const user = Auth.getCurrentUser();
    if (!user) return [];
    const myAuthorRecords = await Storage.listMyStoryAuthors();
    const myStoryIds = new Set(myAuthorRecords.map((r) => r.storyId));
    return all.filter((s) => myStoryIds.has(s.id) && s.status !== "DELETED");
  }
  if (kind === "reacted") return all.filter((s) => Storage.hasReacted(s.id));
  if (kind === "shared") return all.filter((s) => Storage.hasShared(s.id));
  return [];
}

// 항목을 누르면 목록이 닫히고 지도 이동 + 기억 카드가 바로 열린다.
// 카드의 뒤로가기(←)를 누르면 opts.scrollTop으로 스크롤 위치까지
// 복원해서 이 목록으로 돌아온다(최근 기억 목록과 동일 UX,
// navigateToStoryFromList/goBackFromSheet 참고).
async function openMyMemoryList(kind, opts = {}) {
  closeAccountMenu();
  const panel = document.getElementById("mymemory-panel");
  const stories = [...(await buildMyMemoryList(kind))].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const listHtml = stories.length
    ? stories.map((story) => {
        const year = Storage.getStoryYear(story);
        const title = Storage.getGroupTitle({
          placeId: story.placeId,
          officialPlaceName: story.officialPlaceName,
          customName: story.customName,
          address: story.address,
        });
        return `
          <div class="recent-item" data-id="${story.id}">
            <p class="recent-item-year">${year !== null ? `${year}년` : "시점 미상"}</p>
            <p class="recent-item-content">${escapeHtml(story.content)}</p>
            <p class="recent-item-place">${escapeHtml(title)}</p>
          </div>
        `;
      }).join("")
    : `<p class="recent-empty">${MY_MEMORY_EMPTY[kind]}</p>`;

  panel.innerHTML = `
    <div class="recent-header">
      <h2 class="composer-title" style="margin:0;">${MY_MEMORY_TITLES[kind]}</h2>
      <button class="recent-close" id="mymemory-close">✕</button>
    </div>
    ${listHtml}
  `;

  panel.querySelector("#mymemory-close").onclick = closeMyMemoryList;

  panel.querySelectorAll(".recent-item[data-id]").forEach((item) => {
    item.onclick = () => {
      const scrollTop = panel.scrollTop;
      closeMyMemoryList();
      navigateToStoryFromList(item.dataset.id, { kind: "mymemory", listKind: kind, scrollTop, label: MY_MEMORY_TITLES[kind] });
    };
  });

  document.getElementById("mymemory-overlay").classList.remove("hidden");
  // 목록에서 기억을 보다가 뒤로 돌아온 경우(opts.scrollTop)에는 보던
  // 위치를 유지하고, 그 외에는 이전에 열었을 때 남은 스크롤 위치가
  // 이어지지 않도록 맨 위로 되돌린다.
  panel.scrollTop = opts.scrollTop || 0;
}

function closeMyMemoryList() {
  document.getElementById("mymemory-overlay").classList.add("hidden");
}

async function handleLogout() {
  closeAccountMenu();
  // 내 기억 모드는 계정으로 연결된 글(StoryAuthor)까지 합쳐서 켠 상태일
  // 수 있는데, 로그아웃하면 그 연결이 끊기니 계속 켜진 채로 두면 안 된다
  // — 켜져 있었으면 로그아웃과 함께 자동으로 끄고 일반 지도 화면으로
  // 되돌린다(2026-08-14).
  const wasMyMemoryActive = myMemoryModeActive;
  await Auth.signOut();
  if (wasMyMemoryActive) {
    closeMyMemoryMode();
    renderMarkers();
  }
  showToast("entry-toast", "로그아웃되었습니다", 2000);
}

function bindAccountMenuEvents() {
  document.getElementById("account-avatar").onclick = (e) => {
    e.stopPropagation();
    toggleAccountMenu();
  };
  document.getElementById("menu-posted").onclick = () => openMyMemoryList("posted");
  document.getElementById("menu-reacted").onclick = () => openMyMemoryList("reacted");
  document.getElementById("menu-shared").onclick = () => openMyMemoryList("shared");
  document.getElementById("menu-changepw").onclick = () => {
    closeAccountMenu();
    openChangePasswordPanel();
  };
  document.getElementById("menu-logout").onclick = handleLogout;

  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("account-menu-wrap");
    if (!wrap.contains(e.target)) closeAccountMenu();
  });

  document.getElementById("mymemory-overlay").addEventListener("click", (e) => {
    if (e.target.id === "mymemory-overlay") closeMyMemoryList();
  });
}
