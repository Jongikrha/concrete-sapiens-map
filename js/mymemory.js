// ============================================================
// GNB(계정 아바타) — 내가 남긴/떠올린/전달한 기억 목록 + 로그아웃
// ============================================================
// 로그인 상태일 때만 화면 오른쪽 상단에 이메일 첫 글자를 담은 동그라미가
// 뜬다. 세 목록 모두 실계정 서버 조회 대신 이미 검증된 로컬 상관관계를
// 재사용한다 — "내가 남긴 기억"은 authorDeviceId(브라우저 단위, Story가
// 이미 guest/authenticated에 read를 열어둠), "떠올린/전달한 기억"은 기존
// 반응 추적과 동일한 패턴의 localStorage 기록. 계정 소유자(owner) 기반
// 서버 권한은 identityPool 인증모드와의 호환성이 불확실하고 지금은
// 로컬에서 미리 배포 검증을 할 수 없어서(2026-08-11) 의도적으로 피했다 —
// 나중에 sandbox로 검증 가능해지면 계정 기준(기기 무관) 조회로 옮길 수 있다.

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
const NOTIF_SEEN_KEY = "concrete_sapiens_notif_seen_v1";
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
      // 뱃지 도입 이후 처음 추적하는 내 글 — 기존에 쌓여있던 반응/이웃
      // 글이 전부 "새 알림"으로 한꺼번에 터지지 않도록, 알림 없이 지금
      // 값을 바로 확인된 기준값으로 저장해둔다(계정 메뉴를 열 때까지
      // 기다리면 그 사이엔 비교 기준이 아예 없어 늘어도 못 잡아낸다).
      seen[story.id] = { reactionCount, addressCount, nearbyYearCount };
      seenUpdated = true;
      return;
    }
    if (reactionCount > prev.reactionCount || addressCount > prev.addressCount) {
      hasNew = true;
    }
    if (prev.nearbyYearCount === undefined) {
      // nearbyYearCount는 이 글에 이번에 처음 추가되는 지표(2026-08-14) —
      // 그 전까지 쌓여있던 근처 겹침을 전부 "새 알림"으로 터뜨리지 않도록
      // 위 !prev 분기와 같은 방식으로 기준값만 갱신한다.
      seen[story.id] = { ...prev, nearbyYearCount };
      seenUpdated = true;
    } else if (nearbyYearCount > prev.nearbyYearCount) {
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

// "posted"는 이 브라우저(authorDeviceId)에서 쓴 글과, 로그인 계정으로
// 연결된 글(StoryAuthor, owner 기반 조회)을 합쳐서 보여준다 — 계정으로
// 로그인했으면 다른 기기에서 쓴 글도 보이게 하기 위해서다(2026-08-14,
// storage.js listMyStoryAuthors 참고). 로그인 계정 연결은 이 기능 도입
// (2026-08-14) 이후 새로 쓴 글부터 적용되고, 아직 서버 조회가 필요해서
// 이 함수 자체가 async로 바뀌었다.
async function buildMyMemoryList(kind) {
  const all = Storage.getAllStories();
  if (kind === "posted") {
    const myStoryIds = new Set(all.filter((s) => s.authorDeviceId === Storage.getDeviceId()).map((s) => s.id));
    const user = Auth.getCurrentUser();
    if (user) {
      const myAuthorRecords = await Storage.listMyStoryAuthors();
      myAuthorRecords.forEach((r) => myStoryIds.add(r.storyId));
    }
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
  await Auth.signOut();
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
  document.getElementById("menu-logout").onclick = handleLogout;

  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("account-menu-wrap");
    if (!wrap.contains(e.target)) closeAccountMenu();
  });

  document.getElementById("mymemory-overlay").addEventListener("click", (e) => {
    if (e.target.id === "mymemory-overlay") closeMyMemoryList();
  });
}
