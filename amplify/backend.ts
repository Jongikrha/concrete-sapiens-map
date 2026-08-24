import { defineBackend } from '@aws-amplify/backend';
import { BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { adminUsersFn } from './functions/admin-users/resource';

const backend = defineBackend({
  auth,
  data,
  adminUsersFn,
});

// 어드민 회원관리(adminListUsers 등)가 쓰는 Lambda — Cognito Admin API 호출용
// 권한을 이 User Pool 하나로만 좁혀서 부여한다.
backend.adminUsersFn.addEnvironment('USER_POOL_ID', backend.auth.resources.userPool.userPoolId);
backend.adminUsersFn.resources.lambda.role?.addToPrincipalPolicy(
  new PolicyStatement({
    actions: [
      'cognito-idp:ListUsers',
      'cognito-idp:ListUsersInGroup',
      'cognito-idp:AdminEnableUser',
      'cognito-idp:AdminDisableUser',
      'cognito-idp:AdminDeleteUser',
      'cognito-idp:AdminAddUserToGroup',
      'cognito-idp:AdminRemoveUserFromGroup',
      'cognito-idp:AdminSetUserPassword',
    ],
    resources: [backend.auth.resources.userPool.userPoolArn],
  })
);

// groups: ['Admins']를 쓰면 Identity Pool의 역할 매핑이 자동으로 "Token" 방식이
// 된다 — 로그인 토큰에 그룹 역할이 실려 있으면 IAM 인증(js/backend.js의 기본
// 클라이언트, 메인 페이지가 씀)에서도 일반 authenticated 역할 대신 그 그룹
// 전용 역할을 assume해버린다. Admins 그룹 역할은 기본적으로 권한이 하나도
// 없어서(Amplify Gen2 기본 동작) 이 상태로는 그냥 401로 막히고, IAM 정책을
// 채워줘도 @auth 트랜스포머의 allow.authenticated()/allow.group() 체크가
// IAM 모드에서는 "이 역할이 authenticated 역할 ARN과 정확히 같은가"만
// 보기 때문에(그룹 역할은 다른 ARN이라 항상 실패) 여전히 막힌다(2026-08-12
// 확인 — 어드민 계정으로 로그인한 채 메인 지도를 열면 재현됨).
// 이 그룹 전용 IAM 권한 체계는 애초에 이 앱에서 쓰지 않는다 — 어드민 권한은
// js/admin.js가 명시하는 authMode:'userPool'(원본 JWT, cognito:groups 클레임)
// 경로로만 검사한다. 그래서 Identity Pool 역할 매핑 자체를 지워서 IAM 인증은
// 그룹과 무관하게 항상 authenticated/unauthenticated 역할만 쓰도록 되돌린다.
backend.auth.resources.cfnResources.cfnIdentityPoolRoleAttachment.addPropertyDeletionOverride(
  'RoleMappings'
);

// DynamoDB 기본값은 On-Demand(PAY_PER_REQUEST)라 무료 티어가 적용되지 않는다.
// Provisioned 25 WCU/25 RCU는 기한 없이 무료(Always Free)이므로 여기서 강제한다.
// 반드시 첫 배포 전에 설정해야 한다 — 테이블 생성 후 바꾸면 재생성(데이터 유실)된다.
// 테이블 3개 × 5/5 = 15/25로 계정 전체 Always Free 한도 안에 여유 있게 들어온다.
const { cfnResources } = backend.data.resources;
for (const tableName of ['Story', 'BannedWord', 'PageView']) {
  cfnResources.amplifyDynamoDbTables[tableName].billingMode = BillingMode.PROVISIONED;
  cfnResources.amplifyDynamoDbTables[tableName].provisionedThroughput = {
    readCapacityUnits: 5,
    writeCapacityUnits: 5,
  };
}

// CDK가 생성하는 UserPool 템플릿은 Schema 속성을 항상 포함하는데, Cognito는
// Schema를 생성 시에만 받고 업데이트 API는 거부한다(Invalid AttributeDataType
// input) — https://github.com/aws/aws-cdk/issues/8585 로 알려진 CDK/Cognito
// 구조적 버그다. 그 결과 이 UserPool은 만들어진 뒤로 어떤 사소한 속성 변경이든
// 배포하려는 순간 항상 실패했다(2026-08-11 확인, 이메일 발신자 설정 변경 시도 중
// 발견). Schema를 업데이트 요청에서 아예 빼면 CloudFormation이 스키마를 건드리지
// 않으므로 이미 저장된 속성값에는 영향 없이 다른 UserPool 속성 변경이 정상 배포된다.
backend.auth.resources.cfnResources.cfnUserPool.addPropertyDeletionOverride('Schema');

// defineAuth()는 비밀번호 정책을 직접 설정하는 옵션이 없어 Amplify Gen2
// 기본값(8자+대소문자+숫자+특수문자 전부 필수)이 그대로 적용돼 있었다.
// 가입 진입장벽을 낮추기 위해 길이 조건만 남기고 문자 조합 요구는 전부
// 뺀다(2026-08-13). 프론트 검증(js/auth.js의 isValidPassword)도 동일하게
// 맞춰야 한다 — 서버만 풀고 클라이언트가 더 빡빡하게 막으면 의미 없음.
backend.auth.resources.cfnResources.cfnUserPool.addPropertyOverride('Policies.PasswordPolicy', {
  MinimumLength: 8,
  RequireLowercase: false,
  RequireUppercase: false,
  RequireNumbers: false,
  RequireSymbols: false,
});
