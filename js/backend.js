// ============================================================
// AppSync 연결 (Amplify Gen2)
// ============================================================
// aws-amplify v6은 UMD 전역 번들이 없어 이 파일만 ES 모듈로 로드한다
// (index.html에서 <script type="module">). storage.js/auth.js는 카카오맵
// SDK 로딩 타이밍 때문에 계속 클래식 스크립트로 두고, 여기서는 데이터
// 클라이언트 생성 함수 + 인증 함수만 window에 얹어 필요할 때(Storage.init(),
// Auth.init() 안에서) 가져다 쓰게 한다. Auth도 같은 Amplify.configure()를
// 공유해야 해서(설정 두 번 하면 레이스 위험) 별도 모듈로 쪼개지 않고 여기서
// 함께 처리한다.
//
// 예전엔 이 4개를 esm.sh(https://esm.sh/aws-amplify@6.20.0, /data, /auth,
// /storage)에서 각각 받았는데, esm.sh가 내려주는 파일들은 실제 구현이 아니라
// 재수출(re-export) 래퍼라 각 진입점이 또 자기 하위 패키지를 새로 요청하는
// 체인을 만든다(예: /data → @aws-amplify/api → ...). 부팅 크리티컬 경로(로그인/
// 스토리 목록 조회 전에 반드시 끝나야 함)에 다단계 외부 도메인 왕복이 여러 개
// 끼어 있던 것 — 성능 분석(2026-09-08)으로 확인. scripts/vendor-build/로
// esbuild(이미 devDependency로 있음, 백엔드 CDK 빌드용)를 이용해 필요한
// export만 한 파일(js/vendor/aws-amplify.bundle.js)로 미리 묶어 커밋해두고,
// 같은 오리진에서 한 번에 받는다 — "빌드 없는 정적 배포" 원칙은 그대로
// 유지하면서(배포 시점엔 이 파일을 그대로 서빙만 함, 매번 새로 빌드 안 함),
// 소스가 바뀌면 `npm run build:vendor`로 다시 만들어서 커밋한다.
import {
  Amplify,
  generateClient,
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
  uploadData,
  getUrl,
} from "./vendor/aws-amplify.bundle.js";

// localhost에서는 별도 dev sandbox(amplify_outputs.local.json, gitignore
// 대상)를 쓰고, 배포된 사이트에서는 main과 함께 커밋된 amplify_outputs.json
// (prod sandbox)을 쓴다 — 로컬 테스트가 실제 서비스 데이터/리소스를
// 건드리지 않게 하기 위함.
const isLocalDev = ["localhost", "127.0.0.1"].includes(window.location.hostname);
const OUTPUTS_FILE = isLocalDev ? "amplify_outputs.local.json" : "amplify_outputs.json";

// index.html의 인라인 스크립트가 미리 만들어둔 Promise를 resolve/reject한다.
// (이 모듈이 카카오 SDK보다 늦게 로드될 수 있어서, 순서에 기대지 않고
// storage.js/auth.js가 이 Promise들을 기다리게 한다.)
fetch(OUTPUTS_FILE)
  .then((r) => r.json())
  .then((outputs) => {
    Amplify.configure(outputs);
    window._backendClientReadyResolvers.resolve(generateClient());
    window._authReadyResolvers.resolve({
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
    });
    window._storageReadyResolvers.resolve({ uploadData, getUrl });
  })
  .catch((e) => {
    window._backendClientReadyResolvers.reject(e);
    window._authReadyResolvers.reject(e);
    window._storageReadyResolvers.reject(e);
  });
