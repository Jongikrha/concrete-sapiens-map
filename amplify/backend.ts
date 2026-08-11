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
const { cfnResources } = backend.data.resources;
cfnResources.amplifyDynamoDbTables['Story'].billingMode = BillingMode.PROVISIONED;
cfnResources.amplifyDynamoDbTables['Story'].provisionedThroughput = {
  readCapacityUnits: 5,
  writeCapacityUnits: 5,
};
