"use strict";

/**
 * Offline Web Crypto ECDSA P-256 (ES256) Pro license key verifier for VaultLens.
 *
 * Key format:
 *   VLPRO-<base64url(JSON payload)>.<base64url(64-byte IEEE P1363 ECDSA P-256 signature)>
 *
 * Security & portability model:
 * - Zero Node.js built-ins: runs identically on Obsidian Desktop (Electron),
 *   Obsidian Mobile iOS (WebKit), Obsidian Mobile Android (WebView), and Node.js 20/22.
 * - Only the ECDSA P-256 public JWK (kty/crv/x/y — NEVER private `d`) ships in main.js.
 * - Zero network calls, zero license server, $0.00 backend cost.
 * - Rotate DEFAULT_PUBLIC_KEY_JWK via `node tools/keygen.mjs init` before selling paid keys.
 */

const LICENSE_PREFIX = "VLPRO-";
const PRODUCT_ID = "vaultlens-pro";
const VALID_PLANS = new Set(["pro-monthly", "pro-lifetime", "team"]);
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

const DEFAULT_PUBLIC_KEY_JWK = Object.freeze({
  kty: "EC",
  crv: "P-256",
  x: "3aHDBzq8ZRWHxRayao4XlaUudEb7gjTIbv-tDGP69s4",
  y: "qyPtq_3bJa0NB0xhk6UUwtEennfklYgzmE5_IDZP-oM",
});

const B64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const B64URL_LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < B64URL_ALPHABET.length; i += 1) {
  B64URL_LOOKUP[B64URL_ALPHABET.charCodeAt(i)] = i;
}

/**
 * Pure-JS base64url encoder (RFC 4648 Section 5, unpadded).
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function base64UrlEncode(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = "";
  const len = arr.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = arr[i];
    const has1 = i + 1 < len;
    const has2 = i + 2 < len;
    const b1 = has1 ? arr[i + 1] : 0;
    const b2 = has2 ? arr[i + 2] : 0;

    const triplet = (b0 << 16) | (b1 << 8) | b2;
    out += B64URL_ALPHABET[(triplet >>> 18) & 0x3f];
    out += B64URL_ALPHABET[(triplet >>> 12) & 0x3f];
    if (has1) {
      out += B64URL_ALPHABET[(triplet >>> 6) & 0x3f];
    }
    if (has2) {
      out += B64URL_ALPHABET[triplet & 0x3f];
    }
  }
  return out;
}

/**
 * Pure-JS strict base64url decoder (RFC 4648 Section 5, unpadded).
 *
 * @param {string} str
 * @returns {Uint8Array | null}
 */
function base64UrlDecode(str) {
  if (typeof str !== "string" || str.length === 0 || !BASE64URL_RE.test(str)) {
    return null;
  }
  const rem = str.length % 4;
  if (rem === 1) {
    return null;
  }

  const outLen = Math.floor((str.length * 3) / 4);
  const out = new Uint8Array(outLen);
  let outIdx = 0;

  for (let i = 0; i < str.length; i += 4) {
    const c0 = B64URL_LOOKUP[str.charCodeAt(i)];
    const c1 = B64URL_LOOKUP[str.charCodeAt(i + 1)];
    const has2 = i + 2 < str.length;
    const has3 = i + 3 < str.length;
    const c2 = has2 ? B64URL_LOOKUP[str.charCodeAt(i + 2)] : 0;
    const c3 = has3 ? B64URL_LOOKUP[str.charCodeAt(i + 3)] : 0;

    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) {
      return null;
    }

    const triplet = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    out[outIdx] = (triplet >>> 16) & 0xff;
    outIdx += 1;
    if (has2 && outIdx < outLen) {
      out[outIdx] = (triplet >>> 8) & 0xff;
      outIdx += 1;
    }
    if (has3 && outIdx < outLen) {
      out[outIdx] = triplet & 0xff;
      outIdx += 1;
    }
  }

  return out;
}

function getSubtleCrypto() {
  if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  return null;
}

function sanitizePublicJwk(jwk) {
  if (!jwk || typeof jwk !== "object" || Array.isArray(jwk)) {
    return null;
  }
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") {
    return null;
  }
  if (typeof jwk.x !== "string" || typeof jwk.y !== "string" || !jwk.x || !jwk.y) {
    return null;
  }
  // Reject private key material if accidentally passed as public key
  if (jwk.d !== undefined) {
    return null;
  }
  return {
    kty: "EC",
    crv: "P-256",
    x: jwk.x,
    y: jwk.y,
    ext: true,
  };
}

/**
 * Verify a VaultLens Pro offline license key using Web Crypto ECDSA P-256 (ES256).
 *
 * @param {string} rawKey
 * @param {{ publicKeyJwk?: object, now?: Date | number }} [options]
 * @returns {Promise<{
 *   valid: boolean,
 *   tier: "pro" | "free",
 *   reason: string,
 *   payload: {
 *     v: number,
 *     product: string,
 *     plan: string,
 *     email: string,
 *     issuedAt: string,
 *     expiresAt: string | null,
 *     seats: number,
 *     id?: string
 *   } | null
 * }>}
 */
async function verifyLicenseKey(rawKey, options = {}) {
  if (typeof rawKey !== "string" || rawKey.trim().length === 0) {
    return { valid: false, tier: "free", reason: "empty_key", payload: null };
  }

  const trimmed = rawKey.trim();
  if (!trimmed.startsWith(LICENSE_PREFIX)) {
    return { valid: false, tier: "free", reason: "invalid_prefix", payload: null };
  }

  const body = trimmed.slice(LICENSE_PREFIX.length);
  const parts = body.split(".");
  if (parts.length !== 2) {
    return { valid: false, tier: "free", reason: "malformed_format", payload: null };
  }

  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64 || !BASE64URL_RE.test(payloadB64) || !BASE64URL_RE.test(sigB64)) {
    return { valid: false, tier: "free", reason: "invalid_encoding", payload: null };
  }

  const sigBytes = base64UrlDecode(sigB64);
  if (!sigBytes || sigBytes.length !== 64) {
    return { valid: false, tier: "free", reason: "invalid_signature_length", payload: null };
  }

  const subtle = getSubtleCrypto();
  if (!subtle) {
    return { valid: false, tier: "free", reason: "webcrypto_unavailable", payload: null };
  }

  const publicJwk = sanitizePublicJwk(options.publicKeyJwk || DEFAULT_PUBLIC_KEY_JWK);
  if (!publicJwk) {
    return { valid: false, tier: "free", reason: "invalid_public_key", payload: null };
  }

  let cryptoKey;
  try {
    cryptoKey = await subtle.importKey(
      "jwk",
      publicJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
  } catch (_) {
    return { valid: false, tier: "free", reason: "invalid_public_key", payload: null };
  }

  const encoder = new TextEncoder();
  const signingInput = encoder.encode(`${LICENSE_PREFIX}${payloadB64}`);

  let signatureValid = false;
  try {
    signatureValid = await subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      cryptoKey,
      sigBytes,
      signingInput
    );
  } catch (_) {
    signatureValid = false;
  }

  if (!signatureValid) {
    return { valid: false, tier: "free", reason: "invalid_signature", payload: null };
  }

  let payload;
  try {
    const payloadBytes = base64UrlDecode(payloadB64);
    if (!payloadBytes) {
      return { valid: false, tier: "free", reason: "invalid_payload_json", payload: null };
    }
    const jsonText = new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes);
    payload = JSON.parse(jsonText);
  } catch (_) {
    return { valid: false, tier: "free", reason: "invalid_payload_json", payload: null };
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { valid: false, tier: "free", reason: "invalid_payload_schema", payload: null };
  }
  if (payload.v !== 1 || payload.product !== PRODUCT_ID) {
    return { valid: false, tier: "free", reason: "wrong_product_or_version", payload: null };
  }
  if (!VALID_PLANS.has(payload.plan)) {
    return { valid: false, tier: "free", reason: "invalid_plan", payload: null };
  }
  if (typeof payload.email !== "string" || !payload.email.includes("@") || payload.email.length < 5) {
    return { valid: false, tier: "free", reason: "invalid_email", payload: null };
  }
  const issuedMs = Date.parse(payload.issuedAt);
  if (!Number.isFinite(issuedMs)) {
    return { valid: false, tier: "free", reason: "invalid_issued_at", payload: null };
  }
  const seats = payload.seats === undefined ? 1 : payload.seats;
  if (!Number.isInteger(seats) || seats < 1 || seats > 10000) {
    return { valid: false, tier: "free", reason: "invalid_seats", payload: null };
  }

  const nowMs =
    options.now instanceof Date
      ? options.now.getTime()
      : typeof options.now === "number"
        ? options.now
        : Date.now();

  if (payload.expiresAt !== null && payload.expiresAt !== undefined) {
    const expiresMs = Date.parse(payload.expiresAt);
    if (!Number.isFinite(expiresMs)) {
      return { valid: false, tier: "free", reason: "invalid_expires_at", payload: null };
    }
    if (expiresMs <= nowMs) {
      return {
        valid: false,
        tier: "free",
        reason: "expired",
        payload: { ...payload, seats },
      };
    }
  }

  return {
    valid: true,
    tier: "pro",
    reason: "ok",
    payload: {
      v: 1,
      product: PRODUCT_ID,
      plan: payload.plan,
      email: payload.email,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt === undefined ? null : payload.expiresAt,
      seats,
      id: payload.id || undefined,
    },
  };
}

function formatLicenseSummary(verification) {
  if (!verification || !verification.valid || !verification.payload) {
    if (verification && verification.reason === "expired" && verification.payload) {
      return `Expired (${verification.payload.email} · expired ${String(verification.payload.expiresAt).slice(0, 10)})`;
    }
    return "Free Tier";
  }
  const { plan, email, expiresAt, seats } = verification.payload;
  const planLabel =
    plan === "pro-lifetime"
      ? "Pro Lifetime"
      : plan === "team"
        ? `Pro Team (${seats} seats)`
        : "Pro Monthly";
  const expiryLabel = expiresAt ? `valid until ${String(expiresAt).slice(0, 10)}` : "never expires";
  return `${planLabel} · ${email} (${expiryLabel})`;
}

module.exports = {
  LICENSE_PREFIX,
  PRODUCT_ID,
  VALID_PLANS,
  DEFAULT_PUBLIC_KEY_JWK,
  base64UrlEncode,
  base64UrlDecode,
  verifyLicenseKey,
  formatLicenseSummary,
};
