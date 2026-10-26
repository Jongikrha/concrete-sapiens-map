import { defineFunction, secret } from '@aws-amplify/backend';

// 작가(Curators 그룹)용 "어제 내 발자취 조회수" 메일(2026-10-26) — 매일 아침
// 9시(KST)에 작가마다 자기 코스(Course.authorId)의 어제 조회수·총 조회수를
// 한 통으로 보낸다. 어제 조회가 0인 작가는 건너뛴다(매일 같은 숫자만 오면
// 스팸처럼 느껴져서). 발송은 visit-digest와 같은 Resend, data 스택 소속인
// 이유도 같다(순환 의존성 방지).
export const curatorDigestFn = defineFunction({
  name: 'curator-digest',
  entry: './handler.ts',
  schedule: { cron: '0 9 * * ? *', timezone: 'Asia/Seoul' },
  // AppEvent 전체를 훑어 어제 조회만 센다.
  timeoutSeconds: 300,
  // 코드만 바꾸면 ampx가 hotswap(lambda:UpdateFunctionCode)으로 덮어쓰려다 배포
  // 계정 권한에 막힌다(visit-digest 주석) — 코드 수정 배포 땐 이 값도 같이 바꾼다.
  memoryMB: 320,
  environment: {
    RESEND_API_KEY: secret('RESEND_API_KEY'),
  },
  resourceGroupName: 'data',
});
