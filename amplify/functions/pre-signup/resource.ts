import { defineFunction } from '@aws-amplify/backend';

// 가입 시 이메일 인증 코드 단계를 없애기 위한 Cognito Pre Sign-up 트리거.
// Amplify Gen2 defineAuth는 "인증 없이 바로 가입 완료" 옵션을 직접 제공하지
// 않아서(Cognito가 기본적으로 이메일 인증 전엔 UNCONFIRMED 상태로 로그인을
// 막음), 이 트리거가 가입 요청마다 자동으로 확인 처리를 해준다(handler.ts
// 참고). 이메일 인증은 비밀번호를 잊었을 때 재설정 코드 발송 용도로만 쓴다.
export const preSignUpFn = defineFunction({
  name: 'pre-signup',
  entry: './handler.ts',
});
