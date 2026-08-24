import { defineAuth } from '@aws-amplify/backend';
import { preSignUpFn } from '../functions/pre-signup/resource';

/**
 * Define and configure your auth resource
 * @see https://docs.amplify.aws/gen2/build-a-backend/auth
 */
export const auth = defineAuth({
  loginWith: {
    email: {
      // 이 템플릿은 Cognito의 VerificationMessageTemplate 하나로, 가입 인증과
      // 비밀번호 재설정에 공용으로 쓰인다. 가입 인증 코드는 preSignUp
      // 트리거로 없앴으므로(아래 triggers 참고) 실제로 이 문구가 나가는 건
      // 비밀번호 재설정뿐이라, 재설정 기준으로 문구를 맞췄다.
      // 기본값이 영어("Verify your new account" / "The verification code to
      // your new account is ...")라 재설정 상황과 문맥이 안 맞았고, 발신자가
      // Cognito 공용 주소라 스팸으로 분류되는 상황(2026-08-24 확인)에서
      // 정체불명의 영문 메일이 더 불리하게 작용했다.
      verificationEmailStyle: 'CODE',
      verificationEmailSubject: '[콘크리트 사피엔스 지도] 비밀번호 재설정 코드',
      verificationEmailBody: (createCode) =>
        `콘크리트 사피엔스 지도입니다.\n\n` +
        `비밀번호 재설정 코드는 ${createCode()} 입니다.\n` +
        `앱 화면에 이 코드를 입력하고 새 비밀번호를 설정해 주세요.\n\n` +
        `본인이 요청하지 않았다면 이 메일은 무시하셔도 됩니다. ` +
        `코드를 입력하지 않으면 비밀번호는 그대로 유지됩니다.`,
    },
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
