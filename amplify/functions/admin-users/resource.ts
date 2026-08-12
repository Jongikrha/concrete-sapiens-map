import { defineFunction } from '@aws-amplify/backend';

// Cognito Admin API(ListUsers/AdminDisableUser 등)는 IAM 관리자 권한이 있어야
// 호출 가능해서 브라우저에서 직접 부를 수 없다. AppSync 커스텀 쿼리/뮤테이션
// 뒤에서 이 하나의 Lambda가 fieldName으로 분기해서 처리한다(handler.ts 참고).
export const adminUsersFn = defineFunction({
  name: 'admin-users',
  entry: './handler.ts',
});
