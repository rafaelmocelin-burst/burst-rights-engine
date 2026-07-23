import type { UserId } from '@burst/domain';
import { unauthorized } from './errors.js';

/**
 * Identity crosses from the game to the rights engine by **verifying the game's
 * JWT** (ADR 0010) — never by sharing a service-role key with a game build.
 */

export interface Principal {
  readonly userId: UserId;
  /** True for trusted server-to-server callers (storefront, batch workers). */
  readonly isService: boolean;
}

export interface TokenVerifier {
  verify(token: string): Promise<Principal>;
}

const BEARER = /^Bearer\s+(.+)$/i;

export function extractBearerToken(authorizationHeader: string | undefined): string {
  if (!authorizationHeader) throw unauthorized('Missing Authorization header');
  const match = BEARER.exec(authorizationHeader.trim());
  if (!match) throw unauthorized('Authorization header must be a Bearer token');
  return match[1]!.trim();
}

export async function authenticate(
  authorizationHeader: string | undefined,
  verifier: TokenVerifier,
): Promise<Principal> {
  const token = extractBearerToken(authorizationHeader);
  try {
    return await verifier.verify(token);
  } catch (err) {
    // Never leak why verification failed — that is an oracle for token forgery.
    if (process.env['NODE_ENV'] !== 'production') {
      console.warn('[auth] token verification failed:', (err as Error).message);
    }
    throw unauthorized('Token verification failed');
  }
}

export interface JwtVerifierConfig {
  /** JWKS endpoint of the issuing project (asymmetric keys — preferred). */
  readonly jwksUrl?: string;
  /** Shared secret for legacy HS256 Supabase JWTs. */
  readonly hmacSecret?: string;
  readonly issuer?: string;
  readonly audience?: string;
  /** Subjects (or a `role` claim) treated as trusted service callers. */
  readonly serviceRoles?: readonly string[];
}

/**
 * Real verifier backed by `jose`. Imported lazily so tests and the in-memory
 * stack never need the dependency resolved.
 */
export function createJwtVerifier(config: JwtVerifierConfig): TokenVerifier {
  if (!config.jwksUrl && !config.hmacSecret) {
    throw new Error('JWT verifier needs either jwksUrl or hmacSecret');
  }
  const serviceRoles = new Set(config.serviceRoles ?? ['service_role']);

  // Resolved once per process; the JWKS client caches and rotates keys itself.
  let keyPromise: Promise<unknown> | undefined;

  return {
    async verify(token: string): Promise<Principal> {
      const jose = await import('jose');
      keyPromise ??= config.jwksUrl
        ? Promise.resolve(jose.createRemoteJWKSet(new URL(config.jwksUrl)))
        : Promise.resolve(new TextEncoder().encode(config.hmacSecret!));
      const key = await keyPromise;

      const { payload } = await jose.jwtVerify(token, key as Parameters<typeof jose.jwtVerify>[1], {
        ...(config.issuer !== undefined ? { issuer: config.issuer } : {}),
        ...(config.audience !== undefined ? { audience: config.audience } : {}),
      });

      const sub = payload.sub;
      if (typeof sub !== 'string' || sub.length === 0) {
        throw new Error('Token has no subject');
      }
      const role = typeof payload['role'] === 'string' ? payload['role'] : undefined;
      return { userId: sub as UserId, isService: role !== undefined && serviceRoles.has(role) };
    },
  };
}
