import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  ScanCommand,
  type ScanCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { makeUnsubscribeToken } from './token';

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const SITE_URL = 'https://concretesapiens.com';
const FROM = '콘크리트 사피엔스 <noreply@concretesapiens.com>';
// 한 메일에 보여줄 기억 수 — 더 많으면 "외 N개"로 줄인다.
const MAX_STORIES_IN_MAIL = 5;

type Reaction = { storyId: string; owner?: string; createdAt: string };
type Author = { storyId: string; userId: string; email: string };
type Story = {
  id: string;
  publicId: string;
  status: string;
  content?: string;
  placeId?: string;
  officialPlaceName?: string;
  customName?: string;
  address?: string;
};

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

async function getStories(ids: string[]): Promise<Map<string, Story>> {
  const table = process.env.STORY_TABLE as string;
  const stories = new Map<string, Story>();
  for (let i = 0; i < ids.length; i += 100) {
    let keys: Record<string, unknown>[] | undefined = ids.slice(i, i + 100).map((id) => ({ id }));
    while (keys && keys.length) {
      const res = await db.send(new BatchGetCommand({ RequestItems: { [table]: { Keys: keys } } }));
      ((res.Responses?.[table] ?? []) as Story[]).forEach((s) => stories.set(s.id, s));
      keys = res.UnprocessedKeys?.[table]?.Keys as Record<string, unknown>[] | undefined;
    }
  }
  return stories;
}

async function isOptedOut(userId: string): Promise<boolean> {
  const res = await db.send(new GetCommand({ TableName: process.env.EMAIL_OPT_OUT_TABLE, Key: { userId } }));
  return !!res.Item;
}

// js/storage.js getGroupTitle/abbreviateAddress와 같은 우선순위(검색 장소명 →
// 직접 붙인 이름 → 주소)로 장소 이름을 고른다.
function placeName(s: Story): string {
  if (s.placeId && s.officialPlaceName) return s.officialPlaceName;
  if (s.customName) return s.customName;
  return s.address || '어느 곳';
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function snippet(content = ''): string {
  const oneLine = content.replace(/\s+/g, ' ').trim();
  return oneLine.length > 40 ? `${oneLine.slice(0, 40)}…` : oneLine;
}

function buildMail(entries: { story: Story; people: number }[], totalPeople: number, unsubscribeUrl: string) {
  const subject = `오늘 ${totalPeople}명이 회원님의 기억을 떠올렸어요`;
  const shown = entries.slice(0, MAX_STORIES_IN_MAIL);
  const rest = entries.length - shown.length;
  const itemsHtml = shown
    .map(({ story, people }) => {
      const url = `${SITE_URL}/?story=${encodeURIComponent(story.publicId)}`;
      return `<a href="${url}" style="display:block;text-decoration:none;color:#222;border:1px solid #eee;border-radius:12px;padding:14px 16px;margin:0 0 10px">
  <div style="font-size:13px;color:#888">📍 ${escapeHtml(placeName(story))}</div>
  <div style="font-size:15px;margin:6px 0">${escapeHtml(snippet(story.content))}</div>
  <div style="font-size:13px;color:#e8590c">♡ ${people}명이 떠올렸어요</div>
</a>`;
    })
    .join('');
  const html = `<!doctype html><html lang="ko"><body style="margin:0;background:#fafafa">
<div style="font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;max-width:480px;margin:0 auto;padding:32px 20px;color:#222;line-height:1.6">
  <p style="font-size:13px;color:#888;margin:0 0 4px">콘크리트 사피엔스</p>
  <h1 style="font-size:20px;margin:0 0 20px">${escapeHtml(subject)}</h1>
  ${itemsHtml}
  ${rest > 0 ? `<p style="font-size:13px;color:#888">외 ${rest}개의 기억도 누군가 떠올렸어요.</p>` : ''}
  <p style="margin:24px 0"><a href="${SITE_URL}" style="display:inline-block;background:#222;color:#fff;text-decoration:none;padding:10px 18px;border-radius:999px;font-size:14px">지도에서 보기</a></p>
  <p style="font-size:12px;color:#aaa;margin-top:32px">로그인 계정으로 남긴 기억에 "떠올랐어요"가 생기면 하루 한 번 보내드리는 메일이에요.<br><a href="${unsubscribeUrl}" style="color:#aaa">알림 메일 수신 거부</a></p>
</div></body></html>`;
  const text = [
    subject,
    '',
    ...shown.map(({ story, people }) => `- ${placeName(story)}: "${snippet(story.content)}" (♡ ${people}명) ${SITE_URL}/?story=${story.publicId}`),
    rest > 0 ? `외 ${rest}개의 기억도 누군가 떠올렸어요.` : '',
    '',
    `수신 거부: ${unsubscribeUrl}`,
  ].join('\n');
  return { subject, html, text };
}

async function sendMail(to: string, mail: { subject: string; html: string; text: string }, unsubscribeUrl: string, idempotencyKey: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      // 스케줄 재시도 등으로 같은 날 두 번 실행돼도 같은 메일이 또 가지 않게.
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * event.hours: 집계 구간(기본 24시간). event.onlyTo: 테스트용 — 실제 글쓴이
 * 대신 이 주소로만 보낸다(수신 거부 여부도 무시). 스케줄 실행 땐 둘 다 없다.
 */
export const handler = async (event: { hours?: number; onlyTo?: string } = {}) => {
  const hours = event.hours ?? 24;
  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

  const reactions = await scanAll<Reaction>({
    TableName: process.env.STORY_REACTION_TABLE,
    FilterExpression: 'createdAt >= :since',
    ExpressionAttributeValues: { ':since': since },
    ProjectionExpression: 'storyId, #o, createdAt',
    ExpressionAttributeNames: { '#o': 'owner' },
  });
  if (!reactions.length) {
    console.log('지난 구간 반응 없음', { since });
    return { sent: 0 };
  }

  const authors = await scanAll<Author>({
    TableName: process.env.STORY_AUTHOR_TABLE,
    ProjectionExpression: 'storyId, userId, email',
  });
  const authorByStory = new Map(authors.map((a) => [a.storyId, a]));
  const stories = await getStories([...new Set(reactions.map((r) => r.storyId))]);

  // 글쓴이(userId) → { email, 기억별 반응한 사람(owner) 집합 }
  const byAuthor = new Map<string, { email: string; perStory: Map<string, Set<string>> }>();
  for (const r of reactions) {
    const author = authorByStory.get(r.storyId);
    const story = stories.get(r.storyId);
    if (!author?.email || !story || story.status !== 'ACTIVE') continue;
    const reactor = r.owner ?? `anon-${r.createdAt}`;
    if (reactor.split('::')[0] === author.userId) continue;
    const entry = byAuthor.get(author.userId) ?? { email: author.email, perStory: new Map() };
    const people = entry.perStory.get(r.storyId) ?? new Set<string>();
    people.add(reactor);
    entry.perStory.set(r.storyId, people);
    byAuthor.set(author.userId, entry);
  }

  const today = new Date().toISOString().slice(0, 10);
  let sent = 0;
  for (const [userId, { email, perStory }] of byAuthor) {
    try {
      if (!event.onlyTo && (await isOptedOut(userId))) continue;
      const entries = [...perStory.entries()]
        .map(([storyId, people]) => ({ story: stories.get(storyId) as Story, people: people.size }))
        .sort((a, b) => b.people - a.people);
      const totalPeople = new Set([...perStory.values()].flatMap((s) => [...s])).size;
      const unsubscribeUrl = `${process.env.UNSUBSCRIBE_URL}?t=${makeUnsubscribeToken(userId)}`;
      const mail = buildMail(entries, totalPeople, unsubscribeUrl);
      const key = event.onlyTo ? `test-${Date.now()}-${userId}` : `reaction-digest-${today}-${userId}`;
      await sendMail(event.onlyTo ?? email, mail, unsubscribeUrl, key);
      sent += 1;
      if (event.onlyTo) break; // 테스트는 한 통이면 충분하다.
      // Resend 기본 전송 한도(초당 2건) 아래로.
      await sleep(600);
    } catch (e) {
      // 한 명 실패가 나머지 발송을 막지 않게 하고, 함수 자체는 성공으로
      // 끝내서 스케줄러 재시도로 이미 보낸 사람에게 또 가는 일도 막는다.
      console.error('알림 메일 발송 실패', userId, e);
    }
  }
  console.log('알림 메일 발송 완료', { since, authors: byAuthor.size, sent });
  return { sent };
};
