import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, type ScanCommandInput } from '@aws-sdk/lib-dynamodb';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const SITE_URL = 'https://concretesapiens.com';
const FROM = '콘크리트 사피엔스 <noreply@concretesapiens.com>';
// 메일에 하나씩 보여줄 새 기기 수 — 더 많으면 "외 N대"로 줄인다.
const MAX_DEVICES_IN_MAIL = 20;

// storyId는 ?story=로 들어온 경우의 publicId(js/storage.js logPageView).
type PageView = { deviceId?: string; storyId?: string; deviceInfo?: string; createdAt: string };

async function scanAll<T>(input: ScanCommandInput): Promise<T[]> {
  const items: T[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await db.send(new ScanCommand({ ...input, ExclusiveStartKey }));
    items.push(...((res.Items ?? []) as T[]));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

// UTC ISO → 한국 날짜(YYYY-MM-DD) / 한국 시각(HH:MM) — js/admin.js kstDay와 같은 계산.
const toKst = (iso: string) => new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString();
const kstDay = (iso: string) => toKst(iso).slice(0, 10);
const kstTime = (iso: string) => toKst(iso).slice(11, 16);

/**
 * event.day: 집계할 한국 날짜(기본: 어제). event.force: 새 기기가 없어도
 * 보낸다(테스트용). 스케줄 실행 땐 둘 다 없다.
 */
export const handler = async (event: { day?: string; force?: boolean } = {}) => {
  const day = event.day ?? kstDay(new Date(Date.now() - 86400000).toISOString());

  const [views, excluded] = await Promise.all([
    scanAll<PageView>({
      TableName: process.env.PAGE_VIEW_TABLE,
      ProjectionExpression: 'deviceId, storyId, deviceInfo, createdAt',
    }),
    scanAll<{ deviceId: string }>({
      TableName: process.env.ADMIN_EXCLUDED_DEVICE_TABLE,
      ProjectionExpression: 'deviceId',
    }),
  ]);
  const excludedIds = new Set(excluded.map((e) => e.deviceId));
  const counted = views.filter((v) => v.createdAt && !(v.deviceId && excludedIds.has(v.deviceId)));

  // 기기별 맨 처음 방문 — 그게 집계 날짜에 있으면 "새 기기".
  const firstSeen = new Map<string, PageView>();
  for (const v of counted) {
    if (!v.deviceId) continue;
    const prev = firstSeen.get(v.deviceId);
    if (!prev || v.createdAt < prev.createdAt) firstSeen.set(v.deviceId, v);
  }
  const dayViews = counted.filter((v) => kstDay(v.createdAt) === day);
  const opensByDevice = new Map<string, number>();
  dayViews.forEach((v) => v.deviceId && opensByDevice.set(v.deviceId, (opensByDevice.get(v.deviceId) ?? 0) + 1));
  const newDevices = [...firstSeen.values()]
    .filter((v) => kstDay(v.createdAt) === day)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const summary = { day, views: dayViews.length, unique: opensByDevice.size, newDevices: newDevices.length };
  if (!newDevices.length && !event.force) {
    console.log('새 기기 없음 — 메일 안 보냄', summary);
    return { sent: 0, ...summary };
  }

  const subject = `[콘크리트 사피엔스] ${day.slice(5).replace('-', '/')} 새 기기 ${newDevices.length}대 방문`;
  const shown = newDevices.slice(0, MAX_DEVICES_IN_MAIL);
  const rest = newDevices.length - shown.length;
  const line = (v: PageView) => {
    const from = v.storyId ? `공유 링크로 들어옴(?story=${v.storyId})` : '첫 화면으로 들어옴';
    return { info: v.deviceInfo, id: (v.deviceId as string).slice(0, 8), time: kstTime(v.createdAt), opens: opensByDevice.get(v.deviceId as string) ?? 1, from, storyId: v.storyId };
  };
  const rows = shown.map(line);
  const html = `<!doctype html><html lang="ko"><body style="margin:0;background:#fafafa">
<div style="font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;max-width:520px;margin:0 auto;padding:32px 20px;color:#222;line-height:1.6">
  <h1 style="font-size:19px;margin:0 0 16px">${subject}</h1>
  <p style="font-size:14px;margin:0 0 16px">${day} 하루 동안 방문 <b>${summary.views}회</b> · 순방문자 <b>${summary.unique}명</b> · 처음 온 기기 <b>${newDevices.length}대</b><br><span style="color:#888;font-size:12px">어드민 "내 방문 제외" 기기는 뺀 숫자예요. 같은 사람도 브라우저가 다르면 다른 기기로 잡혀요.</span></p>
  ${rows
    .map(
      (r) => `<div style="border:1px solid #eee;border-radius:10px;padding:10px 14px;margin:0 0 8px;font-size:13px">
    <b>${r.time}</b> · ${r.info ? `${r.info} · ` : ''}기기 ${r.id}… · ${r.opens}회 열어봄<br>
    <span style="color:#888">${r.storyId ? `<a href="${SITE_URL}/?story=${encodeURIComponent(r.storyId)}" style="color:#e8590c">공유 링크로 들어옴</a>` : '첫 화면으로 들어옴'}</span>
  </div>`,
    )
    .join('')}
  ${rest > 0 ? `<p style="font-size:13px;color:#888">외 ${rest}대</p>` : ''}
  <p style="margin:20px 0"><a href="${SITE_URL}/admin.html" style="display:inline-block;background:#222;color:#fff;text-decoration:none;padding:9px 16px;border-radius:999px;font-size:13px">어드민 방문현황 보기</a></p>
</div></body></html>`;
  const text = [
    subject,
    `방문 ${summary.views}회 · 순방문자 ${summary.unique}명 · 처음 온 기기 ${newDevices.length}대`,
    '',
    ...rows.map((r) => `- ${r.time} ${r.info ? `${r.info} · ` : ''}기기 ${r.id}… ${r.opens}회 · ${r.from}`),
    rest > 0 ? `외 ${rest}대` : '',
  ].join('\n');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      // 스케줄 재시도로 같은 날 두 번 실행돼도 한 통만.
      'Idempotency-Key': event.force ? `visit-digest-test-${Date.now()}` : `visit-digest-${day}`,
    },
    body: JSON.stringify({ from: FROM, to: [process.env.DIGEST_TO], subject, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  console.log('새 기기 요약 메일 발송', summary);
  return { sent: 1, ...summary };
};
