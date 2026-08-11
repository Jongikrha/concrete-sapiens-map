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
import { Amplify } from "https://esm.sh/aws-amplify@6.20.0";
import { generateClient } from "https://esm.sh/aws-amplify@6.20.0/data";
import {
  signUp,
  confirmSignUp,
  resendSignUpCode,
  signIn,
  signOut,
  getCurrentUser,
  fetchAuthSession,
} from "https://esm.sh/aws-amplify@6.20.0/auth";

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
    });
  })
  .catch((e) => {
    window._backendClientReadyResolvers.reject(e);
    window._authReadyResolvers.reject(e);
  });
