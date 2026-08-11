// ============================================================
// 회원가입 / 로그인 (1단계) — 계정 인프라 + 기억 남기기 진입 게이트
// ============================================================
// Cognito User Pool(amplify/auth/resource.ts, 이메일 로그인)을 그대로
// 쓴다. 실제 signUp/confirmSignUp/signIn/signOut 함수는 js/backend.js가
// window._authReady Promise로 넘겨준다(Amplify.configure를 backend.js
// 한 곳에서만 호출하기 위함 — backend.js 상단 주석 참고).
//
// 이 파일은 두 가지를 담당한다.
// 1) 전역 Auth 객체 — 로그인 상태 조회/변경의 단일 창구.
// 2) openAuthOverlay(onSuccess) — "기억 남기기" 진입점에서 로그인 안
//    되어 있을 때 띄우는 가입/인증/로그인 UI. 로그인(또는 가입+인증)
//    성공 시 onSuccess()를 호출해 원래 하려던 작성 흐름으로 이어간다.
// ============================================================

const Auth = {
  _sdk: null,
  _currentUser: null,

  async init() {
    try {
      this._sdk = await window._authReady;
      await this._refreshCurrentUser();
    } catch (e) {
      console.error("인증 초기화 실패", e);
    }
  },

  async _refreshCurrentUser() {
    try {
      const user = await this._sdk.getCurrentUser();
      this._currentUser = {
        userId: user.userId,
        email: user.signInDetails?.loginId || user.username,
      };
    } catch (e) {
      this._currentUser = null;
    }
    // GNB 아바타(js/mymemory.js)에 로그인 상태 변화를 알려준다. 이 상태가
    // 바뀌는 지점은 init/signIn/confirmSignUp뿐이라 여기 한 곳에서만
    // 갱신하면 충분하다(signOut은 별도로 직접 호출).
    if (typeof renderAccountAvatar === "function") renderAccountAvatar();
  },

  isLoggedIn() {
    return !!this._currentUser;
  },

  getCurrentUser() {
    return this._currentUser;
  },

  async signUp({ email, password }) {
    return this._sdk.signUp({
      username: email,
      password,
      options: { userAttributes: { email } },
    });
  },

  // 인증 코드 확인 후 곧바로 로그인 상태로 전환한다(기획서 5장 —
  // "가입 완료" = 로그인된 상태).
  async confirmSignUp({ email, code, password }) {
    await this._sdk.confirmSignUp({ username: email, confirmationCode: code });
    await this._sdk.signIn({ username: email, password });
    await this._refreshCurrentUser();
  },

  async resendCode({ email }) {
    return this._sdk.resendSignUpCode({ username: email });
  },

  async signIn({ email, password }) {
    const result = await this._sdk.signIn({ username: email, password });
    if (result.isSignedIn) await this._refreshCurrentUser();
    return result;
  },

  async signOut() {
    await this._sdk.signOut();
    this._currentUser = null;
    if (typeof renderAccountAvatar === "function") renderAccountAvatar();
  },

  // Cognito 예외 이름을 기획서 17장 문구에 맞춰 한국어로 옮긴다.
  mapError(e) {
    const known = {
      UsernameExistsException: "이미 존재하는 계정입니다. 로그인할까요?",
      InvalidPasswordException: "비밀번호는 영문 대/소문자·숫자·특수문자를 모두 포함해 8자 이상이어야 합니다.",
      InvalidParameterException: "이메일 형식을 확인해주세요.",
      CodeMismatchException: "인증 코드가 올바르지 않습니다.",
      ExpiredCodeException: "인증 코드가 만료되었습니다. 다시 보내기를 눌러주세요.",
      NotAuthorizedException: "이메일 또는 비밀번호가 올바르지 않습니다.",
      UserNotFoundException: "이메일 또는 비밀번호가 올바르지 않습니다.",
      UserNotConfirmedException: "이메일 인증이 완료되지 않았습니다. 인증 코드를 다시 보내드릴게요.",
      LimitExceededException: "잠시 후 다시 시도해주세요.",
      TooManyRequestsException: "잠시 후 다시 시도해주세요.",
    };
    return known[e?.name] || e?.message || "알 수 없는 오류가 발생했습니다.";
  },
};

// ------------------------------------------------------------
// 가입/인증/로그인 오버레이 UI
// ------------------------------------------------------------
let authMode = "signup"; // "signup" | "verify" | "login"
let authError = "";
let authBusy = false;
let pendingAuthSuccess = null;
let pendingSignupEmail = "";
let pendingSignupPassword = "";
// authBusy/authError 갱신 시 패널 전체를 다시 그리는데(innerHTML 교체),
// <input>에 value를 안 채워두면 사용자가 입력한 값이 그 순간 날아간다.
// 그래서 입력값도 여기 상태로 같이 들고 있다가 렌더할 때 그대로 채운다.
let authEmailValue = "";
let authPasswordValue = "";

// "기억 남기기"로 이어지는 모든 진입점(플로팅 버튼, 스팟 상세, 지도 클릭,
// 오늘의 질문, 검색 결과)이 공통으로 쓰는 게이트. 로그인 상태면 바로
// action()을 실행하고, 아니면 가입/로그인 화면을 띄운 뒤 성공 시 이어서
// 실행한다.
function requireLogin(action) {
  if (Auth.isLoggedIn()) {
    action();
    return;
  }
  openAuthOverlay(action);
}

function openAuthOverlay(onSuccess) {
  pendingAuthSuccess = onSuccess || null;
  authMode = "signup";
  authError = "";
  authBusy = false;
  authEmailValue = "";
  authPasswordValue = "";
  renderAuthPanel();
  document.getElementById("auth-overlay").classList.remove("hidden");
}

function closeAuthOverlay() {
  document.getElementById("auth-overlay").classList.add("hidden");
  pendingAuthSuccess = null;
  pendingSignupEmail = "";
  pendingSignupPassword = "";
  authEmailValue = "";
  authPasswordValue = "";
}

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// Cognito User Pool 기본 비밀번호 정책(최소 8자 + 대/소문자·숫자·특수문자
// 모두 포함)을 그대로 미러링한다. amplify/auth/resource.ts에 별도 설정이
// 없어 Amplify Gen2 기본값이 적용된 상태 — 서버까지 왕복하지 않고 미리
// 걸러서 "왜 막히는지" 바로 알려주기 위한 클라이언트 측 사전 검증이다.
function isValidPassword(v) {
  return (
    v.length >= 8 &&
    /[a-z]/.test(v) &&
    /[A-Z]/.test(v) &&
    /[0-9]/.test(v) &&
    /[^A-Za-z0-9]/.test(v)
  );
}

function renderAuthPanel() {
  const panel = document.getElementById("auth-panel");
  const errorHtml = authError ? `<p class="auth-error">${escapeHtml(authError)}</p>` : "";

  if (authMode === "signup") {
    panel.innerHTML = `
      <h2 class="composer-title">기억을 계속 남겨두려면<br />계정을 만들어주세요</h2>
      <label class="field-label">이메일</label>
      <input type="email" id="auth-email" class="input-field" placeholder="you@example.com" value="${escapeHtml(authEmailValue)}" />
      <label class="field-label">비밀번호</label>
      <input type="password" id="auth-password" class="input-field" placeholder="8자 이상" maxlength="128" value="${escapeHtml(authPasswordValue)}" />
      <p class="field-hint">영문 대/소문자, 숫자, 특수문자를 모두 포함해 8자 이상으로 만들어주세요.</p>
      ${errorHtml}
      <button class="btn-primary" id="auth-submit">계정 만들기</button>
      <button class="btn-secondary" id="auth-cancel">취소</button>
      <p class="auth-switch">이미 계정이 있나요? <button class="auth-switch-link" id="auth-goto-login">로그인</button></p>
    `;
    panel.querySelector("#auth-submit").onclick = handleSignupSubmit;
    panel.querySelector("#auth-goto-login").onclick = () => {
      authMode = "login";
      authError = "";
      authPasswordValue = "";
      renderAuthPanel();
    };
    panel.querySelector("#auth-cancel").onclick = closeAuthOverlay;
  } else if (authMode === "verify") {
    panel.innerHTML = `
      <h2 class="composer-title">이메일을 확인해주세요</h2>
      <p class="field-hint">${escapeHtml(pendingSignupEmail)}으로 인증 코드를 보냈습니다.</p>
      <label class="field-label">인증 코드</label>
      <input type="text" id="auth-code" class="input-field" placeholder="6자리 코드" inputmode="numeric" maxlength="6" />
      ${errorHtml}
      <button class="btn-primary" id="auth-submit">확인</button>
      <button class="btn-secondary" id="auth-cancel">취소</button>
      <p class="auth-switch">코드를 받지 못했나요? <button class="auth-switch-link" id="auth-resend">다시 보내기</button></p>
    `;
    panel.querySelector("#auth-submit").onclick = handleVerifySubmit;
    panel.querySelector("#auth-resend").onclick = handleResendCode;
    panel.querySelector("#auth-cancel").onclick = closeAuthOverlay;
  } else {
    panel.innerHTML = `
      <h2 class="composer-title">다시 만난 기억들</h2>
      <label class="field-label">이메일</label>
      <input type="email" id="auth-email" class="input-field" placeholder="you@example.com" value="${escapeHtml(authEmailValue)}" />
      <label class="field-label">비밀번호</label>
      <input type="password" id="auth-password" class="input-field" value="${escapeHtml(authPasswordValue)}" />
      ${errorHtml}
      <button class="btn-primary" id="auth-submit">로그인</button>
      <button class="btn-secondary" id="auth-cancel">취소</button>
      <p class="auth-switch">처음이신가요? <button class="auth-switch-link" id="auth-goto-signup">계정 만들기</button></p>
    `;
    panel.querySelector("#auth-submit").onclick = handleLoginSubmit;
    panel.querySelector("#auth-goto-signup").onclick = () => {
      authMode = "signup";
      authError = "";
      authPasswordValue = "";
      renderAuthPanel();
    };
    panel.querySelector("#auth-cancel").onclick = closeAuthOverlay;
  }

  const submitBtn = panel.querySelector("#auth-submit");
  if (submitBtn) submitBtn.disabled = authBusy;
}

async function handleSignupSubmit() {
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  authEmailValue = email;
  authPasswordValue = password;

  if (!isValidEmail(email)) {
    authError = "이메일 형식을 확인해주세요.";
    renderAuthPanel();
    return;
  }
  if (!isValidPassword(password)) {
    authError = "비밀번호는 영문 대/소문자, 숫자, 특수문자를 모두 포함해 8자 이상이어야 합니다.";
    renderAuthPanel();
    return;
  }

  authBusy = true;
  authError = "";
  renderAuthPanel();

  try {
    await Auth.signUp({ email, password });
    pendingSignupEmail = email;
    pendingSignupPassword = password;
    authMode = "verify";
    authBusy = false;
    renderAuthPanel();
  } catch (e) {
    authBusy = false;
    authError = Auth.mapError(e);
    renderAuthPanel();
  }
}

async function handleVerifySubmit() {
  const code = document.getElementById("auth-code").value.trim();
  if (!code) {
    authError = "인증 코드를 입력해주세요.";
    renderAuthPanel();
    return;
  }

  authBusy = true;
  authError = "";
  renderAuthPanel();

  try {
    await Auth.confirmSignUp({ email: pendingSignupEmail, code, password: pendingSignupPassword });
    const onSuccess = pendingAuthSuccess;
    closeAuthOverlay();
    if (onSuccess) onSuccess();
  } catch (e) {
    authBusy = false;
    authError = Auth.mapError(e);
    renderAuthPanel();
  }
}

async function handleResendCode() {
  try {
    await Auth.resendCode({ email: pendingSignupEmail });
    authError = "인증 코드를 다시 보냈습니다.";
  } catch (e) {
    authError = Auth.mapError(e);
  }
  renderAuthPanel();
}

async function handleLoginSubmit() {
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  authEmailValue = email;
  authPasswordValue = password;

  if (!email || !password) {
    authError = "이메일과 비밀번호를 입력해주세요.";
    renderAuthPanel();
    return;
  }

  authBusy = true;
  authError = "";
  renderAuthPanel();

  try {
    const result = await Auth.signIn({ email, password });
    if (!result.isSignedIn) {
      authBusy = false;
      authError = "로그인을 완료하지 못했습니다.";
      renderAuthPanel();
      return;
    }
    const onSuccess = pendingAuthSuccess;
    closeAuthOverlay();
    if (onSuccess) onSuccess();
  } catch (e) {
    authBusy = false;
    if (e?.name === "UserNotConfirmedException") {
      pendingSignupEmail = email;
      pendingSignupPassword = password;
      authMode = "verify";
      authError = Auth.mapError(e);
      try {
        await Auth.resendCode({ email });
      } catch (_) {
        // 재발송 실패는 조용히 무시 — 사용자는 "다시 보내기"로 재시도 가능
      }
      renderAuthPanel();
      return;
    }
    authError = Auth.mapError(e);
    renderAuthPanel();
  }
}
