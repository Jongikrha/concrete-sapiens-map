// ============================================================
// 기억 남기기 (작성 화면)
// ============================================================

let pendingPin = null;

// 태그가 너무 많으면 해시태그 바 등에서 한 기억이 화면을 과도하게 차지해
// 최대 개수를 둔다(2026-08-15). 태그 입력창(칩)과 본문 속 인라인 #태그를
// 합친 최종 개수 둘 다 여기에 걸린다.
const MAX_HASHTAGS = 7;

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

  reverseGeocode(lat, lng).then(({ address, buildingName }) => {
    const addrEl = document.getElementById("composer-address-value");
    if (addrEl) {
      addrEl.textContent = (address && Storage.abbreviateAddress(address)) || "주소를 확인할 수 없습니다";
    }
    // 아직 아무것도 안 적은 상태(사용자가 미리 타이핑하지 않은 경우)에만
    // 채워준다 — 값을 덮어써서 이미 입력한 이름을 지우면 안 되기 때문.
    // 등록된 건물명(예: "서울역")이 있으면 그걸 우선, 없으면 주소로 채운다.
    const nameInput = document.getElementById("input-place-name");
    if (nameInput && !nameInput.value.trim()) {
      const prefillName = buildingName || (address && Storage.abbreviateAddress(address));
      if (prefillName) nameInput.value = prefillName;
    }
    if (pendingPin) pendingPin.address = address || null;
    updateComposerScrollbarBounds();
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

// 계절 코드(js/storage.js SEASON_LABELS와 동일) — 연도는 기억나도 정확한
// 월까진 확신이 없는 경우를 위해 월 select 맨 아래 묶어서 넣는다
// (2026-08-21). 새 입력 UI를 따로 만들지 않고 이미 있는 월 select에
// 옵션만 추가하는 이유: 사용자가 배워야 할 새 조작이 없다.
const SEASON_OPTIONS = [
  ["SP", "봄"],
  ["SU", "여름"],
  ["FA", "가을"],
  ["WI", "겨울"],
];

function buildMonthOptions(selectedMonth) {
  let opts = `<option value="">월</option>`;
  for (let m = 1; m <= 12; m++) {
    // referenceDate("YYYY-MM")에서 온 selectedMonth는 "07"처럼 0으로 채워져
    // 있어 문자열로 그대로 비교하면 옵션 값(7)과 안 맞는다 — 숫자로 비교.
    opts += `<option value="${m}" ${Number(m) === Number(selectedMonth) ? "selected" : ""}>${m}월</option>`;
  }
  opts += `<optgroup label="정확한 월이 기억나지 않으면">`;
  SEASON_OPTIONS.forEach(([code, label]) => {
    opts += `<option value="${code}" ${code === selectedMonth ? "selected" : ""}>${label}</option>`;
  });
  opts += `</optgroup>`;
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
    ? `<div class="field-hint">장소 이름을 기본으로 채워뒀어요. 다른 사람이 알아보기 쉽도록 자유롭게 고쳐 써보세요. 예) 서울역, 우리의 따뜻한 신혼집</div>`
    : "";

  const whereHtml = `
    <div class="input-with-icon">
      <span class="input-icon">${pin.isFreePin ? "✏️" : "🔍"}</span>
      <input type="text" id="input-place-name" class="input-field" placeholder="${escapeHtml(namePlaceholder)}" value="${escapeHtml(nameValue)}" maxlength="40" />
    </div>
    ${nameHint}
    <div class="field-address" id="composer-address-value">${escapeHtml((pin.address && Storage.abbreviateAddress(pin.address)) || "주소 확인 중...")}</div>
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
        <div class="field-hint ${dateMode !== "past" ? "hidden" : ""}" id="month-season-hint">월은 선택사항이에요. 정확한 월이 기억나지 않으면 봄/여름/가을/겨울을 고르거나, 아예 비워둬도 돼요.</div>
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

    <div class="composer-field-group">
      <div class="field-heading"><span class="field-num">05</span><span class="field-label-text">MUSIC</span><span class="field-optional-label">선택</span></div>
      <p class="field-desc">그 시절 들었던 노래가 있다면, 유튜브 링크를 붙여보세요.</p>
      <input type="url" id="input-youtube-url" class="input-field" placeholder="https://youtube.com/watch?v=..." maxlength="300" value="${escapeHtml((editing && editing.youtubeUrl) || "")}" />
      <div class="field-hint" id="youtube-url-hint"></div>
      <div class="music-meta-preview hidden" id="music-meta-preview">
        <p class="field-hint">이 노래가 맞나요? 다르면 고쳐주세요.</p>
        <div class="music-meta-row">
          <input type="text" id="input-music-artist" class="input-field input-field--sm" placeholder="아티스트" maxlength="60" value="${escapeHtml((editing && editing.musicArtist) || "")}" />
          <input type="text" id="input-music-title" class="input-field input-field--sm" placeholder="곡명" maxlength="80" value="${escapeHtml((editing && editing.musicTitle) || "")}" />
        </div>
        <button type="button" class="song-match-hint hidden" id="song-match-hint"></button>
      </div>
    </div>

    <div class="field-heading"><span class="field-num">06</span><span class="field-label-text">NAME</span></div>
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

  // 유튜브 URL을 붙이면 oEmbed로 원본 제목을 가져와 아티스트/곡명을 추정해
  // 미리 채워준다 — 제목 형식이 제각각이라 100% 정확하진 않아서 사용자가
  // 그대로 두거나 고쳐 쓰는 걸 전제로 한다(추측이 아니라 확인용 초안).
  // 수정 모드에서는 기존 URL의 videoId로 시작해야 한다 — null로 시작하면
  // URL을 안 건드리고 다른 필드만 만졌다가 커서가 스쳐가도 "새 영상"으로
  // 오인해 기존 아티스트/곡명을 지워버린다.
  let lastFetchedVideoId = Storage.extractYoutubeVideoId((editing && editing.youtubeUrl) || "");

  function updateMusicMetaVisibility(videoId) {
    const box = document.getElementById("music-meta-preview");
    if (box) box.classList.toggle("hidden", !videoId);
  }

  updateMusicMetaVisibility(Storage.extractYoutubeVideoId((editing && editing.youtubeUrl) || ""));

  panel.querySelector("#input-youtube-url").addEventListener("input", (e) => {
    const raw = e.target.value.trim();
    const hint = document.getElementById("youtube-url-hint");
    const videoId = Storage.extractYoutubeVideoId(raw);
    hint.textContent = raw && !videoId ? "유튜브 링크 형식을 확인해주세요." : "";
    updateMusicMetaVisibility(videoId);

    if (videoId === lastFetchedVideoId) return;
    if (!videoId) {
      lastFetchedVideoId = null;
      return;
    }

    // 링크가 가리키는 영상 자체가 바뀌었다 — 이전 영상에 대해 채워졌거나
    // 사용자가 손댔던 아티스트/곡명은 이제 새 영상과 무관하니 지워서,
    // 아래 자동채움 가드(값이 비어있을 때만 채움)가 새 영상에도 다시
    // 걸리게 한다. 그렇지 않으면 한 번이라도 손댄 뒤엔 다른 링크로
    // 바꿔도 영영 자동채움이 안 되는 문제가 있었다(2026-08-19).
    const artistInput = document.getElementById("input-music-artist");
    const titleInput = document.getElementById("input-music-title");
    if (artistInput) artistInput.value = "";
    if (titleInput) titleInput.value = "";
    lastFetchedVideoId = videoId;

    Storage.fetchYoutubeOEmbed(videoId).then((oembed) => {
      // 그 사이 URL이 바뀌었거나 이 작성 폼이 닫혔으면(다른 핀으로 재사용됐어도
      // pendingPin이 달라짐) 반영하지 않는다. 사용자가 이미 아티스트/곡명을
      // 직접 손댄 경우에도 자동으로 덮어쓰지 않는다.
      if (!oembed || !oembed.title || videoId !== lastFetchedVideoId || pendingPin !== pin) return;
      const artistInput = document.getElementById("input-music-artist");
      const titleInput = document.getElementById("input-music-title");
      if (!artistInput || !titleInput) return;
      if (artistInput.value.trim() || titleInput.value.trim()) return;
      // 채널명(author_name)을 두 번째 신호로 함께 넘긴다 — 제목에 구분자가
      // 없거나 순서가 뒤집힌 업로드에서 정확도를 크게 높여준다.
      const parsed = Storage.parseYoutubeMusicTitle(oembed.title, oembed.channelName);
      if (parsed.artist) artistInput.value = parsed.artist;
      if (parsed.title) titleInput.value = parsed.title;
      updateSongMatchHint();
    });
  });

  // 자동 추출이 "Sung si kyoun - 성시경(거리에서)"처럼 엉뚱하게 갈라놓아도,
  // 곡명이 겹치는 기존 곡이 있으면 "혹시 이 곡?" 제안을 보여준다(2026-08-19).
  // 자동으로 합치지 않고 눌러야만 반영 — 오탐이 있어도 무해하다.
  function updateSongMatchHint() {
    const hint = document.getElementById("song-match-hint");
    if (!hint) return;
    const artistVal = document.getElementById("input-music-artist").value.trim();
    const titleVal = document.getElementById("input-music-title").value.trim();
    const match = titleVal ? Storage.suggestSongMatch(artistVal, titleVal) : null;
    if (!match) {
      hint.classList.add("hidden");
      hint.onclick = null;
      return;
    }
    hint.textContent = `혹시 이 곡인가요? ${match.artist ? `${match.artist} · ` : ""}${match.title}`;
    hint.classList.remove("hidden");
    hint.onclick = () => {
      document.getElementById("input-music-artist").value = match.artist || "";
      document.getElementById("input-music-title").value = match.title;
      hint.classList.add("hidden");
    };
  }

  ["input-music-artist", "input-music-title"].forEach((id) => {
    panel.querySelector(`#${id}`).addEventListener("input", updateSongMatchHint);
  });
  updateSongMatchHint();

  // 자유 핀은 이름을 자동 채워두므로, 처음 포커스할 때 전체 선택해
  // 바로 타이핑으로 덮어쓸 수 있다는 걸(=수정 가능하다는 걸) 느끼게 한다.
  if (pin.isFreePin) {
    const nameInput = panel.querySelector("#input-place-name");
    if (nameInput) {
      nameInput.addEventListener("focus", () => nameInput.select(), { once: true });
    }
  }

  panel.querySelectorAll(".date-mode-toggle .mode-btn").forEach((btn) => {
    btn.onclick = () => {
      dateMode = btn.dataset.mode;
      panel.querySelectorAll(".date-mode-toggle .mode-btn").forEach((b) => b.classList.remove("mode-btn--active"));
      btn.classList.add("mode-btn--active");
      document.getElementById("year-month-row").classList.toggle("hidden", dateMode !== "past");
      document.getElementById("month-season-hint").classList.toggle("hidden", dateMode !== "past");
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
    // refocus는 Enter/","로 직접 커밋할 때만 켠다 — blur(다른 곳 클릭)로
    // 커밋할 때 다시 포커스를 뺏으면 그 클릭(예: 제출 버튼)이 씹힌다.
    const commitEntry = ({ refocus } = {}) => {
      const parts = entry.value.trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return;
      if (tagChips.length >= MAX_HASHTAGS) {
        alert(`태그는 최대 ${MAX_HASHTAGS}개까지 남길 수 있어요.`);
        entry.value = "";
        return;
      }
      parts.forEach((p) => {
        if (tagChips.length >= MAX_HASHTAGS) return;
        if (!tagChips.includes(p)) tagChips.push(p);
      });
      syncTagsHiddenInput();
      renderTagChips();
      if (refocus) document.getElementById("tag-entry").focus();
    };
    entry.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault();
        commitEntry({ refocus: true });
      }
    });
    // 태그를 쳐놓고 Enter/","를 안 누른 채 다른 필드를 클릭하거나 바로
    // 제출하면 글자만 남고 칩(둥근 박스)이 안 생기는 문제가 있었다 —
    // 포커스를 잃는 순간에도 커밋해서 항상 칩으로 보이게 한다
    // (2026-08-17 확인).
    entry.addEventListener("blur", () => commitEntry());
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
    const youtubeUrlInput = document.getElementById("input-youtube-url").value.trim();
    const musicArtistInput = document.getElementById("input-music-artist").value.trim();
    const musicTitleInput = document.getElementById("input-music-title").value.trim();

    if (youtubeUrlInput && !Storage.extractYoutubeVideoId(youtubeUrlInput)) {
      alert("유튜브 링크 형식을 확인해주세요. 예) https://youtube.com/watch?v=...");
      document.getElementById("input-youtube-url").focus();
      return;
    }

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
    // 월/계절은 선택사항이다(2026-08-21) — 연도는 기억나도 정확한 월까진
    // 확신이 없는 경우가 많다는 피드백. 연도만은 계속 필수로 둔다(getStoryYear
    // 기반 기능들 — 시간여행, 같은 해의 다른 기억 등 — 이 전부 연도에 기대고
    // 있어서, 연도까지 빠지면 "과거"를 고른 의미가 없어진다).
    if (dateMode === "past" && !yearInput) {
      alert("기억의 연도를 선택해주세요.");
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

    // 태그 입력창(칩)은 추가 시점에 이미 막아두지만, 본문에 직접 쓴
    // 인라인 #태그까지 합치면 최종 개수가 그걸 넘어설 수 있어 제출
    // 시점에도 한 번 더 확인한다.
    if (hashtags.length > MAX_HASHTAGS) {
      alert(`태그는 최대 ${MAX_HASHTAGS}개까지 남길 수 있어요. 본문의 #태그도 함께 계산돼요.`);
      return;
    }

    const sharedFields = {
      lat: pendingPin.lat,
      lng: pendingPin.lng,
      placeId: pendingPin.placeId,
      officialPlaceName: pendingPin.placeId ? (enteredName || pendingPin.officialPlaceName || null) : null,
      address: pendingPin.address || null,
      customName: !pendingPin.placeId && enteredName ? enteredName : null,
      content,
      youtubeUrl: youtubeUrlInput || null,
      musicArtist: youtubeUrlInput ? (musicArtistInput || null) : null,
      musicTitle: youtubeUrlInput ? (musicTitleInput || null) : null,
      hashtags,
      authorMode,
      displayAuthorName: authorMode === "custom" ? authorInput : "익명",
      dateMode,
      referenceDate: dateMode === "past"
        ? (monthInput ? `${yearInput}-${String(monthInput).padStart(2, "0")}` : yearInput)
        : null,
    };

    let story;
    if (editing) {
      story = Storage.updateStory(editing.id, sharedFields, {
        onFail: () => showToast("entry-toast", "수정 내용이 저장되지 않았어요. 잠시 후 다시 시도해주세요.", 3000),
      });
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
      Storage.saveStory(story, {
        onFail: () => showToast("entry-toast", "기억이 저장되지 않았어요. 잠시 후 다시 시도해주세요.", 3000),
      });
      const currentUser = Auth.getCurrentUser();
      if (currentUser) {
        Storage.recordStoryAuthor(story.id, currentUser.userId, currentUser.email);
        // "내 글" 캐시(storage.js isMyStory)에 바로 반영 — 서버 재조회를
        // 기다리지 않아도 방금 쓴 글에 곧바로 수정하기/삭제하기가 뜬다.
        Storage.addMyStoryId(story.id);
      }
    }

    closeComposer();
    clearSearchPin();
    renderMarkers();
    renderHashtagChips();
    renderSearchAreaModal();
    map.setCenter(new kakao.maps.LatLng(story.lat, story.lng));

    const group = Storage.getGroupedByPlace().find((g) => g.lat === story.lat && g.lng === story.lng);
    if (group) openSheet(group);
  };

  document.getElementById("composer-overlay").classList.remove("hidden");
  panel.scrollTop = 0;
  updateComposerScrollbarBounds();
}

// ------------------------------------------------------------
// 스크롤바 트랙 범위 실측 — 부제("...빛이 됩니다." 텍스트) 바로 아래에서
// 시작해서 제출 버튼("기억 남기기"/"수정 완료") 바로 아랫단까지만 보이게
// 한다. 헤더 높이나 주소 줄바꿈에 따라 매번 픽셀이 달라져서 고정 CSS
// 값으로는 못 맞추고, 열릴 때마다(그리고 주소가 비동기로 갱신될 때)
// 실제 레이아웃을 재서 --composer-scrollbar-top/bottom 커스텀
// 프로퍼티로 넘긴다(css/style.css의
// .composer-card-inner::-webkit-scrollbar-track이 이 값을 margin으로 씀).
//
// 시작점은 닫기(✕) 버튼이 아니라 부제 텍스트 기준이다 — composer-header가
// flex-start 정렬이라 ✕ 버튼(32px 높이)이 타이틀+부제 블록보다 짧아서,
// ✕ 버튼 아래를 기준으로 삼으면 부제 텍스트 중간에서 시작해버린다(수정
// 모드처럼 부제가 없는 경우엔 타이틀 아래를 대신 쓴다).
//
// 끝점은 제출 버튼 자체가 폼의 마지막 요소라 "전체 콘텐츠 끝
// (scrollHeight)에서 제출 버튼 바닥까지의 거리"로 재면 항상 카드
// 안쪽 padding-bottom(고정값)만 남는다 — 뷰포트 크기·주소 줄바꿈과
// 무관하게 안정적이다(2026-08-14, 이전엔 "이름 또는 닉네임" 버튼
// 중간을 기준으로 삼았는데 그 아래 안내문구 줄바꿈 여부에 따라 값이
// 흔들려서 버튼 기준으로 바꿨다).
function updateComposerScrollbarBounds() {
  const panel = document.getElementById("composer-panel");
  const topRefEl = panel && (panel.querySelector(".composer-subtitle") || panel.querySelector(".composer-title"));
  const submitBtn = panel && panel.querySelector("#btn-submit");
  if (!panel || !topRefEl || !submitBtn) return;

  const panelRect = panel.getBoundingClientRect();
  const topRefRect = topRefEl.getBoundingClientRect();
  const submitRect = submitBtn.getBoundingClientRect();

  const topGap = Math.max(0, topRefRect.bottom - panelRect.top);
  const submitBottomFromContentTop = submitRect.bottom - panelRect.top + panel.scrollTop;
  const bottomGap = Math.max(0, panel.scrollHeight - submitBottomFromContentTop);

  panel.style.setProperty("--composer-scrollbar-top", `${topGap}px`);
  panel.style.setProperty("--composer-scrollbar-bottom", `${bottomGap}px`);
}

function closeComposer() {
  document.getElementById("composer-overlay").classList.add("hidden");
  pendingPin = null;
}

function extractHashtags(text) {
  const matches = text.match(/#[^\s#]+/g);
  return matches ? [...new Set(matches)] : [];
}
