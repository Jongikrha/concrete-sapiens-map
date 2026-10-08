import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// 수신 거부 링크 서명 — 별도 시크릿을 또 만들지 않고 RESEND_API_KEY에서
// 파생한 키를 쓴다. API 키를 재발급하면 이전 메일의 수신 거부 링크는
// 무효가 되지만, 다음 메일부터 새 링크가 나가므로 실용상 문제없다.
function signingKey(): Buffer {
  return createHash('sha256')
    .update(`email-unsubscribe:${process.env.RESEND_API_KEY ?? ''}`)
    .digest();
}

function sign(userId: string): string {
  return createHmac('sha256', signingKey()).update(userId).digest('base64url').slice(0, 32);
}

export function makeUnsubscribeToken(userId: string): string {
  return `${Buffer.from(userId).toString('base64url')}.${sign(userId)}`;
}

/** 서명이 맞으면 userId, 아니면 null. */
export function readUnsubscribeToken(token: string): string | null {
  const [encoded, signature] = (token || '').split('.');
  if (!encoded || !signature) return null;
  const userId = Buffer.from(encoded, 'base64url').toString();
  const expected = Buffer.from(sign(userId));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return userId;
}
