import { defineFunction, secret } from '@aws-amplify/backend';

// "떠올랐어요" 이메일 알림(2026-10-08) — 매일 저녁 8시(KST)에 지난 24시간
// 동안 생긴 StoryReaction을 글쓴이(StoryAuthor)별로 묶어 Resend로 한 통씩
// 보낸다. 반응마다 보내면 스팸처럼 느껴져 하루 1회 묶음으로 정했고, 누가
// 반응했는지는 밝히지 않는다([[project_avatar_notification_badge]]와 같은 원칙).
//
// 두 함수 모두 data 스택 소속으로 둔다 — backend.ts에서 DynamoDB 테이블
// 이름/권한을 넘겨받는데, 기본(function) 스택에 두면 data 스택이 이미
// adminUsersFn 때문에 function 스택을 참조하고 있어 순환 의존성이 생긴다
// (pre-signup의 resourceGroupName: 'auth'와 같은 이유).
export const reactionDigestFn = defineFunction({
  name: 'reaction-digest',
  entry: './handler.ts',
  schedule: { cron: '0 20 * * ? *', timezone: 'Asia/Seoul' },
  timeoutSeconds: 120,
  environment: {
    RESEND_API_KEY: secret('RESEND_API_KEY'),
  },
  resourceGroupName: 'data',
});

// 메일 하단 "수신 거부" 링크가 직접 부르는 공개 Function URL(backend.ts에서
// 붙임). 링크에 서명(token.ts)이 있어 남의 수신을 끌 수는 없다.
export const emailUnsubscribeFn = defineFunction({
  name: 'email-unsubscribe',
  entry: './unsubscribe.ts',
  environment: {
    RESEND_API_KEY: secret('RESEND_API_KEY'),
  },
  resourceGroupName: 'data',
});
