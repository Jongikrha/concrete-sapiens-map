import { defineAuth } from '@aws-amplify/backend';

/**
 * Define and configure your auth resource
 * @see https://docs.amplify.aws/gen2/build-a-backend/auth
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
  groups: ['Admins'],
  senders: {
    email: {
      // SES에는 concretesapiens.com 도메인 단위로만 검증해뒀다(no-reply 주소라
      // 수신함이 없어 이메일 주소 단위 검증은 애초에 불가능). 설치된
      // aws-cdk-lib(2.244.0)엔 도메인 단위 옵션(sesVerifiedDomain)이 없어
      // SourceArn을 이메일 주소 identity ARN으로만 생성하므로, 실제 SourceArn
      // 덮어쓰기는 backend.ts의 CDK escape hatch에서 처리한다.
      fromEmail: 'no-reply@concretesapiens.com',
      fromName: '콘크리트 사피엔스 지도',
    },
  },
});
