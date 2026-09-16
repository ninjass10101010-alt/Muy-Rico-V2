// Trusted-device tokens for the Muy Rico dashboard home-screen app.
// Tokens are 256-bit random values; D1 stores only their SHA-256 digest.

const TOKEN_TTL_DAYS = 90;
const MAX_ACTIVE_TOKENS_PER_EMAIL = 10;

const encoder = new TextEncoder();

/** Random 256-bit token, base64url-encoded. */
export function generateDeviceToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

/** SHA-256 hex digest of a token (the only thing we persist). */
export async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64Url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function isoPlusDays(days) {
  return new Date(Date.now() + days * 86400_000).toISOString();
}

/**
 * Mint a device token for `email`. Enforces the per-email active cap by
 * evicting the oldest tokens. Returns { token, expiresAt }.
 */
export async function mintDeviceToken(env, email, label) {
  const token = generateDeviceToken();
  const tokenHash = await hashToken(token);
  const expiresAt = isoPlusDays(TOKEN_TTL_DAYS);

  await env.DB.prepare(
    'DELETE FROM device_tokens WHERE user_email = ? AND revoked = 1'
  ).bind(email).run();

  const countRow = await env.DB.prepare(
    'SELECT COUNT(*) AS c FROM device_tokens WHERE user_email = ? AND revoked = 0'
  ).bind(email).first();
  if ((countRow?.c ?? 0) >= MAX_ACTIVE_TOKENS_PER_EMAIL) {
    await env.DB.prepare(
      `DELETE FROM device_tokens
       WHERE user_email = ? AND revoked = 0
         AND id NOT IN (
           SELECT id FROM device_tokens WHERE user_email = ? AND revoked = 0
           ORDER BY id DESC LIMIT ?
         )`
    ).bind(email, email, MAX_ACTIVE_TOKENS_PER_EMAIL - 1).run();
  }

  await env.DB.prepare(
    'INSERT INTO device_tokens (user_email, token_hash, label, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(email, tokenHash, label || null, expiresAt).run();

  return { token, expiresAt };
}

/**
 * Validate a presented token and roll its 90-day expiry forward.
 * Returns { id, email, expiresAt } or null when invalid/expired/revoked.
 */
export async function resolveDeviceToken(env, token) {
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(
    'SELECT id, user_email, expires_at FROM device_tokens WHERE token_hash = ? AND revoked = 0'
  ).bind(tokenHash).first();
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;

  const expiresAt = isoPlusDays(TOKEN_TTL_DAYS);
  await env.DB.prepare(
    "UPDATE device_tokens SET last_used_at = datetime('now'), expires_at = ? WHERE id = ?"
  ).bind(expiresAt, row.id).run();

  return { id: row.id, email: row.user_email, expiresAt };
}

export async function listDevices(env, email) {
  const { results } = await env.DB.prepare(
    'SELECT id, label, created_at, last_used_at, expires_at FROM device_tokens WHERE user_email = ? AND revoked = 0 ORDER BY id DESC'
  ).bind(email).all();
  return results;
}

export async function revokeDevice(env, email, tokenId) {
  const out = await env.DB.prepare(
    'UPDATE device_tokens SET revoked = 1 WHERE id = ? AND user_email = ?'
  ).bind(tokenId, email).run();
  return (out.meta?.changes ?? 0) > 0;
}

export async function revokeAllDevices(env, email) {
  await env.DB.prepare(
    'UPDATE device_tokens SET revoked = 1 WHERE user_email = ? AND revoked = 0'
  ).bind(email).run();
}
