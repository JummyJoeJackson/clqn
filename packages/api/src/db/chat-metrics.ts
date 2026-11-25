import { type ChatMetrics, type ChatMetricsWindow, chatMetricsWindows } from '@clqn/shared';
import { and, desc, eq, gte, isNotNull, or, sql } from 'drizzle-orm';
import type { WorkspaceDb } from '../lib/access.js';
import { chatMembers, chatMessages, chatTokenHours } from './chat.js';
import { activeRun, chatUsage, currentChatHour, messageScope, runStatus } from './chat-read.js';
import { agents, events, users } from './schema.js';
import { tasks } from './tasks.js';

const safe = (value: bigint | number | string) => Math.min(Number(value), Number.MAX_SAFE_INTEGER);

export async function chatMetrics(db: WorkspaceDb, clanId: string, window: ChatMetricsWindow): Promise<ChatMetrics> {
  const { buckets, bucketHours } = chatMetricsWindows[window];
  const step = sql`${bucketHours}::integer * interval '1 hour'`;
  const first = sql`(${currentChatHour} - ${buckets * bucketHours - 1}::integer * interval '1 hour')`;
  const member = and(messageScope(clanId), eq(chatMessages.role, 'member'));
  const wait = sql`extract(epoch from ${chatMessages.decidedAt} - ${chatMessages.createdAt})`;

  // A chat task counts as an active agent until release, completion, or repository handoff.
  const series = db.execute<{ start: Date | string; tokens: string; agents: number; wait: number | null }>(sql`
    with spans as (
      select created_at as began, coalesce(next_at, statement_timestamp()) as ended
      from (
        select e.type, e.created_at,
          lead(e.created_at) over (partition by e.resource_id order by e.sequence) as next_at
        from ${events} e
        where e.clan_id = ${clanId}
          and e.type in ('task.claimed', 'task.released', 'task.completed', 'task.repository_bound')
          and e.resource_id in (
            select m.task_id::text from ${chatMessages} m where m.clan_id = ${clanId} and m.task_id is not null
          )
      ) marks
      where type = 'task.claimed'
    ), buckets as (
      select start, start + ${step} as finish
      from generate_series(${first}, ${first} + ${buckets - 1}::integer * ${step}, ${step}) as series(start)
    )
    select b.start,
      (select coalesce(sum(h.tokens), 0) from ${chatTokenHours} h
        where h.clan_id = ${clanId} and h.hour >= b.start and h.hour < b.finish)::text as tokens,
      (select count(*) from spans s where s.began < b.finish and s.ended > b.start)::integer as agents,
      (select avg(extract(epoch from m.decided_at - m.created_at)) from ${chatMessages} m
        where m.clan_id = ${clanId} and m.role = 'member' and m.decided_at is not null
          and m.created_at >= b.start and m.created_at < b.finish)::float8 as wait
    from buckets b
    order by b.start
  `);
  const summary = db
    .select({ average: sql<number | null>`avg(${wait})::float8`, longest: sql<number | null>`max(${wait})::float8` })
    .from(chatMessages)
    .where(and(member, isNotNull(chatMessages.decidedAt), gte(chatMessages.createdAt, first)));
  const waiting = db
    .select({
      count: sql<number>`count(*)::integer`,
      oldest: sql<number | null>`extract(epoch from statement_timestamp() - min(${chatMessages.createdAt}))::float8`,
    })
    .from(chatMessages)
    .where(and(member, eq(chatMessages.status, 'queued')));
  const people = db
    .select({ userId: chatMembers.userId, name: users.email, settings: chatMembers.settings })
    .from(chatMembers)
    .innerJoin(users, eq(users.id, chatMembers.userId))
    .where(eq(chatMembers.clanId, clanId))
    .orderBy(users.email);
  const runs = db
    .select({
      proposal: chatMessages.proposal,
      worker: agents.name,
      tokens: chatMessages.tokens,
      assigned: tasks.assignedAgentId,
      workerId: agents.id,
      taskStatus: tasks.status,
    })
    .from(chatMessages)
    .innerJoin(agents, eq(agents.id, chatMessages.workerId))
    .innerJoin(tasks, eq(tasks.id, chatMessages.taskId))
    .where(and(messageScope(clanId), or(gte(chatMessages.createdAt, first), activeRun)))
    .orderBy(desc(sql`coalesce(${chatMessages.tokens}, 0)`), desc(chatMessages.sequence))
    .limit(20);
  const [rows, [totals], [queue], members, recent] = await Promise.all([series, summary, waiting, people, runs]);
  // Members are few, so reuse the exact usage the token limit is enforced against.
  const usage = await Promise.all(members.map(({ userId }) => chatUsage(db, clanId, userId)));
  return {
    window,
    bucketHours,
    start: new Date(rows[0]!.start).toISOString(),
    tokens: rows.map((row) => safe(row.tokens)),
    agents: rows.map((row) => row.agents),
    queueWait: rows.map((row) => row.wait),
    queue: {
      averageSeconds: totals?.average ?? null,
      longestSeconds: totals?.longest ?? null,
      waiting: queue?.count ?? 0,
      oldestSeconds: queue?.oldest ?? null,
    },
    members: members.map(({ name, settings }, index) => ({
      name,
      tokens: safe(usage[index]!.tokens),
      reserved: safe(usage[index]!.reserved),
      tokenLimit: settings.tokenLimit,
    })),
    tasks: recent.map((row) => ({
      title: row.proposal!.title,
      worker: row.worker,
      estimatedTokens: row.proposal!.estimatedTokens,
      status: runStatus(row),
      tokens: row.tokens,
    })),
  };
}
