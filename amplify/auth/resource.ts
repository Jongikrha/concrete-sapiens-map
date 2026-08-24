import { defineAuth } from '@aws-amplify/backend';
import { preSignUpFn } from '../functions/pre-signup/resource';

/**
 * Define and configure your auth resource
 * @see https://docs.amplify.aws/gen2/build-a-backend/auth
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  // 가입 시 이메일 인증 코드 단계를 건너뛰기 위한 트리거(2026-08-13,
  // preSignUpFn 주석 참고) — 이메일/비밀번호만 맞으면 바로 가입 완료.
  triggers: {
    preSignUp: preSignUpFn,
  },
  groups: ['Admins'],
  // senders.email(SES 경유 발송)을 일부러 지정하지 않는다 — Cognito 기본
  // 발송(COGNITO_DEFAULT)을 쓴다는 뜻이다. no-reply@concretesapiens.com으로
  // 보내려면 SES 프로덕션 액세스가 필요한데 2회 반려됐고(2026-08-24 확인),
  // 샌드박스에서는 검증된 도메인 밖 주소로 메일이 나가지 않아 gmail/naver
  // 사용자가 비밀번호 재설정 코드를 못 받는다. 계정 복구 수단이 이메일
  // 하나뿐이라 복구 경로가 아예 막히므로, 브랜딩(발신자가
  // no-reply@verificationemail.com으로 표시됨)을 포기하고 발송 가능성을
  // 택했다. Cognito 기본 발송은 하루 50통 제한이 있지만 지금은 비밀번호
  // 재설정에만 쓰므로 충분하다(가입 인증 코드는 preSignUp 트리거로 없앰).
  // SES 프로덕션 액세스가 승인되면 이 블록과 backend.ts의 SourceArn
  // 오버라이드를 함께 되살린다.
});
