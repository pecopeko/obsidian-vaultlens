"use strict";

/**
 * Local reversible PII, secret, and custom-alias redaction engine for Obsidian VaultLens.
 * Pure JavaScript, zero Node.js built-ins (100% Desktop + iOS + Android compatible).
 *
 * Placeholder formats:
 * - PII:            [[PII_EMAIL_1]], [[PII_PHONE_1]], [[PII_MYNUMBER_1]], [[PII_IPV4_1]]
 * - Secrets:        [[SECRET_AWS_1]], [[SECRET_GITHUB_1]], [[SECRET_OPENAI_1]], ...
 * - Custom Aliases: [[ALIAS_1]], [[ALIAS_2]], or [[ALIAS_<LABEL>_1]]
 */

const FULLWIDTH_MAP = new Map();
for (let i = 0; i < 10; i += 1) {
  FULLWIDTH_MAP.set(String.fromCharCode(0xff10 + i), String(i));
}
FULLWIDTH_MAP.set("－", "-");
FULLWIDTH_MAP.set("−", "-");
FULLWIDTH_MAP.set("‐", "-");
FULLWIDTH_MAP.set("‒", "-");
FULLWIDTH_MAP.set("–", "-");
FULLWIDTH_MAP.set("—", "-");
FULLWIDTH_MAP.set("―", "-");
FULLWIDTH_MAP.set("\u3000", " ");

const PLACEHOLDER_RE = /\[\[(?:PII|SECRET)_[A-Z0-9_]+_\d+\]\]|\[\[ALIAS_(?:[A-Z0-9_]+_)?\d+\]\]/g;
const PLACEHOLDER_EXACT_RE = /^(?:\[\[(?:PII|SECRET)_[A-Z0-9_]+_\d+\]\]|\[\[ALIAS_(?:[A-Z0-9_]+_)?\d+\]\])$/;

function normalize1To1(text) {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    out += FULLWIDTH_MAP.get(ch) || ch;
  }
  return out;
}

/**
 * Validate 12-digit Japanese Individual Number (MyNumber) via MIC Mod-11 check digit.
 *
 * @param {string} raw
 * @returns {boolean}
 */
function isValidMyNumber(raw) {
  const digits = normalize1To1(String(raw || "")).replace(/[\s-]/g, "");
  if (!/^\d{12}$/.test(digits)) {
    return false;
  }
  if (/^(\d)\1{11}$/.test(digits)) {
    return false;
  }
  const checkDigit = Number(digits[11]);
  let weightedSum = 0;
  for (let n = 1; n <= 11; n += 1) {
    const pn = Number(digits[11 - n]);
    const qn = n <= 6 ? n + 1 : n - 5;
    weightedSum += pn * qn;
  }
  const rem = weightedSum % 11;
  const expected = rem <= 1 ? 0 : 11 - rem;
  return checkDigit === expected;
}

function isSensitiveIpv4(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return false;
  }
  for (let i = 0; i < 4; i += 1) {
    const seg = parts[i];
    if (seg.length > 1 && seg.startsWith("0")) {
      return false;
    }
    const n = Number(seg);
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      return false;
    }
  }
  if (
    ip === "0.0.0.0" ||
    ip === "127.0.0.1" ||
    ip === "255.255.255.255" ||
    ip === "255.255.255.0" ||
    ip === "1.1.1.1" ||
    ip === "8.8.8.8" ||
    ip === "8.8.4.4"
  ) {
    return false;
  }
  return true;
}

function hasIgnoreDirective(line) {
  return /(?:vaultlens-ignore|vaultlens-disable-line|pragma:\s*allowlist\s+secret|noscan)/i.test(line);
}

function isLikelyPlaceholderOrEnvRef(value) {
  if (!value) {
    return true;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return true;
  }
  if (PLACEHOLDER_EXACT_RE.test(trimmed)) {
    return true;
  }
  if (
    /^(?:process\.env\.[A-Za-z0-9_]+|import\.meta\.env\.[A-Za-z0-9_]+|os\.environ(?:\[|\.get)|os\.getenv|env\.[A-Za-z0-9_]+|\$\{[A-Za-z0-9_:-]+\}|\$[A-Z][A-Z0-9_]+|<[^>]+>|\{\{[^}]+\}\})$/.test(
      trimmed
    )
  ) {
    return true;
  }
  if (
    /(?:your[_-]?(?:api|secret|access|auth)?[_-]?(?:key|token|password|secret)|replace[_-]?me|change[_-]?me|placeholder|example[_-]?key|dummy[_-]?(?:key|secret|token)|fake[_-]?(?:key|secret|token)|redacted|not[_-]?a[_-]?secret|insert[_-]?here|todo|xxxx{2,}|000000{2,}|\*{4,})/i.test(
      trimmed
    )
  ) {
    return true;
  }
  if (/^(.)\1{7,}$/.test(trimmed)) {
    return true;
  }
  return false;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAsciiWordChar(ch) {
  return /^[A-Za-z0-9_]$/.test(ch);
}

/**
 * Parse custom confidential client/project aliases from settings textarea or array.
 * Supports:
 * - "Project Phoenix"               -> placeholder [[ALIAS_1]]
 * - "Project Phoenix => CLIENT_A"   -> placeholder [[ALIAS_CLIENT_A_1]]
 * - "Acme Corp -> VENDOR"           -> placeholder [[ALIAS_VENDOR_1]]
 *
 * @param {string | Array<string | { term: string, label?: string }>} rawAliases
 * @returns {Array<{ term: string, label: string | null }>}
 */
function parseCustomAliases(rawAliases) {
  if (!rawAliases) {
    return [];
  }
  const entries = [];
  const rawList = Array.isArray(rawAliases) ? rawAliases : String(rawAliases).split(/\r?\n/);

  for (const item of rawList) {
    if (!item) {
      continue;
    }
    if (typeof item === "object" && typeof item.term === "string") {
      const term = item.term.trim();
      if (term.length >= 2) {
        const label = item.label
          ? String(item.label)
              .trim()
              .toUpperCase()
              .replace(/[^A-Z0-9_]/g, "_")
              .replace(/^_+|_+$/g, "")
          : null;
        entries.push({ term, label: label || null });
      }
      continue;
    }

    const line = String(item).trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) {
      continue;
    }

    const splitMatch = line.match(/^(.+?)\s*(?:=>|->)\s*([A-Za-z0-9_-]{1,32})$/);
    if (splitMatch) {
      const term = splitMatch[1].trim();
      const label = splitMatch[2]
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, "_")
        .replace(/^_+|_+$/g, "");
      if (term.length >= 2) {
        entries.push({ term, label: label || null });
      }
    } else if (line.length >= 2) {
      entries.push({ term: line, label: null });
    }
  }

  // Deduplicate case-insensitively and sort longest-first to avoid partial shadowing
  const seen = new Set();
  const deduped = [];
  for (const entry of entries) {
    const key = entry.term.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(entry);
    }
  }
  deduped.sort((a, b) => b.term.length - a.term.length);
  return deduped;
}

const RULES = [
  {
    id: "PRIVATE_KEY",
    tag: "PEM",
    kind: "secret",
    severity: "critical",
    priority: 1,
    description: "Private cryptographic PEM key block",
    regex:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g,
  },
  {
    id: "DB_URL",
    tag: "DB_URL",
    kind: "secret",
    severity: "critical",
    priority: 2,
    description: "Database connection string with embedded credentials",
    regex:
      /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp|amqps|mssql|sqlserver):\/\/[^:\s/@'"]+?:[^@\s/'"]+?@[^\s'"`<>)]+/g,
    validate: (matchText) => {
      const creds = matchText.split("://")[1]?.split("@")[0] || "";
      const pass = creds.split(":").slice(1).join(":");
      return pass.length >= 3 && !isLikelyPlaceholderOrEnvRef(pass);
    },
  },
  {
    id: "AWS_KEY",
    tag: "AWS",
    kind: "secret",
    severity: "critical",
    priority: 3,
    description: "AWS Access Key ID",
    regex: /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
    validate: (matchText) => !matchText.endsWith("EXAMPLE"),
  },
  {
    id: "AWS_SECRET",
    tag: "AWS_SECRET",
    kind: "secret",
    severity: "critical",
    priority: 4,
    description: "AWS Secret Access Key",
    regex:
      /(?:aws_secret_access_key|aws_secret_key|secret_access_key)\s*[:=]\s*['"]?([A-Za-z0-9/+=]{40})['"]?/gi,
    captureGroup: 1,
    validate: (val) => !isLikelyPlaceholderOrEnvRef(val) && /[A-Za-z]/.test(val) && /[0-9/+=]/.test(val),
  },
  {
    id: "ANTHROPIC_KEY",
    tag: "ANTHROPIC",
    kind: "secret",
    severity: "critical",
    priority: 5,
    description: "Anthropic API Key",
    regex: /\bsk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,}\b/g,
    validate: (val) => !isLikelyPlaceholderOrEnvRef(val),
  },
  {
    id: "OPENAI_KEY",
    tag: "OPENAI",
    kind: "secret",
    severity: "critical",
    priority: 6,
    description: "OpenAI API Key",
    regex: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}\b/g,
    validate: (val) => !isLikelyPlaceholderOrEnvRef(val) && !/^sk-[a-z]+-[a-z]+$/i.test(val),
  },
  {
    id: "GITHUB_TOKEN",
    tag: "GITHUB",
    kind: "secret",
    severity: "critical",
    priority: 7,
    description: "GitHub Personal Access or Fine-Grained Token",
    regex: /\b(?:(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59})\b/g,
    validate: (val) => !isLikelyPlaceholderOrEnvRef(val),
  },
  {
    id: "SLACK_TOKEN",
    tag: "SLACK",
    kind: "secret",
    severity: "high",
    priority: 8,
    description: "Slack API Token or Incoming Webhook",
    regex:
      /\bxox[baprs]-[0-9A-Za-z-]{10,}\b|https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]{8,}\/B[A-Z0-9]{8,}\/[A-Za-z0-9]{20,}/g,
    validate: (val) => !isLikelyPlaceholderOrEnvRef(val),
  },
  {
    id: "STRIPE_KEY",
    tag: "STRIPE",
    kind: "secret",
    severity: "critical",
    priority: 9,
    description: "Stripe Secret or Restricted API Key",
    regex: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{20,}\b/g,
    validate: (val) => !isLikelyPlaceholderOrEnvRef(val),
  },
  {
    id: "JWT",
    tag: "JWT",
    kind: "secret",
    severity: "high",
    priority: 10,
    description: "JSON Web Token (JWT)",
    regex: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    id: "ENV_SECRET",
    tag: "CRED",
    kind: "secret",
    severity: "high",
    priority: 15,
    description: "Hardcoded secret/token/password assignment",
    regex:
      /(?:^|[\s{,])['"]?(?:[A-Z0-9_]*(?:API_KEY|SECRET_KEY|ACCESS_TOKEN|AUTH_TOKEN|REFRESH_TOKEN|CLIENT_SECRET|WEBHOOK_SECRET|SIGNING_SECRET|ENCRYPTION_KEY|PRIVATE_TOKEN|DB_PASSWORD|DATABASE_PASSWORD|SMTP_PASSWORD)|(?:apiKey|secretKey|accessToken|authToken|clientSecret|webhookSecret|signingSecret|dbPassword|privateToken))['"]?\s*[:=]\s*(?:['"]([^'"\r\n]{8,256})['"]|([^\s#'",;}\])]{8,256}))/gm,
    captureGroup: "firstNonEmpty",
    validate: (val) => {
      if (isLikelyPlaceholderOrEnvRef(val)) {
        return false;
      }
      if (/\s/.test(val) && val.length < 16) {
        return false;
      }
      if (/^(?:true|false|null|undefined|localhost|development|production|staging)$/i.test(val)) {
        return false;
      }
      return val.length >= 8;
    },
  },
  {
    id: "JP_MYNUMBER",
    tag: "MYNUMBER",
    kind: "pii",
    severity: "high",
    priority: 20,
    description: "Japanese Individual Number (MyNumber — Mod-11 verified)",
    regex: /(?<!\d[\s-])(?<![A-Za-z0-9])(\d{4}[\s-]?\d{4}[\s-]?\d{4})(?![A-Za-z0-9]|[\s-]\d)/g,
    useNormalized: true,
    validate: (val) => isValidMyNumber(val),
  },
  {
    id: "EMAIL",
    tag: "EMAIL",
    kind: "pii",
    severity: "medium",
    priority: 25,
    description: "Email address",
    regex: /(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})(?![A-Za-z0-9])/g,
    validate: (val) => {
      const lower = val.toLowerCase();
      return !lower.endsWith(".png") && !lower.endsWith(".jpg") && !lower.endsWith(".svg");
    },
  },
  {
    id: "IPV4",
    tag: "IPV4",
    kind: "pii",
    severity: "low",
    priority: 30,
    description: "IPv4 network address",
    regex: /(?<![0-9A-Za-z._-])(\d{1,3}(?:\.\d{1,3}){3})(?![0-9A-Za-z._-])/g,
    validate: (val, text, start) => {
      const prevChunk = text.slice(Math.max(0, start - 12), start).toLowerCase();
      if (/(?:version|ver|v)\s*[:=]?\s*["']?$/.test(prevChunk)) {
        return false;
      }
      return isSensitiveIpv4(val);
    },
  },
  {
    id: "PHONE",
    tag: "PHONE",
    kind: "pii",
    severity: "medium",
    priority: 35,
    description: "Phone number (JP / International)",
    regex:
      /(?<![0-9A-Za-z-])((?:\+81[\s-]?(?:0)?\d{1,4}[\s-]?\d{1,4}[\s-]?\d{3,4}|0(?:[789]0[\s-]?\d{4}[\s-]?\d{4}|[1-9]\d{0,3}-\d{1,4}-\d{3,4})|\+1[\s-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}|\(\d{3}\)\s?\d{3}-\d{4}))(?![0-9A-Za-z-])/g,
    useNormalized: true,
    validate: (val) => {
      const digits = val.replace(/\D/g, "");
      return digits.length >= 10 && digits.length <= 13;
    },
  },
];

function buildLineIndex(text) {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      lineStarts.push(i + 1);
    }
  }
  return lineStarts;
}

function offsetToPosition(lineStarts, index) {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lineStarts[mid] <= index) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const line = Math.max(0, hi);
  return { line, character: index - lineStarts[line] };
}

function getLineText(text, lineStarts, line) {
  const start = lineStarts[line];
  const end = line + 1 < lineStarts.length ? lineStarts[line + 1] - 1 : text.length;
  return text.slice(start, end);
}

function maskSecretPreview(value) {
  const clean = String(value || "").replace(/\s+/g, " ");
  if (clean.length <= 6) {
    return "••••••";
  }
  if (clean.length <= 14) {
    return `${clean.slice(0, 2)}••••${clean.slice(-2)}`;
  }
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}

function collectPlaceholderRanges(text) {
  const ranges = [];
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  let m;
  while ((m = re.exec(text)) !== null) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

function overlapsAnyRange(start, end, ranges) {
  for (let i = 0; i < ranges.length; i += 1) {
    const [rStart, rEnd] = ranges[i];
    if (start < rEnd && end > rStart) {
      return true;
    }
  }
  return false;
}

/**
 * Scan Markdown or text for secrets, PII, and custom user-defined client/project aliases.
 *
 * @param {string} text
 * @param {{
 *   includeSecrets?: boolean,
 *   includePii?: boolean,
 *   customAliases?: string | Array<string | { term: string, label?: string }>,
 *   respectIgnoreComments?: boolean
 * }} [options]
 */
function scanText(text, options = {}) {
  const {
    includeSecrets = true,
    includePii = true,
    customAliases = [],
    respectIgnoreComments = true,
  } = options;

  if (typeof text !== "string" || text.length === 0) {
    return [];
  }

  const normalized = normalize1To1(text);
  const lineStarts = buildLineIndex(text);
  const existingPlaceholders = collectPlaceholderRanges(text);
  const candidates = [];

  for (const rule of RULES) {
    if (rule.kind === "secret" && !includeSecrets) {
      continue;
    }
    if (rule.kind === "pii" && !includePii) {
      continue;
    }

    const haystack = rule.useNormalized ? normalized : text;
    const re = new RegExp(rule.regex.source, rule.regex.flags);
    let match;

    while ((match = re.exec(haystack)) !== null) {
      let matchedValue = match[0];
      let start = match.index;
      let end = start + matchedValue.length;

      if (rule.captureGroup === "firstNonEmpty") {
        const captured = match[1] !== undefined ? match[1] : match[2];
        if (!captured) {
          continue;
        }
        const sepIdx = match[0].search(/[:=]/);
        const searchFrom = sepIdx >= 0 ? sepIdx + 1 : 0;
        const localIdx = match[0].indexOf(captured, searchFrom);
        if (localIdx < 0) {
          continue;
        }
        start = match.index + localIdx;
        end = start + captured.length;
        matchedValue = text.slice(start, end);
      } else if (typeof rule.captureGroup === "number") {
        const captured = match[rule.captureGroup];
        if (!captured) {
          continue;
        }
        const sepIdx = match[0].search(/[:=]/);
        const searchFrom = sepIdx >= 0 ? sepIdx + 1 : 0;
        const localIdx = match[0].indexOf(captured, searchFrom);
        if (localIdx < 0) {
          continue;
        }
        start = match.index + localIdx;
        end = start + captured.length;
        matchedValue = text.slice(start, end);
      } else {
        matchedValue = text.slice(start, end);
      }

      if (overlapsAnyRange(start, end, existingPlaceholders)) {
        continue;
      }

      if (rule.validate && !rule.validate(matchedValue, text, start, end)) {
        continue;
      }

      const startPos = offsetToPosition(lineStarts, start);
      if (respectIgnoreComments) {
        const lineStr = getLineText(text, lineStarts, startPos.line);
        if (hasIgnoreDirective(lineStr)) {
          continue;
        }
      }

      const endPos = offsetToPosition(lineStarts, end);
      candidates.push({
        ruleId: rule.id,
        tag: rule.tag,
        kind: rule.kind,
        severity: rule.severity,
        priority: rule.priority,
        description: rule.description,
        value: matchedValue,
        maskedPreview: maskSecretPreview(matchedValue),
        start,
        end,
        startLine: startPos.line,
        startCharacter: startPos.character,
        endLine: endPos.line,
        endCharacter: endPos.character,
      });
    }
  }

  // Custom user-defined client/project aliases (e.g. "Project Phoenix" -> [[ALIAS_1]])
  const parsedAliases = parseCustomAliases(customAliases);
  for (let idx = 0; idx < parsedAliases.length; idx += 1) {
    const alias = parsedAliases[idx];
    const escaped = escapeRegExp(alias.term);
    const leftBound = isAsciiWordChar(alias.term[0]) ? "(?<![A-Za-z0-9_])" : "";
    const rightBound = isAsciiWordChar(alias.term[alias.term.length - 1]) ? "(?![A-Za-z0-9_])" : "";
    const re = new RegExp(`${leftBound}${escaped}${rightBound}`, "gi");
    let match;
    while ((match = re.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (overlapsAnyRange(start, end, existingPlaceholders)) {
        continue;
      }
      const startPos = offsetToPosition(lineStarts, start);
      if (respectIgnoreComments) {
        const lineStr = getLineText(text, lineStarts, startPos.line);
        if (hasIgnoreDirective(lineStr)) {
          continue;
        }
      }
      const endPos = offsetToPosition(lineStarts, end);
      candidates.push({
        ruleId: "CUSTOM_ALIAS",
        tag: alias.label || "ALIAS",
        customLabel: alias.label,
        kind: "alias",
        severity: "medium",
        priority: 18,
        description: `Custom confidential alias (${alias.term})`,
        value: match[0],
        maskedPreview: maskSecretPreview(match[0]),
        start,
        end,
        startLine: startPos.line,
        startCharacter: startPos.character,
        endLine: endPos.line,
        endCharacter: endPos.character,
      });
    }
  }

  // Deterministic overlap resolution: earlier start -> higher priority -> longer span
  candidates.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.end - b.start - (a.end - a.start);
  });

  const accepted = [];
  let lastEnd = -1;
  for (const item of candidates) {
    if (item.start >= lastEnd) {
      accepted.push(item);
      lastEnd = item.end;
    }
  }

  return accepted;
}

/**
 * In-memory session-only reversible redaction vault.
 * Never writes sensitive values to disk.
 */
class RedactionVault {
  constructor() {
    this.valueToPlaceholder = new Map();
    this.placeholderToValue = new Map();
    this.counters = new Map();
  }

  /**
   * Assign or reuse a deterministic reversible placeholder for a finding.
   *
   * @param {"pii" | "secret" | "alias"} kind
   * @param {string} tag
   * @param {string} originalValue
   * @param {string | null} [customLabel]
   * @returns {string}
   */
  getOrCreatePlaceholder(kind, tag, originalValue, customLabel = null) {
    if (this.valueToPlaceholder.has(originalValue)) {
      return this.valueToPlaceholder.get(originalValue);
    }

    let counterKey;
    let placeholder;
    if (kind === "alias") {
      counterKey = customLabel ? `ALIAS_${customLabel}` : "ALIAS";
      const nextNum = (this.counters.get(counterKey) || 0) + 1;
      this.counters.set(counterKey, nextNum);
      placeholder = customLabel ? `[[ALIAS_${customLabel}_${nextNum}]]` : `[[ALIAS_${nextNum}]]`;
    } else if (kind === "pii") {
      counterKey = `PII_${tag}`;
      const nextNum = (this.counters.get(counterKey) || 0) + 1;
      this.counters.set(counterKey, nextNum);
      placeholder = `[[PII_${tag}_${nextNum}]]`;
    } else {
      counterKey = `SECRET_${tag}`;
      const nextNum = (this.counters.get(counterKey) || 0) + 1;
      this.counters.set(counterKey, nextNum);
      placeholder = `[[SECRET_${tag}_${nextNum}]]`;
    }

    this.valueToPlaceholder.set(originalValue, placeholder);
    this.placeholderToValue.set(placeholder, originalValue);
    return placeholder;
  }

  /**
   * Redact secrets, PII, and custom aliases in text using deterministic reversible placeholders.
   *
   * @param {string} text
   * @param {{
   *   includeSecrets?: boolean,
   *   includePii?: boolean,
   *   customAliases?: string | Array<string | { term: string, label?: string }>,
   *   respectIgnoreComments?: boolean
   * }} [options]
   */
  redact(text, options = {}) {
    if (typeof text !== "string" || text.length === 0) {
      return {
        redactedText: text || "",
        findings: [],
        redactedCount: 0,
        uniqueCount: 0,
        byCategory: {},
      };
    }

    const findings = scanText(text, {
      includeSecrets: options.includeSecrets !== undefined ? options.includeSecrets : true,
      includePii: options.includePii !== undefined ? options.includePii : true,
      customAliases: options.customAliases || [],
      respectIgnoreComments:
        options.respectIgnoreComments !== undefined ? options.respectIgnoreComments : true,
    });

    if (findings.length === 0) {
      return {
        redactedText: text,
        findings: [],
        redactedCount: 0,
        uniqueCount: 0,
        byCategory: {},
      };
    }

    let cursor = 0;
    const chunks = [];
    const byCategory = {};
    const uniquePlaceholders = new Set();
    const enrichedFindings = [];

    for (const f of findings) {
      chunks.push(text.slice(cursor, f.start));
      const placeholder = this.getOrCreatePlaceholder(f.kind, f.tag, f.value, f.customLabel || null);
      chunks.push(placeholder);
      cursor = f.end;

      uniquePlaceholders.add(placeholder);
      byCategory[f.ruleId] = (byCategory[f.ruleId] || 0) + 1;
      enrichedFindings.push({ ...f, placeholder });
    }
    chunks.push(text.slice(cursor));

    return {
      redactedText: chunks.join(""),
      findings: enrichedFindings,
      redactedCount: findings.length,
      uniqueCount: uniquePlaceholders.size,
      byCategory,
    };
  }

  /**
   * Restore any known [[PII_*]], [[SECRET_*]], or [[ALIAS_*]] placeholders back to original values.
   * Uses a callback replacer so `$&`, `$1`, `$$`, `$'` inside original secrets are NEVER mangled.
   *
   * @param {string} text
   */
  restore(text) {
    if (typeof text !== "string" || text.length === 0) {
      return {
        restoredText: text || "",
        replacedCount: 0,
        unknownPlaceholders: [],
      };
    }

    let replacedCount = 0;
    const unknownSet = new Set();

    const restoredText = text.replace(PLACEHOLDER_RE, (token) => {
      if (this.placeholderToValue.has(token)) {
        replacedCount += 1;
        return this.placeholderToValue.get(token);
      }
      unknownSet.add(token);
      return token;
    });

    return {
      restoredText,
      replacedCount,
      unknownPlaceholders: Array.from(unknownSet),
    };
  }

  entries() {
    return Array.from(this.placeholderToValue.entries()).map(([placeholder, original]) => ({
      placeholder,
      maskedPreview: maskSecretPreview(original),
    }));
  }

  size() {
    return this.placeholderToValue.size;
  }

  clear() {
    this.valueToPlaceholder.clear();
    this.placeholderToValue.clear();
    this.counters.clear();
  }
}

module.exports = {
  RULES,
  PLACEHOLDER_RE,
  normalize1To1,
  isValidMyNumber,
  isSensitiveIpv4,
  hasIgnoreDirective,
  isLikelyPlaceholderOrEnvRef,
  parseCustomAliases,
  maskSecretPreview,
  scanText,
  RedactionVault,
};
