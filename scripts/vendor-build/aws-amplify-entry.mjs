// js/backend.js와 js/admin.js가 쓰는 export만 다시 내보낸다 — 새 export가 필요해지면
// 여기에 추가하고 `npm run build:vendor`로 다시 빌드한다.
export { Amplify } from "aws-amplify";
export { generateClient } from "aws-amplify/data";
export {
  signUp,
  confirmSignUp,
  resendSignUpCode,
  signIn,
  signOut,
  getCurrentUser,
  fetchAuthSession,
  resetPassword,
  confirmResetPassword,
  updatePassword,
  deleteUser,
  signInWithRedirect,
} from "aws-amplify/auth";
// 카카오 로그인(signInWithRedirect)에서 돌아왔을 때 URL의 ?code=를 받아
// 로그인을 마무리하는 리스너 — Amplify.configure()와 같은 번들에 있어야
// 페이지 로드 시 자동으로 처리된다(2026-10-06).
import "aws-amplify/auth/enable-oauth-listener";
export { uploadData, getUrl } from "aws-amplify/storage";
