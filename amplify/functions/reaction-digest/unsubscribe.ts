import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { readUnsubscribeToken } from './token';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function page(message: string, statusCode = 200) {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>콘크리트 사피엔스</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:480px;margin:80px auto;padding:0 16px;color:#222;line-height:1.6"><p>${message}</p><p><a href="https://concretesapiens.com" style="color:#e8590c">콘크리트 사피엔스로 돌아가기 →</a></p></body></html>`,
  };
}

export const handler = async (event: { queryStringParameters?: Record<string, string> }) => {
  const userId = readUnsubscribeToken(event.queryStringParameters?.t ?? '');
  if (!userId) return page('링크가 올바르지 않아요. 메일에 있는 링크를 그대로 눌러주세요.', 400);
  const now = new Date().toISOString();
  await db.send(
    new PutCommand({
      TableName: process.env.EMAIL_OPT_OUT_TABLE,
      Item: { userId, __typename: 'EmailOptOut', createdAt: now, updatedAt: now },
    })
  );
  return page('알림 메일 수신을 거부했어요. 앞으로 "떠올랐어요" 알림 메일을 보내지 않을게요.');
};
