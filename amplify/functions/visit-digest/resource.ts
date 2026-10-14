import { defineFunction, secret } from '@aws-amplify/backend';

// 운영자용 "새 기기 방문" 요약 메일(2026-10-14) — 매일 아침 9시(KST)에
// 전날(한국 날짜) 처음 나타난 기기 ID가 있으면 운영자에게 한 통 보낸다.
// 방문마다 보내면 방문이 늘수록 메일이 쌓여 하루 1회 묶음으로 정했다.
// 어드민 "내 방문 제외" 기기는 뺀다. 발송은 reaction-digest와 같은 Resend.
// data 스택 소속인 이유도 reaction-digest와 같다(순환 의존성 방지).
export const visitDigestFn = defineFunction({
  name: 'visit-digest',
  entry: './handler.ts',
  schedule: { cron: '0 9 * * ? *', timezone: 'Asia/Seoul' },
  // PageView 테이블은 프로비전 5 RCU라 전체 스캔이 느릴 수 있어 넉넉히.
  timeoutSeconds: 300,
  environment: {
    RESEND_API_KEY: secret('RESEND_API_KEY'),
    DIGEST_TO: 'hello@todoc.us',
  },
  resourceGroupName: 'data',
});
