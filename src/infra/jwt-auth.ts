/**
 * src/infra/jwt-auth.ts
 * JWT validation for multi-tenant auth. HS256 only; add jsonwebtoken for full support.
 */

import crypto from 'crypto';

export interface JwtPayload {
  sub?: string;
  tenantId?: string;
  orgId?: string;
  exp?: number;
  iat?: number;
  [key: string]: unknown;
}

/** Decode JWT payload without verification (insecure; use verifyJwt for production). */
export function decodeJwt(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Verify JWT signature and return payload. Uses HMAC-SHA256.
 * Set HYPERCLAW_JWT_SECRET for verification.
 */
export function verifyJwt(token: string): JwtPayload | null {
  const secret = process.env.HYPERCLAW_JWT_SECRET;
  if (!secret) return decodeJwt(token);
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const signed = `${headerB64}.${payloadB64}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('base64url');
  if (expected !== sigB64) return null;
  try {
    return JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as JwtPayload;
  } catch {
    return null;
  }
}

/** Extract tenantId from Bearer token (JWT or developer key). Developer key tenantId comes from validateDeveloperKey. */
export function getTenantIdFromJwt(bearer: string): string | undefined {
  if (!bearer || !bearer.startsWith('Bearer ')) return undefined;
  const token = bearer.slice(7).trim();
  const payload = verifyJwt(token);
  return (payload?.tenantId ?? payload?.orgId ?? payload?.sub) as string | undefined;
}
