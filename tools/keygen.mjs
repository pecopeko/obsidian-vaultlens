#!/usr/bin/env node
/**
 * Creator-only offline Web Crypto ECDSA P-256 (ES256) license key generator for VaultLens Pro.
 * NEVER bundled into main.js and NEVER attached to Obsidian GitHub Releases.
 *
 * Usage:
 *   node tools/keygen.mjs init   --out ~/.vaultlens/issuer.es256.private.jwk
 *   node tools/keygen.mjs sign   --key ~/.vaultlens/issuer.es256.private.jwk --email user@example.com --plan pro-lifetime
 *   node tools/keygen.mjs sign   --key ~/.vaultlens/issuer.es256.private.jwk --email user@example.com --plan pro-monthly --expires 2027-12-31T23:59:59Z
 *   node tools/keygen.mjs verify --license VLPRO-... [--key <public-or-private.jwk>]
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  LICENSE_PREFIX,
  PRODUCT_ID,
  VALID_PLANS,
  base64UrlEncode,
  verifyLicenseKey,
  formatLicenseSummary,
} = require("../src/core/license.js");

function getSubtle() {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error("Web Crypto API (globalThis.crypto.subtle) is required (Node >= 20)");
  }
  return globalThis.crypto.subtle;
}

/**
 * Strip private fields from an ECDSA P-256 JWK to yield a clean public-only JWK.
 *
 * @param {object} jwk
 */
export function extractPublicJwk(jwk) {
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) {
    throw new Error("Invalid ECDSA P-256 JWK");
  }
  return {
    kty: "EC",
    crv: "P-256",
    x: jwk.x,
    y: jwk.y,
  };
}

/**
 * Generate a fresh ECDSA P-256 (ES256) keypair in JWK format.
 *
 * @returns {Promise<{ publicKeyJwk: object, privateKeyJwk: object }>}
 */
export async function generateKeyPair() {
  const subtle = getSubtle();
  const kp = await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicRaw = await subtle.exportKey("jwk", kp.publicKey);
  const privateRaw = await subtle.exportKey("jwk", kp.privateKey);
  return {
    publicKeyJwk: extractPublicJwk(publicRaw),
    privateKeyJwk: {
      kty: privateRaw.kty,
      crv: privateRaw.crv,
      x: privateRaw.x,
      y: privateRaw.y,
      d: privateRaw.d,
      ext: true,
    },
  };
}

function randomHexId(byteLen = 6) {
  const bytes = new Uint8Array(byteLen);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Mint an offline-verifiable Web Crypto ES256 VaultLens Pro license key.
 *
 * @param {{
 *   privateKeyJwk: object,
 *   email: string,
 *   plan?: "pro-monthly" | "pro-lifetime" | "team",
 *   expiresAt?: string | null,
 *   issuedAt?: string,
 *   seats?: number,
 *   id?: string
 * }} params
 * @returns {Promise<{ licenseKey: string, payload: object }>}
 */
export async function mintLicenseKey({
  privateKeyJwk,
  email,
  plan = "pro-lifetime",
  expiresAt = null,
  issuedAt = new Date().toISOString(),
  seats = 1,
  id = `vl_${randomHexId(6)}`,
}) {
  if (!privateKeyJwk || !privateKeyJwk.d) {
    throw new Error("A valid ECDSA P-256 privateKeyJwk (with 'd') is required");
  }
  if (!email || !String(email).includes("@")) {
    throw new Error("A valid customer email is required");
  }
  if (!VALID_PLANS.has(plan)) {
    throw new Error(
      `Invalid plan "${plan}". Expected one of: ${Array.from(VALID_PLANS).join(", ")}`
    );
  }

  let normalizedExpiresAt = null;
  if (expiresAt !== null && expiresAt !== undefined && String(expiresAt).trim() !== "") {
    const parsed = Date.parse(expiresAt);
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid expiresAt timestamp: ${expiresAt}`);
    }
    normalizedExpiresAt = new Date(parsed).toISOString();
  }

  const issuedMs = Date.parse(issuedAt);
  if (!Number.isFinite(issuedMs)) {
    throw new Error(`Invalid issuedAt timestamp: ${issuedAt}`);
  }

  const payload = {
    v: 1,
    product: PRODUCT_ID,
    plan,
    email: String(email).trim(),
    issuedAt: new Date(issuedMs).toISOString(),
    expiresAt: normalizedExpiresAt,
    seats: Number(seats) || 1,
    id,
  };

  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(JSON.stringify(payload));
  const payloadB64 = base64UrlEncode(payloadBytes);
  const signingInput = encoder.encode(`${LICENSE_PREFIX}${payloadB64}`);

  const subtle = getSubtle();
  const signingKey = await subtle.importKey(
    "jwk",
    privateKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const sigBuf = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, signingInput);
  const sigB64 = base64UrlEncode(new Uint8Array(sigBuf));

  return {
    licenseKey: `${LICENSE_PREFIX}${payloadB64}.${sigB64}`,
    payload,
  };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

async function runCli(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];

  if (cmd === "init") {
    const outPath = args.out ? path.resolve(args.out) : null;
    if (!outPath) {
      console.error(
        "Error: specify --out <path-outside-repo> so the ES256 private JWK is saved with 0600 permissions."
      );
      process.exitCode = 1;
      return;
    }
    const { publicKeyJwk, privateKeyJwk } = await generateKeyPair();
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(privateKeyJwk, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    console.log(`Saved ECDSA P-256 (ES256) private JWK (0600) to: ${outPath}`);
    console.log("NEVER commit this private key to git or ship it in Obsidian releases!\n");
    console.log("Paste this public-only JWK into src/core/license.js (DEFAULT_PUBLIC_KEY_JWK):");
    console.log(JSON.stringify(publicKeyJwk, null, 2));
    return;
  }

  if (cmd === "sign") {
    const keyPath = args.key;
    const email = args.email;
    const plan = args.plan || "pro-lifetime";
    const expiresAt = args.expires || null;
    const seats = args.seats ? Number(args.seats) : 1;

    if (!keyPath || !email) {
      console.error(
        "Usage: node tools/keygen.mjs sign --key <private.jwk> --email <customer@email> [--plan pro-lifetime|pro-monthly|team] [--expires YYYY-MM-DD] [--seats 1]"
      );
      process.exitCode = 1;
      return;
    }

    const privateKeyJwk = JSON.parse(fs.readFileSync(path.resolve(keyPath), "utf8"));
    const { licenseKey, payload } = await mintLicenseKey({
      privateKeyJwk,
      email,
      plan,
      expiresAt,
      seats,
    });
    console.log("License Key:\n");
    console.log(licenseKey);
    console.log("\nPayload:", JSON.stringify(payload, null, 2));
    return;
  }

  if (cmd === "verify") {
    const license = args.license;
    if (!license) {
      console.error(
        "Usage: node tools/keygen.mjs verify --license VLPRO-... [--key <public-or-private.jwk>]"
      );
      process.exitCode = 1;
      return;
    }
    let publicKeyJwk;
    if (args.key) {
      const loaded = JSON.parse(fs.readFileSync(path.resolve(args.key), "utf8"));
      publicKeyJwk = extractPublicJwk(loaded);
    }
    const res = await verifyLicenseKey(license, { publicKeyJwk });
    console.log(JSON.stringify({ ...res, summary: formatLicenseSummary(res) }, null, 2));
    if (!res.valid) {
      process.exitCode = 1;
    }
    return;
  }

  console.log(`VaultLens Pro Offline Keygen (Web Crypto ECDSA P-256 / ES256)
Commands:
  init   --out <path-outside-repo>
  sign   --key <private.jwk> --email <email> [--plan pro-lifetime|pro-monthly|team] [--expires <ISO>] [--seats <N>]
  verify --license <VLPRO-...> [--key <public-or-private.jwk>]`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
