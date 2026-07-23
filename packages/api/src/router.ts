import { authenticate, type TokenVerifier } from './auth.js';
import { ApiError, notFound } from './errors.js';
import {
  getCreationSplits,
  getHealth,
  getHolderStatement,
  postProvenanceEvent,
  postUsageEvent,
  type HandlerDeps,
} from './handlers.js';

/**
 * Framework-agnostic router. Takes a normalized request and returns a
 * normalized response, so the whole API is testable without a server, and the
 * Vercel (or any other) adapter is a thin translation layer.
 *
 * The API is **versioned by path** (`/v1/...`): the UE client and the backend
 * must be able to evolve independently (charter §6).
 */

export interface ApiRequest {
  readonly method: string;
  /** Path only, no query string, e.g. '/v1/events/usage'. */
  readonly path: string;
  readonly query: Record<string, string | undefined>;
  readonly headers: Record<string, string | undefined>;
  readonly body?: unknown;
}

export interface ApiResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

export interface RouterDeps extends HandlerDeps {
  readonly verifier: TokenVerifier;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function normalizePath(path: string): string {
  // Collapse a trailing slash so '/v1/health/' and '/v1/health' are the same route.
  const trimmed = path.replace(/\/+$/, '');
  return trimmed.length === 0 ? '/' : trimmed;
}

export async function handleRequest(req: ApiRequest, deps: RouterDeps): Promise<ApiResponse> {
  try {
    const path = normalizePath(req.path);
    const method = req.method.toUpperCase();
    const auth = () => authenticate(req.headers['authorization'], deps.verifier);

    if (method === 'GET' && path === '/v1/health') {
      return ok(await getHealth(deps));
    }

    if (method === 'POST' && path === '/v1/events/provenance') {
      return ok(await postProvenanceEvent(req.body, await auth(), deps));
    }

    if (method === 'POST' && path === '/v1/events/usage') {
      return ok(await postUsageEvent(req.body, await auth(), deps));
    }

    const splits = /^\/v1\/creations\/([^/]+)\/splits$/.exec(path);
    if (splits && method === 'GET') {
      await auth();
      return ok(await getCreationSplits(decodeURIComponent(splits[1]!), req.query['at'], deps));
    }

    const statement = /^\/v1\/holders\/([^/]+)\/statement$/.exec(path);
    if (statement && method === 'GET') {
      return ok(
        await getHolderStatement(decodeURIComponent(statement[1]!), req.query, await auth(), deps),
      );
    }

    throw notFound('route_not_found', `No route for ${method} ${path}`);
  } catch (err) {
    return errorResponse(err);
  }
}

function ok(result: { status: number; body: unknown }): ApiResponse {
  return { status: result.status, headers: JSON_HEADERS, body: result.body };
}

function errorResponse(err: unknown): ApiResponse {
  if (err instanceof ApiError) {
    return {
      status: err.status,
      headers: JSON_HEADERS,
      body: {
        error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
      },
    };
  }
  // Unexpected failures must not leak internals (stack traces, SQL, table names)
  // to a caller — log server-side, return an opaque 500.
  console.error('[api] unhandled error:', err);
  return {
    status: 500,
    headers: JSON_HEADERS,
    body: { error: { code: 'internal_error', message: 'Internal error' } },
  };
}
