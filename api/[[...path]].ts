import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import {
  createJwtVerifier,
  handleRequest,
  PostgresStore,
  type ApiRequest,
} from '../packages/api/src/index.js';

/**
 * Vercel entry point — a thin translation layer, nothing more. All routing,
 * auth and logic live in the framework-agnostic router so they stay testable
 * without a server (charter §7: Vercel = thin API + UI; Supabase = data +
 * heavy jobs). Long-running royalty batches must NOT run here.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// Module scope: reused across warm invocations rather than reconnecting per request.
let sql: ReturnType<typeof postgres> | undefined;
function getSql() {
  // Must be the Supabase *pooler* URL (pgbouncer, transaction mode) — a direct
  // connection per serverless invocation exhausts Postgres under load.
  sql ??= postgres(required('DATABASE_URL'), { max: 1, prepare: false });
  return sql;
}

const verifier = createJwtVerifier({
  ...(process.env['SUPABASE_JWKS_URL'] ? { jwksUrl: process.env['SUPABASE_JWKS_URL'] } : {}),
  ...(process.env['SUPABASE_JWT_SECRET'] ? { hmacSecret: process.env['SUPABASE_JWT_SECRET'] } : {}),
  ...(process.env['JWT_ISSUER'] ? { issuer: process.env['JWT_ISSUER'] } : {}),
});

interface VercelRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface VercelResponse {
  status(code: number): VercelResponse;
  setHeader(name: string, value: string): void;
  send(body: string): void;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  const query: Record<string, string | undefined> = {};
  for (const [key, value] of url.searchParams) query[key] = value;

  const apiRequest: ApiRequest = {
    method: req.method ?? 'GET',
    path: url.pathname,
    query,
    headers,
    body: req.body,
  };

  const result = await handleRequest(apiRequest, {
    store: new PostgresStore(getSql()),
    verifier,
    newId: () => randomUUID(),
  });

  res.status(result.status);
  for (const [key, value] of Object.entries(result.headers)) res.setHeader(key, value);
  res.send(JSON.stringify(result.body));
}
