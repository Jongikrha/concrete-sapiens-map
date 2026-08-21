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
  recalled: "나를 떠올린 기억",
  overlap: "겹치는 기억",
  reacted: "내가 떠올린 기억",
  shared: "전달한 기억",
};

const MY_MEMORY_EMPTY = {
  posted: "아직 남긴 기억이 없습니다.",
  recalled: "아직 다른 사람이 떠올린 내 기억이 없습니다.",
  overlap: "아직 내 기억과 겹치는 다른 기억이 없습니다.",
  reacted: "아직 떠올린 기억이 없습니다.",
  shared: "아직 전달한 기억이 없습니다.",
};

// ------------------------------------------------------------
// 아바타 알림 뱃지 — "누가" 반응했는지/썼는지는 알려주지 않는(느슨한
// SNS) 대신, 내가 남긴 기억에 (1) 떠올랐어요가 늘었거나 (2) 반경 1km
// 안에 다른 사람의 새 기억이 생겼으면 점 하나만 켠다. 실시간이 아니라
// 로그인 상태로 앱을 열 때마다(=Storage가 서버에서 새로 받아온 시점)
// 확인하는 걸로 충분하다는 전제(2026-08-14 논의). "확인했다"는 계정
// 메뉴를 여는 순간으로 치고, 그때 스냅샷을 localStorage에 저장해 다음
// 비교 기준으로 삼는다 — 그 전까지는(예: 새로고침) 뱃지가 계속 떠 있어야
// 실제로 본 게 된다.
// v1 배포 당시 nearbyYearCount 버그(처음 계산되는 순간 실제 값을 그대로
// 기준값으로 조용히 저장해버려, 이미 존재하던 근처 겹침은 영원히 알림이
// 안 뜨던 문제, 2026-08-14 확인)로 잘못 저장된 v1 기록은 정상 값과
// 구분할 방법이 없어 키 자체를 올려 전체 사용자를 한 번 리셋한다 —
// reactionCount/addressCount도 같이 리셋되지만 그쪽은 원래도 "처음
// 계산 시 조용히 기준값만 저장"이 맞는 동작이라 알림이 갑자기 몰아쳐
// 뜨는 부작용은 없다.
const NOTIF_SEEN_KEY = "concrete_sapiens_notif_seen_v2";
// (2)는 원래 "정확히 같은 장소"와 "반경 1km + 같은 연도" 둘로 나뉘어
// 있었는데, "이해하기 어렵다"는 피드백으로 하나로 합쳤다(2026-08-20) —
// 연도 조건 없이 그냥 반경 1km 안의 다른 사람 기억이면 전부 겹침으로
// 친다(storySheet.js story-overlap-caption의 "정확히 같은 장소·같은
// 해" 카드 캡션과는 별개 기능, 그쪽은 그대로 둔다).
const OVERLAP_RADIUS_METERS = 1000;
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
  const recalledDot = document.getElementById("menu-recalled-dot");
  const overlapDot = document.getElementById("menu-overlap-dot");
  if (!dot) return;

  const user = Auth.getCurrentUser();
  if (!user) {
    dot.classList.add("hidden");
    if (recalledDot) recalledDot.classList.add("hidden");
    if (overlapDot) overlapDot.classList.add("hidden");
    _pendingNotifState = null;
    return;
  }

  const myStories = await buildMyMemoryList("posted");
  const seen = _getNotifSeenState();
  const currentState = {};
  let hasNew = false;
  // "나를 떠올린 기억"/"겹치는 기억" 메뉴 항목 전용 — 각자 자기 원인만
  // 추적한다(반응 vs 같은 장소·근처 새 기억).
  let hasNewReaction = false;
  let hasNewOverlap = false;
  let seenUpdated = false;

  myStories.forEach((story) => {
    const reactionCount = story.reactionCount || 0;
    // 반경 1km 안의 "다른 사람" 기억 개수 — 내가 같은 장소/근처에 또
    // 다른 내 기억을 남긴 경우는 "겹침"으로 안 친다. "겹치는 기억" 목록
    // (buildMyMemoryList의 "overlap")도 isMyStory로 내 글을 빼고
    // 보여주는데, 여기서 안 빼면 알림 점만 켜지고 정작 목록엔 아무것도
    // 안 뜨는 불일치가 생긴다(2026-08-20 제보 — 내 글끼리 겹쳐 써도
    // 알림이 왔다).
    const nearbyCount = Storage.getStoriesNear(story.lat, story.lng, OVERLAP_RADIUS_METERS)
      .filter((s) => s.id !== story.id && !Storage.isMyStory(s.id)).length;
    currentState[story.id] = { reactionCount, nearbyCount };

    const prev = seen[story.id];
    if (!prev) {
      // 뱃지 도입 이후 처음 추적하는 내 글. reactionCount는 이 알림
      // 기능 이전부터 카드에 이미 보이던 값이라, 과거 활동이 한꺼번에
      // "새 알림"으로 안 터지게 지금 값을 그대로 기준값으로 조용히
      // 저장한다. 반면 nearbyCount(반경 1km 겹침)는 이 알림 말고는
      // 어디에도 노출된 적 없는 정보라 "처음 계산되는 순간"이 곧
      // 사용자에게는 "새로 발견하는 순간"과 같다 — 그래서 기준값을
      // 0으로 저장해, 이미 존재하던 근처 기억도 다음 새로고침에서
      // 정상적으로 알려준다(실제 값은 계정 메뉴를 열 때 currentState로
      // 확정 저장된다 — 아래 markNotificationsSeen 참고).
      seen[story.id] = { reactionCount, nearbyCount: 0 };
      seenUpdated = true;
      if (nearbyCount > 0) {
        hasNew = true;
        hasNewOverlap = true;
      }
      return;
    }
    if (reactionCount > prev.reactionCount) hasNewReaction = true;
    // prev.nearbyCount가 없는(이 지표 도입 전에 저장된) 기록도 ||0로
    // 0 기준 취급되어 위와 같은 원칙으로 동작한다.
    if (nearbyCount > (prev.nearbyCount || 0)) hasNewOverlap = true;
    if (reactionCount > prev.reactionCount || hasNewOverlap) {
      hasNew = true;
    }
  });

  if (seenUpdated) _saveNotifSeenState(seen);
  _pendingNotifState = currentState;
  dot.classList.toggle("hidden", !hasNew);
  if (recalledDot) recalledDot.classList.toggle("hidden", !hasNewReaction);
  if (overlapDot) overlapDot.classList.toggle("hidden", !hasNewOverlap);
}

// 계정 메뉴를 열어야 "확인했다"로 치고 스냅샷을 저장한다 — 아바타만
// 보고 지나치거나 새로고침만 하는 건 확인으로 안 친다.
function markNotificationsSeen() {
  if (_pendingNotifState) _saveNotifSeenState(_pendingNotifState);
  document.getElementById("account-notif-dot").classList.add("hidden");
  const recalledDot = document.getElementById("menu-recalled-dot");
  if (recalledDot) recalledDot.classList.add("hidden");
  const overlapDot = document.getElementById("menu-overlap-dot");
  if (overlapDot) overlapDot.classList.add("hidden");
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
  // "나를 떠올린 기억" — 내가 남긴 글 중 다른 사람이 "떠올랐어요"를 누른
  // 것만 추려서 보여준다. reactionCount는 원래 "누가"는 절대 기록하지
  // 않는 익명 카운터라(storage.js toggleReaction 참고), 여기서도 반응자
  // 신원은 노출하지 않고 "내 글이 반응을 받았다"는 사실 + 그 글 내용만
  // 보여준다(2026-08-17, 익명성 유지 방향으로 결정).
  if (kind === "recalled") {
    const posted = await buildMyMemoryList("posted");
    return posted.filter((s) => (s.reactionCount || 0) > 0);
  }
  // "겹치는 기억" — 내 기억 반경 1km 안에 남겨진 다른 사람의 기억
  // (연도 무관, 아바타 알림 뱃지가 조용히 추적만 하던 걸 실제로 확인할
  // 수 있는 화면, 2026-08-20). 내가 같은 장소/근처에 여러 기억을 남긴
  // 경우 서로를 "겹친다"고 보여주면 이상해서 isMyStory로 내 글은
  // 걸러낸다.
  if (kind === "overlap") {
    const posted = await buildMyMemoryList("posted");
    const seenIds = new Set();
    const overlapping = [];
    posted.forEach((story) => {
      Storage.getStoriesNear(story.lat, story.lng, OVERLAP_RADIUS_METERS).forEach((s) => {
        if (s.id === story.id || Storage.isMyStory(s.id) || seenIds.has(s.id)) return;
        seenIds.add(s.id);
        overlapping.push(s);
      });
    });
    return overlapping;
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
  const rawStories = await buildMyMemoryList(kind);
  const renderItem = (story) => renderRecentListItem(story, { reactionCount: story.reactionCount || 0 });

  // 카드 마크업은 app.js의 renderRecentListItem을 그대로 재사용한다 —
  // "지금까지 쌓인 기억"/"오늘의 기억"과 같은 카드 디자인을 여기서 다시
  // 베끼면 나중에 한쪽만 고치고 잊어버리기 쉽다(2026-08-20).
  //
  // "내가 남긴 기억"만 시간여행순(연도·월 오름차순, 과거→현재)으로 보여준다
  // — 자기 인생을 시간 순서대로 돌아보는 목적에 맞춘다(2026-08-21). 다른
  // 목록(나를 떠올린/겹치는/전달한 기억 등)은 계속 최신 등록순 그대로 둔다.
  const listHtml = rawStories.length
    ? (kind === "posted"
        ? buildSortedListHtml(rawStories, "timetravel", renderItem)
        : [...rawStories]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .map(renderItem)
            .join(""))
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
  document.getElementById("menu-recalled").onclick = () => openMyMemoryList("recalled");
  document.getElementById("menu-overlap").onclick = () => openMyMemoryList("overlap");
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

  bindOverlayClickToClose("mymemory-overlay", closeMyMemoryList);
}
