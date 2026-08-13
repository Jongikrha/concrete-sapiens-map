// ============================================================
// 기억 남기기 (작성 화면)
// ============================================================

let pendingPin = null;

// getDeviceId()는 storage.js(Storage.getDeviceId)로 이동 — 어드민 화면과
// GNB의 "내가 남긴 기억"이 같은 비식별 상관관계 ID를 공유해서 쓴다.

// ------------------------------------------------------------
// 자유 핀 작성 시작 — 주소를 먼저 조회한 뒤 작성 화면을 연다
// ------------------------------------------------------------
function startFreePinComposer(lat, lng, prefillContent) {
  openComposer({
    lat,
    lng,
    officialPlaceName: null,
    placeId: null,
    address: "주소 확인 중...",
    isFreePin: true,
    prefillContent: prefillContent || "",
  });

  reverseGeocode(lat, lng).then((address) => {
    const addrEl = document.getElementById("composer-address-value");
    if (addrEl) {
      addrEl.textContent = address || "주소를 확인할 수 없습니다";
    }
    if (pendingPin) pendingPin.address = address || null;
  });
}

function buildYearOptions(selectedYear) {
  const currentYear = new Date().getFullYear();
  let opts = `<option value="">연도</option>`;
  for (let y = currentYear; y >= CONFIG.MIN_YEAR; y--) {
    opts += `<option value="${y}" ${String(y) === String(selectedYear) ? "selected" : ""}>${y}년</option>`;
  }
  return opts;
}

function buildMonthOptions(selectedMonth) {
  let opts = `<option value="">월</option>`;
  for (let m = 1; m <= 12; m++) {
    opts += `<option value="${m}" ${String(m) === String(selectedMonth) ? "selected" : ""}>${m}월</option>`;
  }
  return opts;
}

/**
 * 내가 남긴 기억 수정 — storySheet.js의 "수정하기"에서 진입한다.
 * 기존 story를 pin 모양으로 감싸 openComposer를 그대로 재사용하고,
 * pin.editingStory가 있으면 openComposer가 수정 모드로 렌더링한다.
 */
function startEditComposer(story) {
  openComposer({
    lat: story.lat,
    lng: story.lng,
    officialPlaceName: story.officialPlaceName,
    placeId: story.placeId,
    address: story.address,
    customName: story.customName,
    isFreePin: !story.placeId,
    prefillContent: story.content,
    editingStory: story,
  });
}

function openComposer(pin) {
  pendingPin = pin;
  const panel = document.getElementById("composer-panel");
  const editing = pin.editingStory || null;

  const namePlaceholder = pin.isFreePin
    ? "이 장소를 뭐라고 부르시나요?"
    : "장소 이름을 확인하거나 고쳐 쓸 수 있어요";
  const nameValue = pin.isFreePin ? (pin.customName || "") : (pin.officialPlaceName || "");
  const nameHint = pin.isFreePin
    ? `<div class="field-hint">지번 주소만으로는 다른 사람이 어딘지 알아보기 어려워요. 자유롭게 붙여주세요. 예) 서울역, 우리의 따뜻한 신혼집</div>`
    : "";

  const whereHtml = `
    <div class="input-with-icon">
      <span class="input-icon">🔍</span>
      <input type="text" id="input-place-name" class="input-field" placeholder="${escapeHtml(namePlaceholder)}" value="${escapeHtml(nameValue)}" maxlength="40" />
    </div>
    ${nameHint}
    <div class="field-address" id="composer-address-value">${escapeHtml(pin.address || "주소 확인 중...")}</div>
  `;

  let dateMode = editing ? editing.dateMode : "past";
  let authorMode = editing ? editing.authorMode : "anonymous";
  const [initialYear, initialMonth] = editing && editing.dateMode === "past" && editing.referenceDate
    ? editing.referenceDate.split("-")
    : ["", ""];
  const initialTags = editing ? (editing.hashtags || []).join(" ") : "";
  const initialAuthorName = editing && editing.authorMode === "custom" ? (editing.displayAuthorName || "") : "";

  panel.innerHTML = `
    <div class="composer-header">
      <div class="composer-icon-box">🚩</div>
      <div class="composer-header-text">
        <h2 class="composer-title">${editing ? "기억 수정하기" : "기억 남기기"}</h2>
        ${editing ? "" : `<p class="composer-subtitle">당신의 기억이 지도에 남아 빛이 됩니다.</p>`}
      </div>
      <button class="composer-close-btn" id="btn-composer-close" aria-label="닫기">✕</button>
    </div>

    <div class="composer-section-card">
      <div class="composer-field-group">
        <div class="field-heading"><span class="field-num">01</span><span class="field-label-text">WHERE</span></div>
        ${whereHtml}
      </div>

      <div class="composer-field-group">
        <div class="field-heading"><span class="field-num">02</span><span class="field-label-text">WHEN</span></div>
        <div class="date-mode-toggle">
          <button class="mode-btn ${dateMode === "now" ? "mode-btn--active" : ""}" data-mode="now">지금</button>
          <button class="mode-btn ${dateMode === "past" ? "mode-btn--active" : ""}" data-mode="past">과거</button>
          <button class="mode-btn ${dateMode === "unknown" ? "mode-btn--active" : ""}" data-mode="unknown">기억나지 않음</button>
        </div>
        <div class="year-month-row ${dateMode !== "past" ? "hidden" : ""}" id="year-month-row">
          <select id="input-year">${buildYearOptions(initialYear)}</select>
          <select id="input-month">${buildMonthOptions(initialMonth)}</select>
        </div>
      </div>

      <div class="composer-field-group">
        <div class="field-heading"><span class="field-num">03</span><span class="field-label-text">MEMORY</span></div>
        <p class="field-desc">이곳에 남아 있는 기억을 적어주세요.</p>
        <textarea id="input-content" class="input-field textarea" maxlength="${CONFIG.MAX_CONTENT_LENGTH}" placeholder="당신의 기억을 자유롭게 적어주세요.">${escapeHtml(pin.prefillContent || "")}</textarea>
        <div class="char-count"><span id="char-count-num">${(pin.prefillContent || "").length}</span> / ${CONFIG.MAX_CONTENT_LENGTH}</div>
      </div>
    </div>

    <div class="field-heading"><span class="field-num">04</span><span class="field-label-text">TAGS</span></div>
    <p class="field-desc">띄어쓰기로 구분하여 여러 개 입력할 수 있어요.</p>
    <div class="tag-input-row" id="tag-input-row"></div>
    <input type="hidden" id="input-tags" value="${escapeHtml(initialTags)}" />
    <div class="field-hint">예) 첫사랑 그리움 이사 — # 없이 단어만 적어도 자동으로 붙어요.</div>

    <div class="field-heading"><span class="field-num">05</span><span class="field-label-text">NAME</span></div>
    <div class="author-mode-toggle">
      <button class="mode-btn ${authorMode === "anonymous" ? "mode-btn--active" : ""}" data-author-mode="anonymous">🐱 익명으로 남기기</button>
      <button class="mode-btn ${authorMode === "custom" ? "mode-btn--active" : ""}" data-author-mode="custom">👤 이름 또는 닉네임</button>
    </div>
    <input type="text" id="input-author" class="input-field ${authorMode !== "custom" ? "hidden" : ""}" style="margin-top:8px;" placeholder="이 기억을 어떤 이름으로 남길까요?" maxlength="30" value="${escapeHtml(initialAuthorName)}" />
    <div class="field-hint">당신의 이름은 지도에 공개되지 않아요.</div>

    <button class="btn-primary" id="btn-submit">${editing ? "수정 완료" : "기억 남기기"}</button>
  `;
  // innerHTML만 바꾸면 패널 자체의 스크롤 위치는 유지된다 — 직전에 폼을
  // 스크롤해서 닫은 적이 있으면 다음에 열 때도 그 위치(아래쪽)부터
  // 보이는 문제가 있어 새로 열 때마다 맨 위로 리셋한다.
  panel.scrollTop = 0;

  panel.querySelector("#input-content").addEventListener("input", (e) => {
    document.getElementById("char-count-num").textContent = e.target.value.length;
  });

  panel.querySelectorAll(".date-mode-toggle .mode-btn").forEach((btn) => {
    btn.onclick = () => {
      dateMode = btn.dataset.mode;
      panel.querySelectorAll(".date-mode-toggle .mode-btn").forEach((b) => b.classList.remove("mode-btn--active"));
      btn.classList.add("mode-btn--active");
      document.getElementById("year-month-row").classList.toggle("hidden", dateMode !== "past");
    };
  });

  panel.querySelectorAll(".author-mode-toggle .mode-btn").forEach((btn) => {
    btn.onclick = () => {
      authorMode = btn.dataset.authorMode;
      panel.querySelectorAll(".author-mode-toggle .mode-btn").forEach((b) => b.classList.remove("mode-btn--active"));
      btn.classList.add("mode-btn--active");
      document.getElementById("input-author").classList.toggle("hidden", authorMode !== "custom");
    };
  });

  // TAGS를 칩 형태로 보여준다. #input-tags(hidden)는 항상 칩 배열을
  // space-join한 값으로 동기화해뒀다가 제출 시 기존 파싱 로직(공백/콤마
  // 분리 → # 접두어 부착)이 그대로 읽게 한다 — 제출 로직은 안 건드림.
  let tagChips = initialTags ? initialTags.split(/\s+/).filter(Boolean) : [];

  function syncTagsHiddenInput() {
    document.getElementById("input-tags").value = tagChips.join(" ");
  }

  function renderTagChips() {
    const row = document.getElementById("tag-input-row");
    row.innerHTML = `
      ${tagChips.map((t, i) => `<span class="tag-chip">${escapeHtml(t)}<button type="button" class="tag-chip-remove" data-idx="${i}">✕</button></span>`).join("")}
      <input type="text" id="tag-entry" class="tag-entry-input" placeholder="${tagChips.length ? "" : "태그를 입력하세요"}" />
    `;
    row.querySelectorAll(".tag-chip-remove").forEach((btn) => {
      btn.onclick = () => {
        tagChips.splice(Number(btn.dataset.idx), 1);
        syncTagsHiddenInput();
        renderTagChips();
      };
    });
    const entry = document.getElementById("tag-entry");
    const commitEntry = () => {
      const parts = entry.value.trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return;
      parts.forEach((p) => { if (!tagChips.includes(p)) tagChips.push(p); });
      syncTagsHiddenInput();
      renderTagChips();
      document.getElementById("tag-entry").focus();
    };
    entry.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        commitEntry();
      }
    });
    syncTagsHiddenInput();
  }

  renderTagChips();

  document.getElementById("btn-composer-close").onclick = closeComposer;

  document.getElementById("btn-submit").onclick = () => {
    const content = document.getElementById("input-content").value.trim();
    const authorInput = document.getElementById("input-author").value.trim();
    const yearInput = document.getElementById("input-year").value;
    const monthInput = document.getElementById("input-month").value;
    // 칩으로 안 넘기고 입력창에 타이핑만 해둔 채(Enter/+ 안 누르고) 바로
    // 제출하는 경우까지 태그로 잡아준다.
    const pendingTagEntry = document.getElementById("tag-entry")?.value.trim() || "";
    const tagsInput = `${document.getElementById("input-tags").value} ${pendingTagEntry}`.trim();
    const nameInput = document.getElementById("input-place-name");
    const enteredName = nameInput ? nameInput.value.trim() : "";

    if (pendingPin.isFreePin && !enteredName) {
      alert("이 장소를 뭐라고 부르는지 적어주세요. 예) 서울역, 우리의 따뜻한 신혼집");
      nameInput.focus();
      return;
    }
    if (!content) {
      alert("기억을 적어주세요.");
      return;
    }
    if (Storage.containsBannedWord(content)) {
      alert("부적절한 단어가 포함되어 있어 남길 수 없어요. 표현을 조금 바꿔주세요.");
      return;
    }
    if (dateMode === "past" && (!yearInput || !monthInput)) {
      alert("기억의 연도와 월을 선택해주세요.");
      return;
    }
    if (dateMode === "unknown") {
      const confirmed = confirm(
        "정말 시점을 남기지 않을까요?\n\n연도를 남기면 나중에 \"같은 해의 다른 기억\"이나 시간여행 기능으로 이 기억을 다시 만날 수 있어요."
      );
      if (!confirmed) return;
    }
    if (authorMode === "custom" && !authorInput) {
      alert("이름 또는 닉네임을 입력해주세요.");
      return;
    }

    const tagsFromField = tagsInput
      ? tagsInput.split(/\s|,/).map((t) => t.trim()).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`))
      : [];
    const hashtags = [...new Set([...extractHashtags(content), ...tagsFromField])];

    const sharedFields = {
      lat: pendingPin.lat,
      lng: pendingPin.lng,
      placeId: pendingPin.placeId,
      officialPlaceName: pendingPin.placeId ? (enteredName || pendingPin.officialPlaceName || null) : null,
      address: pendingPin.address || null,
      customName: !pendingPin.placeId && enteredName ? enteredName : null,
      content,
      hashtags,
      authorMode,
      displayAuthorName: authorMode === "custom" ? authorInput : "익명",
      dateMode,
      referenceDate: dateMode === "past" ? `${yearInput}-${String(monthInput).padStart(2, "0")}` : null,
    };

    let story;
    if (editing) {
      story = Storage.updateStory(editing.id, sharedFields);
    } else {
      story = {
        id: crypto.randomUUID(),
        publicId: Storage.generatePublicId(),
        ...sharedFields,
        createdAt: new Date().toISOString(),
        reportCount: 0,
        status: "ACTIVE",
        reactionCount: 0,
        shareCount: 0,
        viewCount: 0,
        authorDeviceId: Storage.getDeviceId(),
      };
      Storage.saveStory(story);
      const currentUser = Auth.getCurrentUser();
      if (currentUser) Storage.recordStoryAuthor(story.id, currentUser.userId, currentUser.email);
    }

    closeComposer();
    renderMarkers();
    renderHashtagChips();
    map.setCenter(new kakao.maps.LatLng(story.lat, story.lng));

    const group = Storage.getGroupedByPlace().find((g) => g.lat === story.lat && g.lng === story.lng);
    if (group) openSheet(group);
  };

  document.getElementById("composer-overlay").classList.remove("hidden");
  panel.scrollTop = 0;
}

function closeComposer() {
  document.getElementById("composer-overlay").classList.add("hidden");
  pendingPin = null;
}

function extractHashtags(text) {
  const matches = text.match(/#[^\s#]+/g);
  return matches ? [...new Set(matches)] : [];
}
