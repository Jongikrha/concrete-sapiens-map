// js/backend.js가 쓰는 export만 다시 내보낸다 — 새 export가 필요해지면
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
} from "aws-amplify/auth";
export { uploadData, getUrl } from "aws-amplify/storage";
