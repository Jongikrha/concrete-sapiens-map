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
}

function toggleAccountMenu() {
  document.getElementById("account-menu").classList.toggle("hidden");
}

function closeAccountMenu() {
  document.getElementById("account-menu").classList.add("hidden");
}

function buildMyMemoryList(kind) {
  const all = Storage.getAllStories();
  if (kind === "posted") return all.filter((s) => s.authorDeviceId === Storage.getDeviceId() && s.status !== "DELETED");
  if (kind === "reacted") return all.filter((s) => Storage.hasReacted(s.id));
  if (kind === "shared") return all.filter((s) => Storage.hasShared(s.id));
  return [];
}

// 항목을 누르면 목록이 닫히고 지도 이동 + 기억 카드가 바로 열린다.
// 카드의 뒤로가기(←)를 누르면 opts.scrollTop으로 스크롤 위치까지
// 복원해서 이 목록으로 돌아온다(최근 기억 목록과 동일 UX,
// navigateToStoryFromList/goBackFromSheet 참고).
function openMyMemoryList(kind, opts = {}) {
  closeAccountMenu();
  const panel = document.getElementById("mymemory-panel");
  const stories = [...buildMyMemoryList(kind)].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

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
