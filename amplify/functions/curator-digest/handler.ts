import { CognitoIdentityProviderClient, ListUsersInGroupCommand, type UserType } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, type ScanCommandInput } from '@aws-sdk/lib-dynamodb';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const cognito = new CognitoIdentityProviderClient({});
const SITE_URL = 'https://concretesapiens.com';
const FROM = '콘크리트 사피엔스 <noreply@concretesapiens.com>';
// 그만 받고 싶다는 회신을 운영자가 받도록 — 작가는 소수라 수신 거부 링크 대신 회신으로.
const REPLY_TO = 'hello@todoc.us';
// 조회 1번마다 js/course.js가 남기는 이벤트(2026-10-26~) — 그 전 조회는 하루치가 없다.
const VIEW_EVENT_PREFIX = 'course_viewed:';

type Course = { id: string; slug: string; title: string; authorId?: string };
type Curator = { userId: string; email: string };

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

async function listCurators(): Promise<Curator[]> {
  const curators: Curator[] = [];
  let NextToken: string | undefined;
  do {
    const res = await cognito.send(
      new ListUsersInGroupCommand({ UserPoolId: process.env.USER_POOL_ID, GroupName: 'Curators', NextToken })
    );
    (res.Users ?? []).forEach((u: UserType) => {
      const attr = (name: string) => u.Attributes?.find((a) => a.Name === name)?.Value;
      const userId = attr('sub');
      const email = attr('email');
      if (u.Enabled !== false && userId && email) curators.push({ userId, email });
    });
    NextToken = res.NextToken;
  } while (NextToken);
  return curators;
}

// UTC ISO → 한국 날짜(YYYY-MM-DD) — visit-digest와 같은 계산.
const kstDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 10);

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

type Row = { title: string; slug: string; yesterday: number; total: number };

/** 작가 한 명의 메일 — 로컬 시험 발송에서도 같은 모양을 쓰려고 따로 뺐다. */
export function buildMail(day: string, rows: Row[]) {
  const yesterdayTotal = rows.reduce((sum, r) => sum + r.yesterday, 0);
  const date = `${Number(day.slice(5, 7))}월 ${Number(day.slice(8, 10))}일`;
  const subject = `[콘크리트 사피엔스] 어제 내 발자취 조회 ${yesterdayTotal}회 — ${date}`;
  const html = `<!doctype html><html lang="ko"><body style="margin:0;background:#fafafa">
<div style="font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;max-width:520px;margin:0 auto;padding:32px 20px;color:#222;line-height:1.6">
<h1 style="font-size:19px;margin:0 0 16px">어제(${date}) 내 발자취를 ${yesterdayTotal}번 봤어요</h1>
${rows
  .map(
    (r) => `<div style="border:1px solid #eee;border-radius:10px;padding:12px 14px;margin:0 0 8px;font-size:14px;background:#fff">
  <a href="${SITE_URL}/?course=${encodeURIComponent(r.slug)}" style="color:#222;font-weight:600;text-decoration:none">${escapeHtml(r.title)}</a><br>
  <span>어제 조회 <b style="color:#e8590c">${r.yesterday}</b> · 총 조회 <b>${r.total}</b></span>
</div>`,
  )
  .join('')}
<p style="font-size:12px;color:#888;margin:16px 0 0">조회는 발자취에 들어가 장소 카드를 한 장 이상 본 횟수예요(같은 사람이 다시 걸어도 한 번 더 세요).<br>메일을 그만 받고 싶으면 이 메일에 회신해 주세요.</p>
</div></body></html>`;
  const text = [
    `어제(${date}) 내 발자취 조회 ${yesterdayTotal}회`,
    '',
    ...rows.map((r) => `- ${r.title}: 어제 조회 ${r.yesterday} · 총 조회 ${r.total}`),
    '',
    '메일을 그만 받고 싶으면 이 메일에 회신해 주세요.',
  ].join('\n');
  return { subject, html, text };
}

/**
 * event.day: 집계할 한국 날짜(기본: 어제). event.force: 어제 조회가 0이어도
 * 보낸다. event.to: 이 주소로만 보낸다(테스트용 — 작가 한 명 것만 받아 보기).
 */
export const handler = async (event: { day?: string; force?: boolean; to?: string } = {}) => {
  const day = event.day ?? kstDay(new Date(Date.now() - 86400000).toISOString());

  const [curators, courses, viewCounts, events] = await Promise.all([
    listCurators(),
    scanAll<Course>({ TableName: process.env.COURSE_TABLE, ProjectionExpression: 'id, slug, title, authorId' }),
    scanAll<{ courseId: string; count: number }>({ TableName: process.env.COURSE_VIEW_COUNT_TABLE }),
    scanAll<{ type: string; createdAt: string }>({
      TableName: process.env.APP_EVENT_TABLE,
      ProjectionExpression: '#t, createdAt',
      ExpressionAttributeNames: { '#t': 'type' },
      FilterExpression: 'begins_with(#t, :p)',
      ExpressionAttributeValues: { ':p': VIEW_EVENT_PREFIX },
    }),
  ]);

  const totalById = new Map(viewCounts.map((v) => [v.courseId, v.count || 0]));
  const yesterdayBySlug = new Map<string, number>();
  events.forEach((e) => {
    if (!e.createdAt || kstDay(e.createdAt) !== day) return;
    const slug = e.type.slice(VIEW_EVENT_PREFIX.length);
    yesterdayBySlug.set(slug, (yesterdayBySlug.get(slug) ?? 0) + 1);
  });

  let sent = 0;
  const skipped: string[] = [];
  for (const curator of curators) {
    if (event.to && curator.email !== event.to) continue;
    const rows = courses
      .filter((c) => c.authorId === curator.userId)
      .map((c) => ({ title: c.title, slug: c.slug, yesterday: yesterdayBySlug.get(c.slug) ?? 0, total: totalById.get(c.id) ?? 0 }))
      .sort((a, b) => b.yesterday - a.yesterday || b.total - a.total);
    const yesterdayTotal = rows.reduce((sum, r) => sum + r.yesterday, 0);
    if (!rows.length || (!yesterdayTotal && !event.force)) {
      skipped.push(curator.email);
      continue;
    }

    const { subject, html, text } = buildMail(day, rows);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        // 스케줄 재시도로 같은 날 두 번 실행돼도 작가당 한 통만.
        'Idempotency-Key': event.force || event.to ? `curator-digest-test-${Date.now()}-${curator.userId}` : `curator-digest-${day}-${curator.userId}`,
      },
      body: JSON.stringify({ from: FROM, to: [curator.email], reply_to: REPLY_TO, subject, html, text }),
    });
    if (!res.ok) {
      // 한 명 실패로 나머지 작가 메일까지 멈추지 않게 로그만 남긴다.
      console.error('작가 메일 발송 실패', curator.email, res.status, await res.text());
      continue;
    }
    sent++;
  }
  const summary = { day, curators: curators.length, sent, skipped: skipped.length, viewEvents: events.length };
  console.log('작가 조회수 메일', summary);
  return summary;
};
