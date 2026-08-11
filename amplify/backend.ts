import { defineBackend } from '@aws-amplify/backend';
import { BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { auth } from './auth/resource';
import { data } from './data/resource';

const backend = defineBackend({
  auth,
  data,
});

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
