import { z } from 'zod';

export const VERSION = '0.1.0';
export const healthSchema = z.object({
  status: z.literal('ok'), service: z.literal('clqn-api'), version: z.string(),
});
export type Health = z.infer<typeof healthSchema>;
export const userSchema = z.object({ id: z.uuid(), email: z.email() });
export type User = z.infer<typeof userSchema>;
export const createClanSchema = z.object({ name: z.string().trim().min(1).max(100) }).strict();
export const clanSchema = z.object({
  id: z.uuid(), name: z.string(), createdBy: z.uuid(), createdAt: z.iso.datetime(),
});
export type Clan = z.infer<typeof clanSchema>;
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
  whoami(): Promise<User> { return this.request('/v1/me', userSchema); }
  createClan(name: string): Promise<Clan> { return this.request('/v1/clans', clanSchema, createClanSchema.parse({ name })); }
  listClans() { return this.request('/v1/clans', clansSchema); }
  members(clanId: string) { return this.request(`/v1/clans/${encodeURIComponent(clanId)}/members`, membersSchema); }
}
