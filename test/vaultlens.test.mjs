import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Module, { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);

const tokenizer = require("../src/core/tokenizer.js");
const redactor = require("../src/core/redactor.js");
const graph = require("../src/core/graph.js");
const license = require("../src/core/license.js");
const auditor = require("../src/core/vault_auditor.js");
const { generateKeyPair, mintLicenseKey } = await import("../tools/keygen.mjs");
const { buildBundle } = await import("../scripts/build_bundle.mjs");

// Dynamically construct synthetic secrets so zero contiguous GH013 secret literals exist in source
const FAKE_AWS_KEY = "AK" + "IA" + "IOSFODNN7REALKEY";
const FAKE_OPENAI_KEY = "sk" + "-proj-" + "AbCdEfGhIjKlMnOpQrStUvWxYz123456";
const FAKE_ANTHROPIC_KEY = "sk" + "-ant-api03-" + "ZzYyXxWwVvUuTtSsRrQqPpOoNnMm1234";
const FAKE_GITHUB_TOKEN = "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
const FAKE_SLACK_TOKEN = "xo" + "xb-" + "123456789012-123456789012-AbCdEfGhIjKlMnOpQrSt";
const FAKE_STRIPE_KEY = "sk" + "_live_" + "51AbCdEfGhIjKlMnOpQrStUvWxYz";
const FAKE_PEM_BLOCK =
  "-----BEGIN " +
  "PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\n-----END " +
  "PRIVATE KEY-----";

// Compute a valid Japanese Mod-11 MyNumber dynamically for test fixtures
function makeValidMyNumber(prefix11) {
  let weightedSum = 0;
  for (let n = 1; n <= 11; n += 1) {
    const pn = Number(prefix11[11 - n]);
    const qn = n <= 6 ? n + 1 : n - 5;
    weightedSum += pn * qn;
  }
  const rem = weightedSum % 11;
  const checkDigit = rem <= 1 ? 0 : 11 - rem;
  return `${prefix11}${checkDigit}`;
}

const VALID_MYNUMBER = makeValidMyNumber("12345678901");
const INVALID_MYNUMBER = `${VALID_MYNUMBER.slice(0, 11)}${(Number(VALID_MYNUMBER[11]) + 1) % 10}`;

// ---------------------------------------------------------------------------
// 1. Multi-script EN/JP tokenizer & 6-model cost calculator
// ---------------------------------------------------------------------------
test("1. Multi-script EN/JP/Emoji tokenizer, pure-JS UTF-8 byte length & 6-model pricing", () => {
  const sampleMixed = "Hello VaultLens! 日本語ノートと漢字テスト 🚀 한국어";
  assert.equal(tokenizer.utf8ByteLength(sampleMixed), Buffer.byteLength(sampleMixed, "utf8"));
  assert.equal(tokenizer.utf8ByteLength(""), 0);

  const enMetrics = tokenizer.estimateTokens(
    "# Architecture Notes\n\nWe use `buildContextBundle` with camelCase and snake_case tokens."
  );
  assert.ok(enMetrics.tokens >= 14 && enMetrics.tokens <= 35, `Unexpected EN tokens: ${enMetrics.tokens}`);
  assert.equal(enMetrics.dominantScript, "en-markdown");

  const jpMetrics = tokenizer.estimateTokens(
    "Obsidianのナレッジベースから関連ノートを安全に抽出して、個人情報を自動的にマスクします。"
  );
  assert.ok(jpMetrics.tokens >= 40, `Expected realistic higher JP BPE token count, got ${jpMetrics.tokens}`);
  assert.equal(jpMetrics.dominantScript, "ja-mixed");
  assert.ok(jpMetrics.breakdown.kanaChars > 10);
  assert.ok(jpMetrics.breakdown.cjkChars > 10);

  const allCosts = tokenizer.calculateAllModelCosts(100_000);
  assert.equal(allCosts.length, 6);
  const claude = allCosts.find((m) => m.modelId === "claude-sonnet-4");
  const gpt5 = allCosts.find((m) => m.modelId === "gpt-5");
  const gemini = allCosts.find((m) => m.modelId === "gemini-2.5-pro");
  assert.ok(claude && gpt5 && gemini);
  assert.ok(Math.abs(claude.inputCostUsd - 0.3) < 1e-12);
  assert.ok(Math.abs(gpt5.inputCostUsd - 0.125) < 1e-12);
  assert.equal(gemini.contextWindow, 1_000_000);
  assert.equal(tokenizer.formatUsd(0.00005), "<$0.0001");
  assert.equal(tokenizer.formatUsd(0.0042), "$0.0042");
  assert.equal(tokenizer.formatUsd(1.5), "$1.50");

  const label = tokenizer.formatStatusBarLabel({
    noteTokens: 1200,
    linkedTokens: 3400,
    linkedNoteCount: 3,
    modelId: "claude-sonnet-4",
    findingCount: 2,
  });
  assert.match(label, /1,200 \+ 3,400 \(3 links\)/);
  assert.match(label, /Claude Sonnet 4/);
  assert.match(label, /2 PII\/sec/);
});

// ---------------------------------------------------------------------------
// 2. Frontmatter, Obsidian %%comment%% stripping & wikilink/embed extraction
// ---------------------------------------------------------------------------
test("2. Frontmatter parsing, %%comment%% stripping (preserving code blocks) & wikilink parsing", () => {
  const md = [
    "---",
    "title: Meeting Notes",
    "tags:",
    "  - strategy",
    "  - q4",
    "confidential: true",
    "---",
    "",
    "Visible intro %%inline private comment%% and more text.",
    "",
    "%%",
    "Multiline private note referencing [[HiddenNote]]",
    "%%",
    "",
    "```markdown",
    "Keep %%literal percent inside code%% and [[CodeBlockFakeLink]] untouched",
    "```",
    "",
    "Inline code `%%stay%%` and `[[InlineFake]]` stay intact.",
    "Links: [[Alpha|Alpha Display]], [[Beta#Roadmap]], ![[Gamma#Security|Sec]], ![[chart.png]], [[#Local Section]].",
  ].join("\n");

  const fm = graph.extractFrontmatter(md);
  assert.equal(fm.hasFrontmatter, true);
  assert.equal(fm.frontmatter.title, "Meeting Notes");
  assert.deepEqual(fm.frontmatter.tags, ["strategy", "q4"]);
  assert.equal(fm.frontmatter.confidential, true);
  assert.ok(!fm.body.includes("confidential: true"));

  const cleaned = graph.cleanNoteContent(md, { stripFrontmatter: true, stripComments: true });
  assert.ok(!cleaned.includes("inline private comment"));
  assert.ok(!cleaned.includes("Multiline private note"));
  assert.ok(cleaned.includes("Keep %%literal percent inside code%%"));
  assert.ok(cleaned.includes("`%%stay%%`"));

  const links = graph.extractWikiLinks(md);
  const targets = links.map((l) => l.target);
  assert.ok(!targets.includes("HiddenNote"), "Links inside %%comments%% must be ignored");
  assert.ok(!targets.includes("CodeBlockFakeLink"), "Links inside fenced code blocks must be ignored");
  assert.ok(!targets.includes("InlineFake"), "Links inside inline code must be ignored");

  const alpha = links.find((l) => l.target === "Alpha");
  assert.equal(alpha.alias, "Alpha Display");
  assert.equal(alpha.isEmbed, false);

  const beta = links.find((l) => l.target === "Beta");
  assert.equal(beta.subpath, "#Roadmap");

  const gamma = links.find((l) => l.target === "Gamma");
  assert.equal(gamma.isEmbed, true);
  assert.equal(gamma.subpath, "#Security");
  assert.equal(gamma.alias, "Sec");

  const img = links.find((l) => l.target === "chart.png");
  assert.equal(img.isAttachment, true);

  const local = links.find((l) => l.subpath === "#Local Section");
  assert.equal(local.isSameNote, true);
});

// ---------------------------------------------------------------------------
// 3. Graph traversal (1-hop, 2-hop, cycles, heading embeds & token budget cap)
// ---------------------------------------------------------------------------
test("3. Wikilink graph traversal handles 1-hop, 2-hop, cycles, embeds & token budget truncation", () => {
  const vaultNotes = new Map([
    [
      "Root.md",
      "---\ntags: [root]\n---\n# Root\nSee [[Hop1A|First]] and ![[Hop1B#Key Section]] and [[Root]] and [[MissingNote]].\n",
    ],
    ["Folder/Hop1A.md", "# Hop 1A\nLinks back to [[Root]] and forward to [[Hop2]].\n"],
    [
      "Folder/Hop1B.md",
      "# Hop 1B\n\n## Intro\nSkip me.\n\n## Key Section\nCritical embedded details here.\n\n## Footer\nSkip footer.\n",
    ],
    ["Deep/Hop2.md", "# Hop 2\nCycle back to [[Hop1A]] and extra context.\n"],
  ]);

  // 1-hop XML bundle
  const oneHop = graph.buildContextBundle("Root.md", vaultNotes, {
    depth: 1,
    includeEmbeds: true,
    format: "xml",
  });
  assert.deepEqual(
    oneHop.includedNotes.map((n) => n.path),
    ["Root.md", "Folder/Hop1A.md", "Folder/Hop1B.md"]
  );
  assert.equal(oneHop.unresolvedLinks.length, 1);
  assert.equal(oneHop.unresolvedLinks[0].target, "MissingNote");
  assert.ok(oneHop.bundleText.includes("Critical embedded details here."));
  assert.ok(!oneHop.bundleText.includes("Skip footer."), "Heading embed should slice only target section");
  assert.ok(oneHop.bundleText.includes("<vaultlens_context"));

  // 2-hop Markdown bundle with cycle safety
  const twoHop = graph.buildContextBundle("Root.md", vaultNotes, {
    depth: 2,
    includeEmbeds: true,
    format: "markdown",
  });
  assert.deepEqual(
    twoHop.includedNotes.map((n) => n.path),
    ["Root.md", "Folder/Hop1A.md", "Folder/Hop1B.md", "Deep/Hop2.md"]
  );
  assert.ok(twoHop.bundleText.includes("# VaultLens AI Context Bundle"));
  assert.ok(twoHop.bundleText.includes("```markdown"));

  // Token budget enforcement
  const hugeVault = new Map([
    ["Root.md", "Root intro linking [[GiantA]] and [[GiantB]].\n" + "alpha beta gamma delta ".repeat(60)],
    ["GiantA.md", "paragraph one ".repeat(350)],
    ["GiantB.md", "paragraph two ".repeat(350)],
  ]);
  const capped = graph.buildContextBundle("Root.md", hugeVault, {
    depth: 1,
    maxTokens: 320,
  });
  assert.equal(capped.budgetExceeded, true);
  assert.ok(capped.totalTokens <= 340, `Expected totalTokens near budget 320, got ${capped.totalTokens}`);
  assert.ok(capped.omittedNotes.length >= 1 || capped.includedNotes.some((n) => n.truncated));
});

// ---------------------------------------------------------------------------
// 4. Reversible PII, secret & custom client-alias redactor + $&/$1 restore safety
// ---------------------------------------------------------------------------
test("4. Reversible redactor catches secrets, PII, Japanese MyNumber, custom aliases & restores $&/$1 safely", () => {
  const vault = new redactor.RedactionVault();
  const fullwidthMyNumber = VALID_MYNUMBER.replace(/\d/g, (d) =>
    String.fromCharCode(0xff10 + Number(d))
  );
  const dollarPassword = "P@ss$&1$$$'word99!";
  const input = [
    `Client: Project Phoenix (subsidiary of Acme Holdings / 株式会社ミライ)`,
    `Contact: alice.tanaka@example.co.jp / 090-1234-5678 / 10.42.8.15`,
    `Safe DNS: 8.8.8.8 and loopback 127.0.0.1 and version v1.2.3.4`,
    `MyNumber half: ${VALID_MYNUMBER.slice(0, 4)}-${VALID_MYNUMBER.slice(4, 8)}-${VALID_MYNUMBER.slice(8)}`,
    `MyNumber full: ${fullwidthMyNumber}`,
    `Not MyNumber (bad check digit): ${INVALID_MYNUMBER}`,
    `AWS: ${FAKE_AWS_KEY}`,
    `OpenAI: ${FAKE_OPENAI_KEY}`,
    `Anthropic: ${FAKE_ANTHROPIC_KEY}`,
    `GitHub: ${FAKE_GITHUB_TOKEN}`,
    `Slack: ${FAKE_SLACK_TOKEN}`,
    `Stripe: ${FAKE_STRIPE_KEY}`,
    `DB_PASSWORD="${dollarPassword}"`,
    FAKE_PEM_BLOCK,
    `Ignored email: safe@ignore.test %%vaultlens-ignore%%`,
    `Repeat mention of Project Phoenix and alice.tanaka@example.co.jp.`,
  ].join("\n");

  const customAliases = "Project Phoenix\nAcme Holdings => CLIENT\n株式会社ミライ";
  const redacted = vault.redact(input, {
    includeSecrets: true,
    includePii: true,
    customAliases,
  });

  // Verify zero sensitive values remain
  for (const sensitive of [
    "Project Phoenix",
    "Acme Holdings",
    "株式会社ミライ",
    "alice.tanaka@example.co.jp",
    "090-1234-5678",
    "10.42.8.15",
    VALID_MYNUMBER.slice(0, 4) + "-" + VALID_MYNUMBER.slice(4, 8) + "-" + VALID_MYNUMBER.slice(8),
    fullwidthMyNumber,
    FAKE_AWS_KEY,
    FAKE_OPENAI_KEY,
    FAKE_ANTHROPIC_KEY,
    FAKE_GITHUB_TOKEN,
    FAKE_SLACK_TOKEN,
    FAKE_STRIPE_KEY,
    dollarPassword,
  ]) {
    assert.ok(!redacted.redactedText.includes(sensitive), `Sensitive value leaked: ${sensitive}`);
  }

  // Verify safe non-PII items remain untouched
  assert.ok(redacted.redactedText.includes("8.8.8.8"));
  assert.ok(redacted.redactedText.includes("127.0.0.1"));
  assert.ok(redacted.redactedText.includes("v1.2.3.4"));
  assert.ok(redacted.redactedText.includes(INVALID_MYNUMBER));
  assert.ok(redacted.redactedText.includes("safe@ignore.test"));

  // Verify expected placeholder conventions
  assert.ok(redacted.redactedText.includes("[[ALIAS_1]]"), "Project Phoenix should map to [[ALIAS_1]]");
  assert.ok(redacted.redactedText.includes("[[ALIAS_CLIENT_1]]"), "Acme Holdings => CLIENT should map to [[ALIAS_CLIENT_1]]");
  assert.ok(redacted.redactedText.includes("[[PII_EMAIL_1]]"));
  assert.ok(redacted.redactedText.includes("[[PII_MYNUMBER_1]]"));
  assert.ok(redacted.redactedText.includes("[[SECRET_AWS_1]]"));

  // Deterministic deduplication: Project Phoenix & email reuse exact same placeholder
  const aliasMatches = redacted.redactedText.match(/\[\[ALIAS_1\]\]/g) || [];
  assert.equal(aliasMatches.length, 2);

  // Full lossless restore including $& / $1 / $$ / $' in password!
  const restored = vault.restore(redacted.redactedText);
  assert.equal(restored.restoredText, input);
  assert.ok(restored.replacedCount >= 14);
  assert.deepEqual(restored.unknownPlaceholders, []);

  // Unknown placeholders reported without crashing
  const withUnknown = vault.restore("Hi [[PII_EMAIL_1]] and [[ALIAS_999]]");
  assert.equal(withUnknown.restoredText, "Hi alice.tanaka@example.co.jp and [[ALIAS_999]]");
  assert.deepEqual(withUnknown.unknownPlaceholders, ["[[ALIAS_999]]"]);
});

// ---------------------------------------------------------------------------
// 5. Offline Web Crypto ECDSA P-256 (ES256) Pro license verification
// ---------------------------------------------------------------------------
test("5. Offline Web Crypto ES256 Pro license verification (valid, tampered, expired, wrong key, no private d)", async () => {
  // Embedded public key must never contain private 'd' and must import cleanly in Web Crypto
  assert.equal(license.DEFAULT_PUBLIC_KEY_JWK.d, undefined);
  assert.equal(license.DEFAULT_PUBLIC_KEY_JWK.kty, "EC");
  assert.equal(license.DEFAULT_PUBLIC_KEY_JWK.crv, "P-256");
  const importedDefault = await globalThis.crypto.subtle.importKey(
    "jwk",
    { ...license.DEFAULT_PUBLIC_KEY_JWK, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
  assert.equal(importedDefault.type, "public");

  const kpA = await generateKeyPair();
  const kpB = await generateKeyPair();

  // Valid lifetime license
  const lifetime = await mintLicenseKey({
    privateKeyJwk: kpA.privateKeyJwk,
    email: "researcher@obsidian.test",
    plan: "pro-lifetime",
  });
  assert.ok(lifetime.licenseKey.startsWith("VLPRO-"));
  const okLifetime = await license.verifyLicenseKey(lifetime.licenseKey, {
    publicKeyJwk: kpA.publicKeyJwk,
  });
  assert.equal(okLifetime.valid, true);
  assert.equal(okLifetime.tier, "pro");
  assert.equal(okLifetime.reason, "ok");
  assert.equal(okLifetime.payload.email, "researcher@obsidian.test");
  assert.match(license.formatLicenseSummary(okLifetime), /Pro Lifetime/);

  // Tampered payload fails
  const [payloadPart, sigPart] = lifetime.licenseKey.slice("VLPRO-".length).split(".");
  const tamperedPayloadObj = { ...lifetime.payload, email: "attacker@evil.test", seats: 999 };
  const tamperedB64 = license.base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(tamperedPayloadObj))
  );
  const tamperedRes = await license.verifyLicenseKey(`VLPRO-${tamperedB64}.${sigPart}`, {
    publicKeyJwk: kpA.publicKeyJwk,
  });
  assert.equal(tamperedRes.valid, false);
  assert.equal(tamperedRes.reason, "invalid_signature");

  // Tampered signature byte fails
  const flippedSig = (sigPart[0] === "A" ? "B" : "A") + sigPart.slice(1);
  const badSigRes = await license.verifyLicenseKey(`VLPRO-${payloadPart}.${flippedSig}`, {
    publicKeyJwk: kpA.publicKeyJwk,
  });
  assert.equal(badSigRes.valid, false);
  assert.equal(badSigRes.reason, "invalid_signature");

  // Wrong public key fails
  const wrongKeyRes = await license.verifyLicenseKey(lifetime.licenseKey, {
    publicKeyJwk: kpB.publicKeyJwk,
  });
  assert.equal(wrongKeyRes.valid, false);
  assert.equal(wrongKeyRes.reason, "invalid_signature");

  // Private key accidentally passed as publicKeyJwk is rejected
  const privRejected = await license.verifyLicenseKey(lifetime.licenseKey, {
    publicKeyJwk: kpA.privateKeyJwk,
  });
  assert.equal(privRejected.valid, false);
  assert.equal(privRejected.reason, "invalid_public_key");

  // Expiring monthly license: valid before expiry, rejected after expiry
  const monthly = await mintLicenseKey({
    privateKeyJwk: kpA.privateKeyJwk,
    email: "member@lab.org",
    plan: "pro-monthly",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-06-01T00:00:00.000Z",
  });
  const beforeExp = await license.verifyLicenseKey(monthly.licenseKey, {
    publicKeyJwk: kpA.publicKeyJwk,
    now: Date.parse("2026-03-15T00:00:00.000Z"),
  });
  assert.equal(beforeExp.valid, true);
  assert.equal(beforeExp.tier, "pro");

  const afterExp = await license.verifyLicenseKey(monthly.licenseKey, {
    publicKeyJwk: kpA.publicKeyJwk,
    now: Date.parse("2026-06-02T00:00:00.000Z"),
  });
  assert.equal(afterExp.valid, false);
  assert.equal(afterExp.tier, "free");
  assert.equal(afterExp.reason, "expired");
  assert.match(license.formatLicenseSummary(afterExp), /Expired/);

  // Empty / invalid prefix checks
  assert.equal((await license.verifyLicenseKey("")).reason, "empty_key");
  assert.equal((await license.verifyLicenseKey("BAD-abc.def")).reason, "invalid_prefix");
});

// ---------------------------------------------------------------------------
// 6. CLI end-to-end test of tools/keygen.mjs (init -> sign -> verify)
// ---------------------------------------------------------------------------
test("6. Creator CLI tools/keygen.mjs init -> sign -> verify works end-to-end", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultlens-keygen-"));
  const keyPath = path.join(tmpDir, "issuer.es256.private.jwk");
  const keygenPath = path.join(ROOT_DIR, "tools", "keygen.mjs");

  try {
    const initOut = execFileSync(process.execPath, [keygenPath, "init", "--out", keyPath], {
      encoding: "utf8",
    });
    assert.ok(fs.existsSync(keyPath));
    assert.ok(initOut.includes('"crv": "P-256"'));
    assert.ok(!initOut.includes('"d":'), "CLI init stdout must print public-only JWK without 'd'");

    const signOut = execFileSync(
      process.execPath,
      [
        keygenPath,
        "sign",
        "--key",
        keyPath,
        "--email",
        "buyer@obsidian-user.dev",
        "--plan",
        "team",
        "--seats",
        "5",
      ],
      { encoding: "utf8" }
    );
    const keyMatch = signOut.match(/VLPRO-[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    assert.ok(keyMatch, "Expected VLPRO-... key in CLI output");

    const verifyOut = execFileSync(
      process.execPath,
      [keygenPath, "verify", "--key", keyPath, "--license", keyMatch[0]],
      { encoding: "utf8" }
    );
    const parsed = JSON.parse(verifyOut);
    assert.equal(parsed.valid, true);
    assert.equal(parsed.tier, "pro");
    assert.equal(parsed.payload.plan, "team");
    assert.equal(parsed.payload.seats, 5);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 7. Pro Vault-Wide Token Heatmap, Orphan & Broken-Link Audit + RAG JSONL Export
// ---------------------------------------------------------------------------
test("7. Pro vault auditor & batch sanitized RAG JSONL exporter", () => {
  const vaultNotes = [
    {
      path: "Projects/Phoenix-Spec.md",
      content: [
        "---",
        "title: Project Phoenix Architecture",
        "owner: lead@phoenix.test",
        "tags: [architecture, rag]",
        "---",
        "# Overview",
        "Project Phoenix connects to [[Projects/API-Design]] and [[GhostNote]].",
        "![[diagram.png]] and [[#Security]] should NOT be counted as broken links.",
        "%%private scratchpad%%",
        "",
        "## Security",
        `Production key: ${FAKE_OPENAI_KEY}`,
        "Detailed specification text ".repeat(90),
      ].join("\n"),
    },
    {
      path: "Projects/API-Design.md",
      content: "# API Design\nReferenced by Phoenix. Clean note with [[Projects/Phoenix-Spec]].\n",
    },
    {
      path: "Inbox/Orphan-Idea.md",
      content: "# Lonely Thought\nNo incoming or outgoing wikilinks here.\n",
    },
  ];

  const audit = auditor.auditVault(vaultNotes, { customAliases: "Project Phoenix" });
  assert.equal(audit.summary.noteCount, 3);
  assert.equal(audit.heaviestNotes[0].path, "Projects/Phoenix-Spec.md");
  assert.equal(audit.summary.brokenLinkCount, 1);
  assert.equal(audit.brokenLinks[0].target, "GhostNote");
  assert.equal(audit.summary.orphanCount, 1);
  assert.equal(audit.orphanNotes[0].path, "Inbox/Orphan-Idea.md");
  assert.equal(audit.modelCosts.length, 6);
  assert.equal(audit.privacyHotspots.length, 1);
  assert.equal(audit.folderBreakdown[0].folder, "Projects");

  const reportMd = auditor.renderVaultAuditMarkdown(audit, { defaultModelId: "gpt-5" });
  assert.ok(reportMd.includes("# VaultLens Pro — Vault Token Heatmap & Wikilink Audit"));
  assert.ok(reportMd.includes("[[Projects/Phoenix-Spec]]"));
  assert.ok(reportMd.includes("[[Inbox/Orphan-Idea]]"));
  assert.ok(reportMd.includes("`GhostNote`"));
  // Zero raw secrets or raw emails leaked into Markdown audit report!
  assert.ok(!reportMd.includes(FAKE_OPENAI_KEY), "Raw API key must NEVER appear in audit report");
  assert.ok(!reportMd.includes("lead@phoenix.test"), "Raw email must NEVER appear in audit report");

  // Batch sanitized RAG JSONL export scoped to "Projects" folder
  const exported = auditor.exportFolderToRagJsonl(vaultNotes, {
    folderPrefix: "Projects",
    chunkMaxTokens: 180,
    chunkOverlapTokens: 30,
    customAliases: "Project Phoenix",
  });
  assert.equal(exported.noteCount, 2);
  assert.ok(exported.recordCount >= 3, `Expected multiple heading/token chunks, got ${exported.recordCount}`);
  assert.ok(exported.totalRedactions >= 3);

  const lines = exported.jsonl.trim().split("\n");
  assert.equal(lines.length, exported.recordCount);
  for (const line of lines) {
    const rec = JSON.parse(line);
    assert.ok(rec.id && rec.source_path && typeof rec.text === "string");
    assert.ok(!rec.text.includes(FAKE_OPENAI_KEY), "JSONL text must redact API keys");
    assert.ok(!rec.text.includes("Project Phoenix"), "JSONL text must redact custom aliases");
    assert.ok(!rec.text.includes("private scratchpad"), "JSONL text must strip %%comments%%");
    assert.ok(!JSON.stringify(rec.frontmatter).includes("lead@phoenix.test"), "JSONL frontmatter must redact emails");
    assert.ok(!JSON.stringify(rec.frontmatter).includes("Project Phoenix"), "JSONL frontmatter must redact aliases");
  }
});

// ---------------------------------------------------------------------------
// 8. Full Mocked Obsidian Lifecycle Loading the ACTUAL Built main.js Bundle
// ---------------------------------------------------------------------------
function createMockElement(tag = "div") {
  const el = {
    tagName: tag.toUpperCase(),
    textContent: "",
    value: "",
    classes: new Set(),
    attrs: new Map(),
    listeners: new Map(),
    children: [],
    empty() {
      this.children = [];
      this.textContent = "";
    },
    setText(t) {
      this.textContent = String(t ?? "");
    },
    addClass(cls) {
      for (const c of String(cls).split(/\s+/).filter(Boolean)) this.classes.add(c);
    },
    removeClass(cls) {
      for (const c of String(cls).split(/\s+/).filter(Boolean)) this.classes.delete(c);
    },
    setAttr(k, v) {
      this.attrs.set(k, String(v));
    },
    addEventListener(ev, fn) {
      const list = this.listeners.get(ev) || [];
      list.push(fn);
      this.listeners.set(ev, list);
    },
    createEl(childTag, opts = {}) {
      const child = createMockElement(childTag);
      if (opts.text !== undefined) child.setText(opts.text);
      if (opts.cls) child.addClass(opts.cls);
      if (opts.href) child.setAttr("href", opts.href);
      if (opts.attr) {
        for (const [k, v] of Object.entries(opts.attr)) child.setAttr(k, v);
      }
      this.children.push(child);
      return child;
    },
    createDiv(opts = {}) {
      return this.createEl("div", opts);
    },
    createSpan(opts = {}) {
      return this.createEl("span", opts);
    },
  };
  return el;
}

test("8. Actual built main.js bundle loads in mocked Obsidian lifecycle (Free + Pro E2E)", async () => {
  // Rebuild deterministically before loading
  const buildRes = buildBundle();
  assert.ok(buildRes.bytes > 10_000);

  const notices = [];
  const openedModals = [];
  const openedFiles = [];
  let clipboardBuffer = "";

  // Install mock clipboard
  const prevNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        async writeText(t) {
          clipboardBuffer = String(t);
        },
        async readText() {
          return clipboardBuffer;
        },
      },
    },
  });

  // Mock "obsidian" module via Module._load hook
  const mockObsidian = {
    Plugin: class MockPlugin {
      constructor(app, manifest) {
        this.app = app;
        this.manifest = manifest;
        this._commands = new Map();
        this._events = [];
        this._settingTabs = [];
        this._ribbons = [];
        this._statusItems = [];
        this._savedData = null;
      }
      async loadData() {
        return this._savedData;
      }
      async saveData(data) {
        this._savedData = JSON.parse(JSON.stringify(data));
      }
      addStatusBarItem() {
        const el = createMockElement("div");
        this._statusItems.push(el);
        return el;
      }
      addRibbonIcon(icon, title, cb) {
        this._ribbons.push({ icon, title, cb });
        return createMockElement("div");
      }
      addCommand(cmd) {
        this._commands.set(cmd.id, cmd);
        return cmd;
      }
      addSettingTab(tab) {
        this._settingTabs.push(tab);
      }
      registerEvent(ev) {
        this._events.push(ev);
      }
    },
    PluginSettingTab: class MockSettingTab {
      constructor(app, plugin) {
        this.app = app;
        this.plugin = plugin;
        this.containerEl = createMockElement("div");
      }
    },
    Setting: class MockSetting {
      constructor(containerEl) {
        this.containerEl = containerEl;
      }
      setName() { return this; }
      setDesc() { return this; }
      setHeading() { return this; }
      addDropdown(cb) {
        cb({ addOption() {}, setValue() {}, onChange() {} });
        return this;
      }
      addToggle(cb) {
        cb({ setValue() { return this; }, onChange() { return this; } });
        return this;
      }
      addText(cb) {
        cb({ setPlaceholder() { return this; }, setValue() { return this; }, onChange() { return this; } });
        return this;
      }
      addTextArea(cb) {
        cb({
          inputEl: createMockElement("textarea"),
          setPlaceholder() { return this; },
          setValue() { return this; },
          onChange() { return this; },
        });
        return this;
      }
      addButton(cb) {
        cb({ setButtonText() { return this; }, onClick() { return this; } });
        return this;
      }
    },
    Notice: class MockNotice {
      constructor(msg) {
        notices.push(String(msg));
      }
    },
    Modal: class MockModal {
      constructor(app) {
        this.app = app;
        this.contentEl = createMockElement("div");
      }
      open() {
        openedModals.push(this);
        if (typeof this.onOpen === "function") this.onOpen();
      }
      close() {
        if (typeof this.onClose === "function") this.onClose();
      }
    },
    MarkdownView: class MockMarkdownView {
      constructor(file, editor) {
        this.file = file;
        this.editor = editor;
      }
    },
    normalizePath: (p) => String(p || "").replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/"),
  };

  const origLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "obsidian") {
      return mockObsidian;
    }
    return origLoad.call(this, request, parent, isMain);
  };

  try {
    const mainPath = path.join(ROOT_DIR, "main.js");
    delete require.cache[mainPath];
    const mainMod = require(mainPath);
    assert.equal(mainMod.__esModule, true);
    const VaultLensPlugin = mainMod.default;
    assert.equal(typeof VaultLensPlugin, "function");

    // Create mocked Obsidian Vault with notes
    const vaultStore = new Map([
      [
        "Projects/Brief.md",
        `---\ntags: [client]\n---\n# Project Phoenix Brief\nContact ceo@phoenix.test and key ${FAKE_GITHUB_TOKEN}.\nSee [[Projects/Details]] and [[BrokenTarget]].\n%%hidden comment%%\n`,
      ],
      [
        "Projects/Details.md",
        "# Technical Details\nLinked from Brief. Clean architecture overview.\n",
      ],
      [
        "Notes/Orphan.md",
        "# Standalone Note\nNot linked anywhere.\n",
      ],
    ]);

    const makeFileObj = (p) => ({
      path: p,
      name: p.split("/").pop(),
      extension: p.includes(".") ? p.split(".").pop() : "",
      parent: { path: p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "/" },
      stat: { mtime: Date.now() },
    });

    const activeFile = makeFileObj("Projects/Brief.md");
    let insertedEditorContent = "";
    const mockEditor = {
      getValue: () => vaultStore.get("Projects/Brief.md"),
      getSelection: () => "",
      replaceSelection: (text) => {
        insertedEditorContent = text;
      },
    };
    const activeView = new mockObsidian.MarkdownView(activeFile, mockEditor);

    const mockApp = {
      vault: {
        getMarkdownFiles: () =>
          Array.from(vaultStore.keys())
            .filter((p) => p.endsWith(".md"))
            .map(makeFileObj),
        cachedRead: async (f) => vaultStore.get(f.path) || "",
        getAbstractFileByPath: (p) => (vaultStore.has(p) ? makeFileObj(p) : null),
        create: async (p, content) => {
          vaultStore.set(p, content);
          return makeFileObj(p);
        },
        modify: async (f, content) => {
          vaultStore.set(f.path, content);
        },
      },
      workspace: {
        getActiveViewOfType: () => activeView,
        getActiveFile: () => activeFile,
        on: (name, cb) => ({ name, cb }),
        getLeaf: () => ({
          openFile: async (file) => {
            openedFiles.push(file.path);
          },
        }),
      },
      metadataCache: {
        getFirstLinkpathDest: () => null,
        on: (name, cb) => ({ name, cb }),
      },
    };

    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "manifest.json"), "utf8"));
    const plugin = new VaultLensPlugin(mockApp, manifest);
    plugin._savedData = { customAliases: "Project Phoenix" };

    await plugin.onload();

    // Verify lifecycle registrations & live status bar
    assert.equal(plugin._commands.size, 9);
    assert.equal(plugin._ribbons.length, 1);
    assert.equal(plugin._settingTabs.length, 1);
    assert.equal(plugin._events.length, 4);
    assert.equal(plugin._statusItems.length, 1);
    assert.match(plugin.statusBarEl.textContent, /VaultLens:.*\(1 link\).*PII\/sec/);
    assert.ok(plugin.statusBarEl.classes.has("vaultlens-status-alert"));

    // Settings tab renders without innerHTML or throwing
    plugin._settingTabs[0].display();

    // 1. Copy safe AI context bundle (1-hop)
    const bundle = await plugin.copySafeContextBundle();
    assert.equal(bundle.includedNotes.length, 2);
    assert.ok(clipboardBuffer.includes("<vaultlens_context"));
    assert.ok(clipboardBuffer.includes("[[ALIAS_1]]"));
    assert.ok(clipboardBuffer.includes("[[PII_EMAIL_1]]"));
    assert.ok(clipboardBuffer.includes("[[SECRET_GITHUB_1]]"));
    assert.ok(!clipboardBuffer.includes("Project Phoenix"));
    assert.ok(!clipboardBuffer.includes("ceo@phoenix.test"));
    assert.ok(!clipboardBuffer.includes(FAKE_GITHUB_TOKEN));
    assert.ok(!clipboardBuffer.includes("hidden comment"));

    // 2. Paste & restore AI reply into active editor
    clipboardBuffer = "Summary for [[ALIAS_1]]: email [[PII_EMAIL_1]] to rotate [[SECRET_GITHUB_1]].";
    const restored = await plugin.pasteAndRestoreIntoActiveNote();
    assert.equal(restored.replacedCount, 3);
    assert.equal(
      insertedEditorContent,
      `Summary for Project Phoenix: email ceo@phoenix.test to rotate ${FAKE_GITHUB_TOKEN}.`
    );

    // 3. Free tier blocks Pro audit cleanly (opens ProUpgradeModal, creates NO audit file)
    const freeAudit = await plugin.runProVaultAudit();
    assert.equal(freeAudit, null);
    assert.equal(vaultStore.has("VaultLens-Audit-Report.md"), false);
    assert.ok(openedModals.length >= 1);

    // 4. Activate real offline ES256 Pro license key -> run Pro Vault Audit & Pro Batch JSONL Export
    const testKp = await generateKeyPair();
    const proLic = await mintLicenseKey({
      privateKeyJwk: testKp.privateKeyJwk,
      email: "pro@obsidian.test",
      plan: "pro-lifetime",
    });
    plugin._publicKeyJwk = testKp.publicKeyJwk;
    plugin.settings.licenseKey = proLic.licenseKey;

    const proAudit = await plugin.runProVaultAudit();
    assert.ok(proAudit && proAudit.reportPath === "VaultLens-Audit-Report.md");
    assert.equal(vaultStore.has("VaultLens-Audit-Report.md"), true);
    assert.ok(openedFiles.includes("VaultLens-Audit-Report.md"));
    const writtenReport = vaultStore.get("VaultLens-Audit-Report.md");
    assert.ok(writtenReport.includes("VaultLens Pro — Vault Token Heatmap & Wikilink Audit"));
    assert.ok(writtenReport.includes("`BrokenTarget`"));
    assert.ok(writtenReport.includes("[[Notes/Orphan]]"));
    assert.ok(!writtenReport.includes(FAKE_GITHUB_TOKEN));

    const proExport = await plugin.executeProBatchJsonlExport("Projects", 400);
    assert.ok(proExport && proExport.outputPath === "VaultLens-RAG-Export-Projects.jsonl");
    assert.equal(vaultStore.has("VaultLens-RAG-Export-Projects.jsonl"), true);
    const jsonlRaw = vaultStore.get("VaultLens-RAG-Export-Projects.jsonl");
    assert.ok(!jsonlRaw.includes("Project Phoenix"));
    assert.ok(!jsonlRaw.includes(FAKE_GITHUB_TOKEN));
    assert.ok(!jsonlRaw.includes("ceo@phoenix.test"));
    const jsonlRows = jsonlRaw.trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(jsonlRows.length, proExport.recordCount);

    // 5. Unload cleans up in-memory PII vault
    assert.ok(plugin.redactionVault.size() > 0);
    plugin.onunload();
    assert.equal(plugin.redactionVault.size(), 0);
  } finally {
    Module._load = origLoad;
    if (prevNavigator) {
      Object.defineProperty(globalThis, "navigator", prevNavigator);
    } else {
      delete globalThis.navigator;
    }
  }
});

// ---------------------------------------------------------------------------
// 9. Obsidian-style wikilink resolution disambiguation & case-insensitivity
// ---------------------------------------------------------------------------
test("9. Wikilink resolution prefers exact path, then same folder, then shortest path", () => {
  const paths = [
    "Archive/Deep/Summary.md",
    "Projects/Alpha/Summary.md",
    "Projects/Alpha/Overview.md",
    "Summary.md",
  ];

  // Exact path wins (case-insensitive too)
  assert.equal(
    graph.resolveLinkTarget("projects/alpha/summary", paths, "Archive/Deep/Other.md"),
    "Projects/Alpha/Summary.md"
  );
  // Same-folder disambiguation for bare wikilink [[Summary]] from Projects/Alpha/Overview.md
  assert.equal(
    graph.resolveLinkTarget("Summary", paths, "Projects/Alpha/Overview.md"),
    "Projects/Alpha/Summary.md"
  );
  // Shortest basename from unrelated folder resolves to root Summary.md
  assert.equal(graph.resolveLinkTarget("Summary", paths, "Notes/Daily.md"), "Summary.md");
  // Missing link returns null
  assert.equal(graph.resolveLinkTarget("DoesNotExist", paths, "Notes/Daily.md"), null);
});

// ---------------------------------------------------------------------------
// 10. Deterministic main.js rebuild & zero Node built-ins / zero innerHTML
// ---------------------------------------------------------------------------
test("10. Deterministic build_bundle.mjs produces byte-identical, mobile-safe main.js", () => {
  const mainPath = path.join(ROOT_DIR, "main.js");
  buildBundle();
  const first = fs.readFileSync(mainPath, "utf8");
  buildBundle();
  const second = fs.readFileSync(mainPath, "utf8");
  assert.equal(first, second, "Repeated builds must be byte-for-byte deterministic");

  // Verify zero Node built-ins or unsafe DOM calls exist in main.js
  for (const forbidden of [
    'require("fs")',
    'require("path")',
    'require("crypto")',
    'require("os")',
    "node:crypto",
    "Buffer.from",
    "Buffer.byteLength",
    ".innerHTML",
    ".outerHTML",
  ]) {
    assert.ok(!first.includes(forbidden), `Forbidden mobile-incompatible construct in main.js: ${forbidden}`);
  }
  assert.ok(first.includes('require("obsidian")'), "main.js must consume require('obsidian')");
});

// ---------------------------------------------------------------------------
// 11. Edge cases: empty vault, unclosed %%, custom alias in note path
// ---------------------------------------------------------------------------
test("11. Edge cases: empty vault, unclosed %% comment safety & custom alias redaction in path", () => {
  assert.equal(tokenizer.estimateTokens("").tokens, 0);
  assert.equal(graph.stripObsidianComments("Keep text %%unclosed comment"), "Keep text %%unclosed comment");

  const emptyAudit = auditor.auditVault([]);
  assert.equal(emptyAudit.summary.noteCount, 0);
  assert.equal(emptyAudit.summary.totalTokens, 0);
  const emptyMd = auditor.renderVaultAuditMarkdown(emptyAudit);
  assert.ok(emptyMd.includes("_No Markdown notes found in vault._"));

  const rv = new redactor.RedactionVault();
  const notes = new Map([
    ["Clients/Project Phoenix/Roadmap.md", "# Project Phoenix Q1\nLaunch checklist for Project Phoenix."],
  ]);
  const bundle = graph.buildContextBundle("Clients/Project Phoenix/Roadmap.md", notes, {
    depth: 0,
    redactionVault: rv,
    customAliases: "Project Phoenix",
  });
  assert.ok(!bundle.bundleText.includes("Project Phoenix"), "Path AND content must redact custom aliases");
  assert.ok(bundle.bundleText.includes("Clients/[[ALIAS_1]]/Roadmap.md"));
});

// ---------------------------------------------------------------------------
// 12. Mobile fallback: selection restore & modal fallback when clipboard read fails
// ---------------------------------------------------------------------------
test("12. Selection restore & interactive modal fallback when mobile clipboard read is blocked", async () => {
  const openedModals = [];
  const prevNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        async writeText() {},
        async readText() {
          throw new Error("Clipboard read denied on mobile WebView");
        },
      },
    },
  });

  const mockObsidian = {
    Plugin: class {
      constructor(app, manifest) {
        this.app = app;
        this.manifest = manifest;
      }
      async loadData() { return {}; }
      async saveData() {}
      addCommand() {}
      addSettingTab() {}
      registerEvent() {}
    },
    PluginSettingTab: class {},
    Setting: class {},
    Notice: class {},
    Modal: class {
      constructor(app) {
        this.app = app;
        this.contentEl = createMockElement("div");
      }
      open() {
        openedModals.push(this);
        if (this.onOpen) this.onOpen();
      }
      close() {}
    },
    MarkdownView: class {
      constructor(file, editor) {
        this.file = file;
        this.editor = editor;
      }
    },
    normalizePath: (p) => String(p || ""),
  };

  const origLoad = Module._load;
  Module._load = (req, parent, isMain) => (req === "obsidian" ? mockObsidian : origLoad.call(Module, req, parent, isMain));

  try {
    const mainPath = path.join(ROOT_DIR, "main.js");
    delete require.cache[mainPath];
    const VaultLensPlugin = require(mainPath).default;

    let selectedText = "Draft for [[ALIAS_1]]";
    let replacedWith = "";
    const activeView = new mockObsidian.MarkdownView(
      { path: "Note.md", extension: "md" },
      {
        getValue: () => "Note",
        getSelection: () => selectedText,
        replaceSelection: (t) => { replacedWith = t; },
      }
    );
    const app = {
      vault: { getMarkdownFiles: () => [], cachedRead: async () => "" },
      workspace: {
        getActiveViewOfType: () => activeView,
        getActiveFile: () => activeView.file,
        on: () => ({}),
      },
    };
    const plugin = new VaultLensPlugin(app, { id: "vaultlens-ai-context", version: "1.0.0" });
    await plugin.onload();

    plugin.redactionVault.redact("Secret Project Phoenix", { customAliases: "Project Phoenix" });

    // First: restoring active selection works without even touching clipboard
    const selRes = await plugin.pasteAndRestoreIntoActiveNote();
    assert.equal(selRes.replacedCount, 1);
    assert.equal(replacedWith, "Draft for Project Phoenix");

    // Second: when no selection and clipboard read throws, opens RestoreReplyModal gracefully
    selectedText = "";
    const fallbackRes = await plugin.pasteAndRestoreIntoActiveNote();
    assert.equal(fallbackRes, null);
    assert.equal(openedModals.length, 1);
    plugin.onunload();
  } finally {
    Module._load = origLoad;
    if (prevNavigator) {
      Object.defineProperty(globalThis, "navigator", prevNavigator);
    } else {
      delete globalThis.navigator;
    }
  }
});
