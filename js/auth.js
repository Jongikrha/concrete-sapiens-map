// ============================================================
// 회원가입 / 로그인 (1단계) — 계정 인프라 + 기억 남기기 진입 게이트
// ============================================================
// Cognito User Pool(amplify/auth/resource.ts, 이메일 로그인)을 그대로
// 쓴다. 실제 signUp/confirmSignUp/signIn/signOut 함수는 js/backend.js가
// window._authReady Promise로 넘겨준다(Amplify.configure를 backend.js
// 한 곳에서만 호출하기 위함 — backend.js 상단 주석 참고).
//
// 가입은 이메일 + 비밀번호(+확인) 입력만으로 바로 완료된다(2026-08-13).
// amplify/functions/pre-signup 트리거가 Cognito 쪽에서 자동으로 확인
// 처리를 해주기 때문 — 이메일 인증 코드는 더 이상 가입 단계에서 쓰지
// 않고, 비밀번호를 잊었을 때 재설정 코드 용도로만 남아있다(authMode
// "verify"는 그 이전에 가입했지만 아직 미확인 상태로 남아있는 레거시
// 계정이 로그인을 시도할 때의 폴백 경로로만 쓰인다 — handleLoginSubmit
// 참고).
//
// 이 파일은 두 가지를 담당한다.
// 1) 전역 Auth 객체 — 로그인 상태 조회/변경의 단일 창구.
// 2) openAuthOverlay(onSuccess) — "기억 남기기" 진입점에서 로그인 안
//    되어 있을 때 띄우는 가입/로그인 UI. 로그인(또는 가입) 성공 시
//    onSuccess()를 호출해 원래 하려던 작성 흐름으로 이어간다.
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
    // "내 글" 캐시(storage.js isMyStory — 수정하기/삭제하기 버튼 노출,
    // 카드 렌더링 중 동기로 참조)를 로그인 상태와 같이 갱신한다. 오직
    // 계정 연결만 보고 브라우저 기기ID는 절대 안 쓴다(2026-08-14) —
    // await로 완료를 기다려야 그 직후 그려지는 카드들이 최신 상태를 본다.
    if (this._currentUser) await Storage.refreshMyStoryIds();
    else Storage.clearMyStoryIds();
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

  // pre-signup 트리거가 자동으로 확인 처리를 해주므로(amplify/functions/
  // pre-signup 참고) signUp 직후 바로 signIn까지 이어서 "가입 완료 =
  // 로그인된 상태"를 만든다.
  async signUp({ email, password }) {
    await this._sdk.signUp({
      username: email,
      password,
      options: { userAttributes: { email } },
    });
    await this._sdk.signIn({ username: email, password });
    await this._refreshCurrentUser();
  },

  // 레거시 미확인 계정이 로그인을 시도할 때만 쓰는 인증 코드 확인 경로
  // (handleLoginSubmit의 UserNotConfirmedException 폴백).
  // password가 없으면(비밀번호 재설정 중 미확인 계정을 먼저 인증시키는
  // 경우 — handleForgotSubmit 참고) 로그인은 건너뛰고 인증만 완료한다.
  async confirmSignUp({ email, code, password }) {
    await this._sdk.confirmSignUp({ username: email, confirmationCode: code });
    if (password) {
      await this._sdk.signIn({ username: email, password });
      await this._refreshCurrentUser();
    }
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
    Storage.clearMyStoryIds();
    if (typeof renderAccountAvatar === "function") renderAccountAvatar();
  },

  async requestPasswordReset({ email }) {
    return this._sdk.resetPassword({ username: email });
  },

  // 코드 확인 후 곧바로 새 비밀번호로 로그인까지 이어간다(가입 완료 흐름과
  // 동일한 원칙 — 굳이 다시 로그인 폼을 거치게 하지 않는다).
  async confirmPasswordReset({ email, code, newPassword }) {
    await this._sdk.confirmResetPassword({ username: email, confirmationCode: code, newPassword });
    await this._sdk.signIn({ username: email, password: newPassword });
    await this._refreshCurrentUser();
  },

  // 재설정(이메일 코드)과 달리 로그인 상태에서 현재 비밀번호로 바로
  // 바꾸는 경로 — Cognito가 이미 발급한 세션을 그대로 쓴다.
  async updatePassword({ oldPassword, newPassword }) {
    return this._sdk.updatePassword({ oldPassword, newPassword });
  },

  // Cognito 예외 이름을 기획서 17장 문구에 맞춰 한국어로 옮긴다.
  mapError(e) {
    const known = {
      UsernameExistsException: "이미 존재하는 계정입니다. 로그인할까요?",
      InvalidPasswordException: "비밀번호는 8자 이상이어야 합니다.",
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
let authMode = "signup"; // "signup" | "verify" | "login" | "forgot" | "reset"
let authError = "";
let authBusy = false;
let pendingAuthSuccess = null;
let pendingSignupEmail = "";
let pendingSignupPassword = "";
let pendingResetEmail = "";
// "verify" 화면(인증 코드 입력)에 로그인 중 미확인 계정으로 들어왔는지,
// 비밀번호 재설정 중 미확인 계정으로 들어왔는지 구분한다 — 후자는
// 비밀번호를 모르니 인증 완료 후 로그인 대신 비밀번호 재설정으로
// 이어줘야 한다(handleVerifySubmit 참고).
let verifyIntent = "login";
// authBusy/authError 갱신 시 패널 전체를 다시 그리는데(innerHTML 교체),
// <input>에 value를 안 채워두면 사용자가 입력한 값이 그 순간 날아간다.
// 그래서 입력값도 여기 상태로 같이 들고 있다가 렌더할 때 그대로 채운다.
let authEmailValue = "";
let authPasswordValue = "";
let authPasswordConfirmValue = "";

// "기억 남기기"로 이어지는 모든 진입점(플로팅 버튼, 스팟 상세, 지도 클릭,
// 검색 결과)이 공통으로 쓰는 게이트. 로그인 상태면 바로
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
  authPasswordConfirmValue = "";
  renderAuthPanel();
  document.getElementById("auth-overlay").classList.remove("hidden");
  document.getElementById("auth-panel").scrollTop = 0;
}

function closeAuthOverlay() {
  document.getElementById("auth-overlay").classList.add("hidden");
  pendingAuthSuccess = null;
  pendingSignupEmail = "";
  pendingSignupPassword = "";
  pendingResetEmail = "";
  verifyIntent = "login";
  authEmailValue = "";
  authPasswordValue = "";
  authPasswordConfirmValue = "";
  // 상태만 비우고 패널을 다시 그리지 않으면, 숨겨진 auth-panel 안의
  // <input type="password"> DOM 값이 방금 입력했던 비밀번호를 그대로
  // 들고 남아있는다. 페이지에 <form> 경계가 없는 SPA라, 크롬이 나중에
  // 전혀 무관한 다른 입력(예: 기억 남기기 폼의 장소 이름)을 이 남은
  // 비밀번호 값과 한 쌍으로 착각해 "비밀번호를 저장하시겠습니까?"를
  // 띄우는 원인이 된다 — 닫을 때 실제로 비워서 렌더링한다.
  renderAuthPanel();
}

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

// amplify/backend.ts의 Policies.PasswordPolicy override와 동일한 조건
// (길이만 검사, 문자 조합 요구 없음)을 미러링한다 — 서버까지 왕복하지
// 않고 미리 걸러서 "왜 막히는지" 바로 알려주기 위한 클라이언트 측
// 사전 검증이다.
function isValidPassword(v) {
  return v.length >= 8;
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
      <label class="field-label">비밀번호 확인</label>
      <input type="password" id="auth-password-confirm" class="input-field" placeholder="비밀번호를 다시 입력해주세요" maxlength="128" value="${escapeHtml(authPasswordConfirmValue)}" />
      <p class="field-hint">8자 이상으로 만들어주세요.</p>
      ${errorHtml}
      <button class="btn-primary" id="auth-submit">계정 만들기</button>
      <button class="btn-secondary" id="auth-cancel">취소</button>
      <p class="auth-switch">이미 계정이 있나요? <button class="auth-switch-link" id="auth-goto-login">로그인</button></p>
      <p class="field-hint">
        계정을 만들면 <a href="terms.html" target="_blank" rel="noopener">이용약관</a> 및
        <a href="privacy.html" target="_blank" rel="noopener">개인정보처리방침</a>에 동의하는 것으로 간주됩니다.
      </p>
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
      <p class="field-hint">${escapeHtml(pendingSignupEmail)}으로 인증 코드를 보냈습니다. 메일이 안 보이면 스팸함도 확인해주세요.</p>
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
  } else if (authMode === "login") {
    panel.innerHTML = `
      <h2 class="composer-title">다시 만난 기억들</h2>
      <label class="field-label">이메일</label>
      <input type="email" id="auth-email" class="input-field" placeholder="you@example.com" value="${escapeHtml(authEmailValue)}" />
      <label class="field-label">비밀번호</label>
      <input type="password" id="auth-password" class="input-field" value="${escapeHtml(authPasswordValue)}" />
      ${errorHtml}
      <button class="btn-primary" id="auth-submit">로그인</button>
      <button class="btn-secondary" id="auth-cancel">취소</button>
      <p class="auth-switch">
        <button class="auth-switch-link" id="auth-goto-forgot">비밀번호를 잊으셨나요?</button>
      </p>
      <p class="auth-switch">처음이신가요? <button class="auth-switch-link" id="auth-goto-signup">계정 만들기</button></p>
    `;
    panel.querySelector("#auth-submit").onclick = handleLoginSubmit;
    panel.querySelector("#auth-goto-forgot").onclick = () => {
      authMode = "forgot";
      authError = "";
      authPasswordValue = "";
      renderAuthPanel();
    };
    panel.querySelector("#auth-goto-signup").onclick = () => {
      authMode = "signup";
      authError = "";
      authPasswordValue = "";
      renderAuthPanel();
    };
    panel.querySelector("#auth-cancel").onclick = closeAuthOverlay;
  } else if (authMode === "forgot") {
    panel.innerHTML = `
      <h2 class="composer-title">비밀번호를 잊으셨나요?</h2>
      <p class="field-hint">가입한 이메일로 재설정 코드를 보내드릴게요.</p>
      <label class="field-label">이메일</label>
      <input type="email" id="auth-email" class="input-field" placeholder="you@example.com" value="${escapeHtml(authEmailValue)}" />
      ${errorHtml}
      <button class="btn-primary" id="auth-submit">재설정 코드 받기</button>
      <button class="btn-secondary" id="auth-cancel">취소</button>
      <p class="auth-switch">로그인으로 돌아가기 <button class="auth-switch-link" id="auth-goto-login">로그인</button></p>
    `;
    panel.querySelector("#auth-submit").onclick = handleForgotSubmit;
    panel.querySelector("#auth-goto-login").onclick = () => {
      authMode = "login";
      authError = "";
      renderAuthPanel();
    };
    panel.querySelector("#auth-cancel").onclick = closeAuthOverlay;
  } else if (authMode === "reset") {
    panel.innerHTML = `
      <h2 class="composer-title">새 비밀번호를 설정해주세요</h2>
      <p class="field-hint">${escapeHtml(pendingResetEmail)}으로 재설정 코드를 보냈습니다(계정이 있는 경우). 메일이 안 보이면 스팸함도 확인해주세요.</p>
      <label class="field-label">인증 코드</label>
      <input type="text" id="auth-code" class="input-field" placeholder="6자리 코드" inputmode="numeric" maxlength="6" />
      <label class="field-label">새 비밀번호</label>
      <input type="password" id="auth-password" class="input-field" placeholder="8자 이상" maxlength="128" value="${escapeHtml(authPasswordValue)}" />
      <p class="field-hint">8자 이상으로 만들어주세요.</p>
      ${errorHtml}
      <button class="btn-primary" id="auth-submit">비밀번호 변경</button>
      <button class="btn-secondary" id="auth-cancel">취소</button>
      <p class="auth-switch">코드를 받지 못했나요? <button class="auth-switch-link" id="auth-resend">다시 보내기</button></p>
    `;
    panel.querySelector("#auth-submit").onclick = handleResetSubmit;
    panel.querySelector("#auth-resend").onclick = handleForgotResend;
    panel.querySelector("#auth-cancel").onclick = closeAuthOverlay;
  }

  const submitBtn = panel.querySelector("#auth-submit");
  if (submitBtn) submitBtn.disabled = authBusy;
}

async function handleSignupSubmit() {
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  const passwordConfirm = document.getElementById("auth-password-confirm").value;
  authEmailValue = email;
  authPasswordValue = password;
  authPasswordConfirmValue = passwordConfirm;

  if (!isValidEmail(email)) {
    authError = "이메일 형식을 확인해주세요.";
    renderAuthPanel();
    return;
  }
  if (!isValidPassword(password)) {
    authError = "비밀번호는 8자 이상이어야 합니다.";
    renderAuthPanel();
    return;
  }
  if (password !== passwordConfirm) {
    authError = "비밀번호가 일치하지 않습니다.";
    renderAuthPanel();
    return;
  }

  authBusy = true;
  authError = "";
  renderAuthPanel();

  try {
    await Auth.signUp({ email, password });
    const onSuccess = pendingAuthSuccess;
    closeAuthOverlay();
    if (onSuccess) onSuccess();
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
    if (verifyIntent === "forgot") {
      // 비밀번호를 모르는 상태로 들어온 경우 — 가입 인증만 완료하고,
      // 곧바로 비밀번호 재설정 코드를 새로 보내 그 화면으로 이어준다.
      await Auth.confirmSignUp({ email: pendingSignupEmail, code });
      await Auth.requestPasswordReset({ email: pendingSignupEmail });
      moveToResetScreen(pendingSignupEmail);
      return;
    }
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
      verifyIntent = "login";
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

async function handleForgotSubmit() {
  const email = document.getElementById("auth-email").value.trim();
  authEmailValue = email;

  if (!isValidEmail(email)) {
    authError = "이메일 형식을 확인해주세요.";
    renderAuthPanel();
    return;
  }

  authBusy = true;
  authError = "";
  renderAuthPanel();

  try {
    await Auth.requestPasswordReset({ email });
    moveToResetScreen(email);
  } catch (e) {
    authBusy = false;
    // 존재하지 않는 이메일이어도 "코드를 보냈다"고만 안내한다 — 계정 존재
    // 여부가 드러나면 이메일 목록을 훑어보는 공격에 악용될 수 있다
    // (기획서 7장 "계정 존재 여부를 과도하게 노출하지 않는다").
    if (e?.name === "UserNotFoundException") {
      moveToResetScreen(email);
      return;
    }
    // Cognito는 가입 인증(이메일 확인)을 아직 안 끝낸 계정에 대해
    // ForgotPassword를 거부하면서 InvalidParameterException(메시지에
    // "verified"가 들어감)을 던진다 — 이메일 형식과는 무관한데
    // Auth.mapError로 그냥 넘기면 "이메일 형식을 확인해주세요"로 잘못
    // 안내된다. 이메일 인증 단계를 없애기(2026-08-13) 전에 가입해서
    // 미확인 상태로 남은 레거시 계정이 이 경로를 탄다고 추정된다 —
    // pre-signup 트리거가 모든 신규 가입을 자동 확인시키는 지금 구조상
    // 실제 미확인 계정을 새로 재현해볼 수 없어 100% 확인은 못 했다.
    // 인증 코드를 다시 보내 먼저 가입 인증을 마치게 하고, 완료되면
    // 비밀번호 재설정으로 이어준다.
    if (e?.name === "InvalidParameterException" && /verified/i.test(e?.message || "")) {
      pendingSignupEmail = email;
      verifyIntent = "forgot";
      authMode = "verify";
      authError = "아직 가입 인증이 끝나지 않은 계정이에요. 인증 코드를 새로 보내드렸어요 — 인증을 마치면 비밀번호를 재설정할 수 있어요.";
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

function moveToResetScreen(email) {
  pendingResetEmail = email;
  authMode = "reset";
  authBusy = false;
  authError = "";
  authPasswordValue = "";
  renderAuthPanel();
}

async function handleForgotResend() {
  try {
    await Auth.requestPasswordReset({ email: pendingResetEmail });
    authError = "재설정 코드를 다시 보냈습니다.";
  } catch (e) {
    authError = e?.name === "UserNotFoundException" ? "재설정 코드를 다시 보냈습니다." : Auth.mapError(e);
  }
  renderAuthPanel();
}

async function handleResetSubmit() {
  const code = document.getElementById("auth-code").value.trim();
  const newPassword = document.getElementById("auth-password").value;
  authPasswordValue = newPassword;

  if (!code) {
    authError = "인증 코드를 입력해주세요.";
    renderAuthPanel();
    return;
  }
  if (!isValidPassword(newPassword)) {
    authError = "비밀번호는 8자 이상이어야 합니다.";
    renderAuthPanel();
    return;
  }

  authBusy = true;
  authError = "";
  renderAuthPanel();

  try {
    await Auth.confirmPasswordReset({ email: pendingResetEmail, code, newPassword });
    const onSuccess = pendingAuthSuccess;
    closeAuthOverlay();
    if (onSuccess) onSuccess();
  } catch (e) {
    authBusy = false;
    authError = Auth.mapError(e);
    renderAuthPanel();
  }
}

// ------------------------------------------------------------
// 비밀번호 변경(로그인 상태) — 계정 메뉴에서 진입, 이메일 인증 코드 없이
// 현재 비밀번호만 확인하고 바로 바꾼다.
// ------------------------------------------------------------
let changePwBusy = false;
let changePwError = "";

function openChangePasswordPanel() {
  changePwBusy = false;
  changePwError = "";
  renderChangePasswordPanel();
  document.getElementById("changepw-overlay").classList.remove("hidden");
}

function closeChangePasswordPanel() {
  document.getElementById("changepw-overlay").classList.add("hidden");
  changePwBusy = false;
  changePwError = "";
  // auth-overlay의 closeAuthOverlay와 같은 이유 — 비밀번호 입력값이 DOM에
  // 남아있으면 브라우저가 무관한 다른 입력을 저장 후보로 오인할 수 있다.
  renderChangePasswordPanel();
}

function renderChangePasswordPanel() {
  const panel = document.getElementById("changepw-panel");
  const errorHtml = changePwError ? `<p class="auth-error">${escapeHtml(changePwError)}</p>` : "";
  panel.innerHTML = `
    <h2 class="composer-title">비밀번호 변경</h2>
    <label class="field-label">현재 비밀번호</label>
    <input type="password" id="changepw-old" class="input-field" />
    <label class="field-label">새 비밀번호</label>
    <input type="password" id="changepw-new" class="input-field" placeholder="8자 이상" maxlength="128" />
    <label class="field-label">새 비밀번호 확인</label>
    <input type="password" id="changepw-confirm" class="input-field" maxlength="128" />
    <p class="field-hint">8자 이상으로 만들어주세요.</p>
    ${errorHtml}
    <button class="btn-primary" id="changepw-submit">비밀번호 변경</button>
    <button class="btn-secondary" id="changepw-cancel">취소</button>
  `;
  panel.querySelector("#changepw-submit").onclick = handleChangePasswordSubmit;
  panel.querySelector("#changepw-cancel").onclick = closeChangePasswordPanel;
  panel.querySelector("#changepw-submit").disabled = changePwBusy;
}

async function handleChangePasswordSubmit() {
  const oldPassword = document.getElementById("changepw-old").value;
  const newPassword = document.getElementById("changepw-new").value;
  const confirmPassword = document.getElementById("changepw-confirm").value;

  if (!oldPassword) {
    changePwError = "현재 비밀번호를 입력해주세요.";
    renderChangePasswordPanel();
    return;
  }
  if (!isValidPassword(newPassword)) {
    changePwError = "비밀번호는 8자 이상이어야 합니다.";
    renderChangePasswordPanel();
    return;
  }
  if (newPassword !== confirmPassword) {
    changePwError = "비밀번호가 일치하지 않습니다.";
    renderChangePasswordPanel();
    return;
  }

  changePwBusy = true;
  changePwError = "";
  renderChangePasswordPanel();

  try {
    await Auth.updatePassword({ oldPassword, newPassword });
    closeChangePasswordPanel();
    showToast("entry-toast", "비밀번호가 변경되었습니다", 2500);
  } catch (e) {
    changePwBusy = false;
    // 로그인 화면의 mapError는 NotAuthorizedException을 "이메일 또는
    // 비밀번호가 올바르지 않습니다"로 안내하는데, 여기선 이메일 입력이
    // 없으니 "현재 비밀번호가 올바르지 않습니다"로 바꿔준다.
    changePwError = e?.name === "NotAuthorizedException"
      ? "현재 비밀번호가 올바르지 않습니다."
      : Auth.mapError(e);
    renderChangePasswordPanel();
  }
}
