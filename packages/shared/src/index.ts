import { z } from 'zod';
import { actorSchema, agentSchema, agentsSchema, agentRegistrationSchema, registerAgentSchema } from './agents.js';
import { contextKeySchema, contextEntrySchema, contextListSchema, contextHistorySchema, writeContextSchema } from './context.js';
import { taskSchema, tasksSchema, createTaskSchema } from './tasks.js';
import { eventsSchema, statsSchema, statusSchema } from './activity.js';
export * from './activity.js';
export * from './agents.js';
export * from './context.js';
export * from './tasks.js';

export const VERSION = '0.1.0';
export const healthSchema = z.object({
  status: z.literal('ok'), service: z.literal('clqn-api'), version: z.string(),
});
export type Health = z.infer<typeof healthSchema>;
export const userSchema = z.object({ id: z.uuid(), email: z.email() });
export type User = z.infer<typeof userSchema>;
export const createClanSchema = z.object({ name: z.string().trim().min(1).max(100).refine((name) => !name.includes('\0'), 'Clan names cannot contain NUL') }).strict();
export const clanSchema = z.object({
  id: z.uuid(), name: z.string(), createdBy: z.uuid(), createdAt: z.iso.datetime(),
});
export type Clan = z.infer<typeof clanSchema>;
export const createInvitationSchema = z.object({ email: z.string().trim().toLowerCase().pipe(z.email()) }).strict();
export const invitationCodeSchema = z.string().regex(/^clqn_inv_[A-Za-z0-9_-]{43}$/);
export const joinInvitationSchema = z.object({ code: invitationCodeSchema }).strict();
export const invitationSchema = z.object({
  code: invitationCodeSchema, clanId: z.uuid(), email: z.email(), expiresAt: z.iso.datetime(),
});
export type Invitation = z.infer<typeof invitationSchema>;
export const clansSchema = z.object({ clans: z.array(clanSchema) });
export const membersSchema = z.object({ members: z.array(z.object({
  userId: z.uuid(), email: z.email(), role: z.enum(['leader', 'member']), createdAt: z.iso.datetime(),
})) });
export const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });
export type ApiErrorBody = z.infer<typeof errorSchema>;

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// Both adapters use this client; collaboration rules belong on the API server.
export class ClqnClient {
  private readonly baseUrl: URL;
  constructor(baseUrl: string, private readonly token?: string) {
    this.baseUrl = new URL(baseUrl);
    if (!['http:', 'https:'].includes(this.baseUrl.protocol)) {
      throw new Error('CLQN_API_URL must use HTTP or HTTPS');
    }
    if (this.baseUrl.username || this.baseUrl.password) throw new Error('API URL must not contain credentials');
    if (token && this.baseUrl.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(this.baseUrl.hostname)) {
      throw new Error('Authenticated requests require HTTPS except on loopback');
    }
  }
  private async request<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const response = await fetch(new URL(path, this.baseUrl), {
      method: body === undefined ? 'GET' : 'POST',
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
      headers: { accept: 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const parsed = errorSchema.safeParse(await response.json().catch(() => null));
      throw new ApiError(response.status, parsed.success ? parsed.data.error.code : 'HTTP_ERROR',
        parsed.success ? parsed.data.error.message : `API returned HTTP ${response.status}`);
    }
    return schema.parse(await response.json());
  }
  health(): Promise<Health> { return this.request('/health', healthSchema); }
  whoami() { return this.request('/v1/me', actorSchema); }
  createClan(name: string): Promise<Clan> { return this.request('/v1/clans', clanSchema, createClanSchema.parse({ name })); }
  listClans() { return this.request('/v1/clans', clansSchema); }
  members(clanId: string) { return this.request(`/v1/clans/${encodeURIComponent(clanId)}/members`, membersSchema); }
  createInvitation(clanId: string, email: string): Promise<Invitation> {
    return this.request(`/v1/clans/${encodeURIComponent(clanId)}/invitations`, invitationSchema, createInvitationSchema.parse({ email }));
  }
  joinClan(code: string): Promise<Clan> {
    return this.request('/v1/invitations/join', clanSchema, joinInvitationSchema.parse({ code }));
  }
  registerAgent(clanId: string, name: string) {
    return this.request(`/v1/clans/${encodeURIComponent(clanId)}/agents`, agentRegistrationSchema, registerAgentSchema.parse({ name }));
  }
  listAgents(clanId: string) { return this.request(`/v1/clans/${encodeURIComponent(clanId)}/agents`, agentsSchema); }
  agentStatus() { return this.request('/v1/agent', agentSchema); }
  listContext(clanId: string) { return this.request(`/v1/clans/${encodeURIComponent(clanId)}/context`, contextListSchema); }
  readContext(clanId: string, key: string) {
    contextKeySchema.parse(key);
    return this.request(`/v1/clans/${encodeURIComponent(clanId)}/context/${encodeURIComponent(key)}`, contextEntrySchema);
  }
  writeContext(clanId: string, key: string, text: string, expectedRevision: number) {
    contextKeySchema.parse(key);
    return this.request(`/v1/clans/${encodeURIComponent(clanId)}/context/${encodeURIComponent(key)}`, contextEntrySchema,
      writeContextSchema.parse({ text, expectedRevision }));
  }
  contextHistory(clanId: string, key: string) {
    contextKeySchema.parse(key);
    return this.request(`/v1/clans/${encodeURIComponent(clanId)}/context/${encodeURIComponent(key)}/history`, contextHistorySchema);
  }
  createTask(clanId: string, description: string) {
    return this.request(`/v1/clans/${encodeURIComponent(clanId)}/tasks`, taskSchema, createTaskSchema.parse({ description }));
  }
  listTasks(clanId: string) { return this.request(`/v1/clans/${encodeURIComponent(clanId)}/tasks`, tasksSchema); }
  transitionTask(clanId: string, taskId: string, action: 'claim' | 'release' | 'complete') {
    return this.request(`/v1/clans/${encodeURIComponent(clanId)}/tasks/${encodeURIComponent(taskId)}/${action}`, taskSchema, {});
  }

  events(clanId: string, cursor = 0, limit = 100) {
    return this.request(`/v1/clans/${encodeURIComponent(clanId)}/events?cursor=${cursor}&limit=${limit}`, eventsSchema);
  }
  stats(clanId: string) { return this.request(`/v1/clans/${encodeURIComponent(clanId)}/stats`, statsSchema); }
  status(clanId: string) { return this.request(`/v1/clans/${encodeURIComponent(clanId)}/status`, statusSchema); }

}
