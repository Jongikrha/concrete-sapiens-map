import type { PreSignUpTriggerHandler } from 'aws-lambda';

// autoConfirmUser: 가입 즉시 CONFIRMED 상태로 만들어 이메일 인증 코드
// 단계를 건너뛴다. autoVerifyEmail: email_verified를 true로 세팅해둬야
// 나중에 비밀번호를 잊었을 때 Cognito가 이 이메일로 재설정 코드를
// 정상적으로 보낼 수 있다(계정 복구 수단으로 이메일을 쓰려면 verified
// 상태가 필요함).
const handler: PreSignUpTriggerHandler = async (event) => {
  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;
  return event;
};

export { handler };
