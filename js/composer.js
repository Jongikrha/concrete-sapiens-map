// ============================================================
// 기억 남기기 (작성 화면)
// ============================================================

let pendingPin = null;

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

function openComposer(pin) {
  pendingPin = pin;
  const panel = document.getElementById("composer-panel");

  const namePlaceholder = pin.isFreePin
    ? "이 장소를 뭐라고 부르시나요? (선택)"
    : "장소 이름을 확인하거나 고쳐 쓸 수 있어요";
  const nameValue = pin.isFreePin ? "" : (pin.officialPlaceName || "");

  const whereHtml = `
    <input type="text" id="input-place-name" class="input-field" placeholder="${escapeHtml(namePlaceholder)}" value="${escapeHtml(nameValue)}" maxlength="40" />
    <div class="field-address" id="composer-address-value">${escapeHtml(pin.address || "주소 확인 중...")}</div>
  `;

  panel.innerHTML = `
    <h2 class="composer-title">기억 남기기</h2>

    <label class="field-label">WHERE</label>
    ${whereHtml}

    <label class="field-label">WHEN</label>
    <div class="date-mode-toggle">
      <button class="mode-btn" data-mode="now">지금</button>
      <button class="mode-btn" data-mode="past">과거</button>
      <button class="mode-btn mode-btn--active" data-mode="unknown">기억나지 않음</button>
    </div>
    <div class="year-month-row hidden" id="year-month-row">
      <select id="input-year">${buildYearOptions()}</select>
      <select id="input-month">${buildMonthOptions()}</select>
    </div>

    <label class="field-label">MEMORY</label>
    <textarea id="input-content" class="input-field textarea" maxlength="${CONFIG.MAX_CONTENT_LENGTH}" placeholder="이곳에 남아 있는 기억을 적어주세요.">${escapeHtml(pin.prefillContent || "")}</textarea>
    <div class="char-count"><span id="char-count-num">${(pin.prefillContent || "").length}</span> / ${CONFIG.MAX_CONTENT_LENGTH}</div>

    <label class="field-label">TAGS</label>
    <input type="text" id="input-tags" class="input-field" placeholder="첫사랑 그리움" />
    <div class="field-hint">띄어쓰기로 구분해서 여러 개 입력할 수 있어요. 예) 첫사랑 그리움 이사 — # 없이 단어만 적어도 자동으로 붙어요.</div>

    <label class="field-label">NAME</label>
    <div class="author-mode-toggle">
      <button class="mode-btn mode-btn--active" data-author-mode="anonymous">익명</button>
      <button class="mode-btn" data-author-mode="custom">이름 또는 닉네임</button>
    </div>
    <input type="text" id="input-author" class="input-field hidden" style="margin-top:8px;" placeholder="이 기억을 어떤 이름으로 남길까요?" maxlength="30" />

    <button class="btn-primary" id="btn-submit">기억 남기기</button>
    <button class="btn-secondary" id="btn-cancel">취소</button>
  `;

  let dateMode = "unknown";
  let authorMode = "anonymous";

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

  document.getElementById("btn-cancel").onclick = closeComposer;

  document.getElementById("btn-submit").onclick = () => {
    const content = document.getElementById("input-content").value.trim();
    const authorInput = document.getElementById("input-author").value.trim();
    const yearInput = document.getElementById("input-year").value;
    const monthInput = document.getElementById("input-month").value;
    const tagsInput = document.getElementById("input-tags").value.trim();
    const nameInput = document.getElementById("input-place-name");
    const enteredName = nameInput ? nameInput.value.trim() : "";

    if (!content) {
      alert("기억을 적어주세요.");
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

    const story = {
      id: crypto.randomUUID(),
      publicId: Storage.generatePublicId(),
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
      createdAt: new Date().toISOString(),
      reportCount: 0,
      status: "ACTIVE",
      reactionCount: 0,
      shareCount: 0,
    };

    Storage.saveStory(story);
    closeComposer();
    renderMarkers();
    renderHashtagChips();
    map.setCenter(new kakao.maps.LatLng(story.lat, story.lng));

    const group = Storage.getGroupedByPlace().find((g) => g.lat === story.lat && g.lng === story.lng);
    if (group) openSheet(group);
  };

  document.getElementById("composer-overlay").classList.remove("hidden");
}

function closeComposer() {
  document.getElementById("composer-overlay").classList.add("hidden");
  pendingPin = null;
}

function extractHashtags(text) {
  const matches = text.match(/#[^\s#]+/g);
  return matches ? [...new Set(matches)] : [];
}
