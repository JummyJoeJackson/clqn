import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { limits } from '../src/lib/limits.js';
import { database, skip } from './postgres.js';

test('PostgreSQL: clan, agent and context limits hold under concurrent writes', {
  skip,
}, async (t) => {
  const saved = { ...limits };
  t.after(() => Object.assign(limits, saved));
  const { sql, connection, user } = await database(t);
  Object.assign(limits, { clansPerUser: 2, agentsPerMember: 2, contextEntriesPerClan: 2, contextRevisionsKept: 3 });
  const alice = await user();
  const app = createApp(connection.store, connection.db);
  const post = (path: string, body: object) =>
    app.request(path, {
      method: 'POST',
      headers: { authorization: `Bearer ${alice.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const statuses = async (requests: (Response | Promise<Response>)[]) =>
    (await Promise.all(requests)).map((r) => r.status).sort();
  // Each check runs concurrently at the edge of its limit: exactly the remaining capacity succeeds.
  const clans = await statuses([1, 2, 3].map((i) => post('/v1/clans', { name: `Clan ${i}` })));
  assert.deepEqual(clans, [201, 201, 409]);
  const limited = await post('/v1/clans', { name: 'One more' });
  assert.deepEqual(await limited.json(), {
    error: { code: 'LIMIT_REACHED', message: 'You can create at most 2 clans' },
  });
  const [clan] = (
    await (await app.request('/v1/clans', { headers: { authorization: `Bearer ${alice.token}` } })).json()
  ).clans;
  const agents = await statuses([1, 2, 3].map((i) => post(`/v1/clans/${clan.id}/agents`, { name: `Agent ${i}` })));
  assert.deepEqual(agents, [201, 201, 409]);
  const [credentials] =
    await sql`select count(*)::integer as n from credentials c join agents a on a.id = c.agent_id where a.clan_id = ${clan.id}`;
  assert.equal(credentials?.n, 2);
  const write = (key: string, text: string, expectedRevision: number) =>
    post(`/v1/clans/${clan.id}/context/${key}`, { text, expectedRevision });
  const entries = await statuses(['a', 'b', 'c'].map((key) => write(key, key, 0)));
  assert.deepEqual(entries, [201, 201, 409]);
  // Updates are not blocked by the entry cap, and only the latest revisions are kept.
  const [created] = await sql`select key from context_entries where clan_id = ${clan.id} order by key limit 1`;
  for (let revision = 1; revision <= 4; revision++)
    assert.equal((await write(created!.key, `v${revision}`, revision)).status, 200);
  const history = await (
    await app.request(`/v1/clans/${clan.id}/context/${created!.key}/history`, {
      headers: { authorization: `Bearer ${alice.token}` },
    })
  ).json();
  assert.deepEqual(
    history.revisions.map((entry: { revision: number }) => entry.revision),
    [3, 4, 5],
  );
});
