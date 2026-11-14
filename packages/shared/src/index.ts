import { z } from 'zod';

export const VERSION = '0.1.0';

export const healthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('clqn-api'),
  version: z.string(),
});
export type Health = z.infer<typeof healthSchema>;

export const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
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

  constructor(baseUrl: string) {
    this.baseUrl = new URL(baseUrl);
    if (!['http:', 'https:'].includes(this.baseUrl.protocol)) {
      throw new Error('CLQN_API_URL must use HTTP or HTTPS');
    }
  }

  async health(): Promise<Health> {
    const response = await fetch(new URL('/health', this.baseUrl), {
      signal: AbortSignal.timeout(10_000),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      const body = errorSchema.safeParse(await response.json().catch(() => null));
      throw new ApiError(response.status, body.success ? body.data.error.code : 'HTTP_ERROR',
        body.success ? body.data.error.message : `API returned HTTP ${response.status}`);
    }
    return healthSchema.parse(await response.json());
  }
}
