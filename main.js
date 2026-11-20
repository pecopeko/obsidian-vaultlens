/*
 * VaultLens AI Context & PII Shield (vaultlens-ai-context) v1.0.0
 * Generated deterministically by scripts/build_bundle.mjs — zero external runtime dependencies.
 * Desktop & Mobile compatible (isDesktopOnly: false, Web Crypto ES256 offline license verification).
 */
"use strict";

var __vaultlensHostRequire = require;

var __vaultlensModules = {
  "src/core/tokenizer.js": function(module, exports, require) {
    "use strict";

    /**
     * Multi-script BPE-calibrated LLM token & API cost estimator for Obsidian VaultLens.
     * Pure JavaScript, zero Node.js built-ins (100% compatible with Desktop, iOS, and Android).
     */

    const FRONTIER_MODELS = Object.freeze([
      Object.freeze({
        id: "gpt-5",
        name: "GPT-5",
        provider: "OpenAI",
        inputPerMillionUsd: 1.25,
        outputPerMillionUsd: 10.0,
        contextWindow: 400000,
        tier: "flagship",
      }),
      Object.freeze({
        id: "claude-sonnet-4",
        name: "Claude Sonnet 4",
        provider: "Anthropic",
        inputPerMillionUsd: 3.0,
        outputPerMillionUsd: 15.0,
        contextWindow: 200000,
        tier: "flagship",
      }),
      Object.freeze({
        id: "gemini-2.5-pro",
        name: "Gemini 2.5 Pro",
        provider: "Google",
        inputPerMillionUsd: 1.25,
        outputPerMillionUsd: 10.0,
        contextWindow: 1000000,
        tier: "flagship",
      }),
      Object.freeze({
        id: "gpt-4o-mini",
        name: "GPT-4o mini",
        provider: "OpenAI",
        inputPerMillionUsd: 0.15,
        outputPerMillionUsd: 0.6,
        contextWindow: 128000,
        tier: "fast",
      }),
      Object.freeze({
        id: "claude-haiku-4.5",
        name: "Claude Haiku 4.5",
        provider: "Anthropic",
        inputPerMillionUsd: 0.8,
        outputPerMillionUsd: 4.0,
        contextWindow: 200000,
        tier: "fast",
      }),
      Object.freeze({
        id: "gemini-2.5-flash",
        name: "Gemini 2.5 Flash",
        provider: "Google",
        inputPerMillionUsd: 0.15,
        outputPerMillionUsd: 0.6,
        contextWindow: 1000000,
        tier: "fast",
      }),
    ]);

    const MODEL_MAP = new Map(FRONTIER_MODELS.map((m) => [m.id, m]));

    function isAsciiLetter(cp) {
      return (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122);
    }

    function isAsciiDigit(cp) {
      return cp >= 48 && cp <= 57;
    }

    function isHiraganaOrKatakana(cp) {
      return (
        (cp >= 0x3040 && cp <= 0x309f) ||
        (cp >= 0x30a0 && cp <= 0x30ff) ||
        (cp >= 0xff65 && cp <= 0xff9f)
      );
    }

    function isCjkIdeograph(cp) {
      return (
        (cp >= 0x4e00 && cp <= 0x9fff) ||
        (cp >= 0x3400 && cp <= 0x4dbf) ||
        (cp >= 0xf900 && cp <= 0xfaff) ||
        (cp >= 0x3000 && cp <= 0x303f)
      );
    }

    function isHangul(cp) {
      return (
        (cp >= 0xac00 && cp <= 0xd7af) ||
        (cp >= 0x1100 && cp <= 0x11ff) ||
        (cp >= 0x3130 && cp <= 0x318f)
      );
    }

    function isFullWidthAsciiOrPunct(cp) {
      return cp >= 0xff01 && cp <= 0xff60;
    }

    /**
     * Pure-JS exact UTF-8 byte length calculation (no Node Buffer dependency).
     *
     * @param {string} text
     * @returns {number}
     */
    function utf8ByteLength(text) {
      if (typeof text !== "string" || text.length === 0) {
        return 0;
      }
      let bytes = 0;
      const len = text.length;
      for (let i = 0; i < len; i += 1) {
        const cp = text.codePointAt(i);
        if (cp <= 0x7f) {
          bytes += 1;
        } else if (cp <= 0x7ff) {
          bytes += 2;
        } else if (cp <= 0xffff) {
          bytes += 3;
        } else {
          bytes += 4;
          i += 1;
        }
      }
      return bytes;
    }

    function estimateWordTokens(word) {
      if (!word) {
        return 0;
      }
      const subParts = word
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/_+/g, " _ ")
        .split(" ")
        .filter(Boolean);

      let total = 0;
      for (let i = 0; i < subParts.length; i += 1) {
        const part = subParts[i];
        if (part === "_") {
          total += 0.35;
        } else if (part.length <= 4) {
          total += 1.0;
        } else if (part.length <= 8) {
          total += 1.25;
        } else {
          total += Math.ceil(part.length / 4.2);
        }
      }
      return total;
    }

    /**
     * Estimate LLM token count and script composition for Markdown notes and code.
     * Calibrated against modern BPE tokenizers (o200k_base / Claude / Gemini) across
     * English prose, Markdown syntax, source code, Japanese (Kana + Kanji), CJK, Hangul, and Emoji.
     *
     * @param {string} text
     */
    function estimateTokens(text) {
      if (typeof text !== "string" || text.length === 0) {
        return {
          tokens: 0,
          characters: 0,
          words: 0,
          lines: 0,
          bytes: 0,
          dominantScript: "empty",
          breakdown: {
            asciiWords: 0,
            digits: 0,
            kanaChars: 0,
            cjkChars: 0,
            hangulChars: 0,
            otherUnicode: 0,
            symbols: 0,
            whitespaceRuns: 0,
            emoji: 0,
          },
        };
      }

      let tokenFloat = 0;
      let lines = 1;
      const breakdown = {
        asciiWords: 0,
        digits: 0,
        kanaChars: 0,
        cjkChars: 0,
        hangulChars: 0,
        otherUnicode: 0,
        symbols: 0,
        whitespaceRuns: 0,
        emoji: 0,
      };

      const len = text.length;
      let i = 0;

      while (i < len) {
        const cp = text.codePointAt(i);
        const charStep = cp > 0xffff ? 2 : 1;

        if (isAsciiLetter(cp)) {
          const start = i;
          i += 1;
          while (i < len) {
            const nextCp = text.charCodeAt(i);
            if (isAsciiLetter(nextCp) || nextCp === 95 || nextCp === 39) {
              i += 1;
            } else {
              break;
            }
          }
          const word = text.slice(start, i);
          breakdown.asciiWords += 1;
          tokenFloat += estimateWordTokens(word);
          continue;
        }

        if (isAsciiDigit(cp)) {
          const start = i;
          i += 1;
          while (i < len && isAsciiDigit(text.charCodeAt(i))) {
            i += 1;
          }
          const digitCount = i - start;
          breakdown.digits += digitCount;
          tokenFloat += Math.ceil(digitCount / 3);
          continue;
        }

        if (cp === 10) {
          lines += 1;
          breakdown.whitespaceRuns += 1;
          tokenFloat += 0.65;
          i += 1;
          continue;
        }
        if (cp === 13) {
          i += 1;
          continue;
        }

        if (cp === 32 || cp === 9) {
          const start = i;
          while (i < len && (text.charCodeAt(i) === 32 || text.charCodeAt(i) === 9)) {
            i += 1;
          }
          const runLen = i - start;
          breakdown.whitespaceRuns += 1;
          if (runLen === 1) {
            tokenFloat += 0.08;
          } else {
            tokenFloat += Math.ceil(runLen / 4) * 0.85;
          }
          continue;
        }

        if (cp >= 33 && cp <= 126) {
          const start = i;
          i += 1;
          if (i < len) {
            const nextCp = text.charCodeAt(i);
            const pair = text.slice(start, start + 2);
            if (
              pair === "[[" ||
              pair === "]]" ||
              pair === "##" ||
              pair === "**" ||
              pair === "```".slice(0, 2) ||
              pair === "%%" ||
              pair === '":' ||
              pair === '",' ||
              pair === '"}' ||
              pair === '"]' ||
              pair === "=>" ||
              pair === "==" ||
              pair === "!=" ||
              pair === "<=" ||
              pair === ">=" ||
              pair === "&&" ||
              pair === "||" ||
              pair === "//" ||
              pair === "/*" ||
              pair === "*/" ||
              pair === "::" ||
              pair === "->" ||
              pair === "[]" ||
              pair === "{}" ||
              (nextCp === cp && (cp === 45 || cp === 61))
            ) {
              i += 1;
              breakdown.symbols += 2;
              tokenFloat += 0.9;
              continue;
            }
          }
          breakdown.symbols += 1;
          tokenFloat += 0.65;
          continue;
        }

        if (isHiraganaOrKatakana(cp)) {
          breakdown.kanaChars += 1;
          tokenFloat += 1.15;
          i += charStep;
          continue;
        }

        if (isCjkIdeograph(cp)) {
          breakdown.cjkChars += 1;
          tokenFloat += 1.45;
          i += charStep;
          continue;
        }

        if (isHangul(cp)) {
          breakdown.hangulChars += 1;
          tokenFloat += 1.25;
          i += charStep;
          continue;
        }

        if (isFullWidthAsciiOrPunct(cp)) {
          breakdown.otherUnicode += 1;
          tokenFloat += 1.2;
          i += charStep;
          continue;
        }

        if (cp > 0xffff) {
          breakdown.emoji += 1;
          tokenFloat += 2.3;
          i += charStep;
          continue;
        }

        breakdown.otherUnicode += 1;
        tokenFloat += 0.95;
        i += charStep;
      }

      const tokens = Math.max(1, Math.round(tokenFloat));
      const bytes = utf8ByteLength(text);
      const cjkTotal = breakdown.kanaChars + breakdown.cjkChars + breakdown.hangulChars;
      const words = breakdown.asciiWords + Math.round(cjkTotal / 2);

      let dominantScript = "en-markdown";
      const jpTotal = breakdown.kanaChars + breakdown.cjkChars;
      if (breakdown.kanaChars > 0 && jpTotal >= Math.max(4, breakdown.asciiWords * 0.5)) {
        dominantScript = "ja-mixed";
      } else if (breakdown.cjkChars > 0 && breakdown.cjkChars >= Math.max(4, breakdown.asciiWords * 0.5)) {
        dominantScript = "cjk-mixed";
      } else if (breakdown.hangulChars > 0 && breakdown.hangulChars >= Math.max(4, breakdown.asciiWords * 0.5)) {
        dominantScript = "ko-mixed";
      }

      return {
        tokens,
        characters: text.length,
        words,
        lines,
        bytes,
        dominantScript,
        breakdown,
      };
    }

    function getModel(modelId) {
      return MODEL_MAP.get(modelId) || MODEL_MAP.get("claude-sonnet-4");
    }

    function calculateModelCost(tokens, modelId) {
      const model = getModel(modelId);
      const safeTokens = Math.max(0, Number(tokens) || 0);
      const inputCostUsd = (safeTokens / 1_000_000) * model.inputPerMillionUsd;
      const outputCostUsd = (safeTokens / 1_000_000) * model.outputPerMillionUsd;
      const contextPercent = (safeTokens / model.contextWindow) * 100;
      const chunksNeeded = safeTokens === 0 ? 0 : Math.ceil(safeTokens / model.contextWindow);
      return {
        modelId: model.id,
        modelName: model.name,
        provider: model.provider,
        tier: model.tier,
        tokens: safeTokens,
        inputPerMillionUsd: model.inputPerMillionUsd,
        outputPerMillionUsd: model.outputPerMillionUsd,
        inputCostUsd,
        outputCostUsd,
        contextWindow: model.contextWindow,
        contextPercent,
        fitsContext: safeTokens <= model.contextWindow,
        chunksNeeded,
      };
    }

    function calculateAllModelCosts(tokens) {
      return FRONTIER_MODELS.map((m) => calculateModelCost(tokens, m.id));
    }

    function formatUsd(usd) {
      const val = Number(usd) || 0;
      if (val === 0) {
        return "$0.0000";
      }
      if (val < 0.0001) {
        return "<$0.0001";
      }
      if (val < 0.01) {
        return `$${val.toFixed(4)}`;
      }
      if (val < 1) {
        return `$${val.toFixed(3)}`;
      }
      return `$${val.toFixed(2)}`;
    }

    function formatTokenCount(count) {
      const num = Math.max(0, Math.round(Number(count) || 0));
      return num.toLocaleString("en-US");
    }

    /**
     * Format compact status bar string for Obsidian's bottom status bar.
     *
     * @param {{
     *   noteTokens: number,
     *   linkedTokens?: number,
     *   linkedNoteCount?: number,
     *   modelId?: string,
     *   findingCount?: number
     * }} params
     * @returns {string}
     */
    function formatStatusBarLabel({
      noteTokens = 0,
      linkedTokens = 0,
      linkedNoteCount = 0,
      modelId = "claude-sonnet-4",
      findingCount = 0,
    }) {
      const totalTokens = Math.max(0, Number(noteTokens) || 0) + Math.max(0, Number(linkedTokens) || 0);
      const cost = calculateModelCost(totalTokens, modelId);
      const noteStr = formatTokenCount(noteTokens);
      const linkedPart =
        linkedNoteCount > 0
          ? ` + ${formatTokenCount(linkedTokens)} (${linkedNoteCount} ${linkedNoteCount === 1 ? "link" : "links"})`
          : "";
      const alertPart = findingCount > 0 ? ` · ${findingCount} PII/sec` : "";
      return `VaultLens: ${noteStr}${linkedPart} tok · ${formatUsd(cost.inputCostUsd)} (${cost.modelName})${alertPart}`;
    }

    module.exports = {
      FRONTIER_MODELS,
      utf8ByteLength,
      estimateTokens,
      getModel,
      calculateModelCost,
      calculateAllModelCosts,
      formatUsd,
      formatTokenCount,
      formatStatusBarLabel,
    };
  },

  "src/core/redactor.js": function(module, exports, require) {
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
  },

  "src/core/graph.js": function(module, exports, require) {
    "use strict";

    /**
     * Obsidian Markdown parser, wikilink/embed graph traverser, and budget-aware AI context bundler.
     * Pure JavaScript, zero Node.js built-ins (100% Desktop + iOS + Android compatible).
     */

    const { estimateTokens } = require("./tokenizer");

    const ATTACHMENT_EXTENSIONS = new Set([
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "svg",
      "bmp",
      "ico",
      "avif",
      "pdf",
      "mp3",
      "wav",
      "m4a",
      "ogg",
      "flac",
      "mp4",
      "mov",
      "webm",
      "mkv",
      "csv",
      "xlsx",
      "docx",
      "pptx",
      "zip",
      "tar",
      "gz",
      "canvas",
      "excalidraw",
    ]);

    /**
     * Extract leading YAML frontmatter block (only when starting at byte 0).
     * Lightweight zero-dependency parser for common string, number, boolean, and list keys.
     *
     * @param {string} markdown
     * @returns {{ hasFrontmatter: boolean, frontmatterRaw: string, frontmatter: Record<string, any>, body: string }}
     */
    function extractFrontmatter(markdown) {
      if (typeof markdown !== "string" || markdown.length === 0) {
        return { hasFrontmatter: false, frontmatterRaw: "", frontmatter: {}, body: "" };
      }
      const match = markdown.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
      if (!match) {
        return { hasFrontmatter: false, frontmatterRaw: "", frontmatter: {}, body: markdown };
      }

      const rawYaml = match[1];
      const body = markdown.slice(match[0].length);
      const frontmatter = {};
      const lines = rawYaml.split(/\r?\n/);
      let currentListKey = null;

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line.trim() || line.trim().startsWith("#")) {
          continue;
        }

        const listItemMatch = line.match(/^[ \t]+-[ \t]+(.+)$/);
        if (listItemMatch && currentListKey) {
          if (!Array.isArray(frontmatter[currentListKey])) {
            frontmatter[currentListKey] = [];
          }
          frontmatter[currentListKey].push(unquoteYamlScalar(listItemMatch[1].trim()));
          continue;
        }

        const kvMatch = line.match(/^([A-Za-z0-9_.-]+)[ \t]*:[ \t]*(.*)$/);
        if (kvMatch) {
          const key = kvMatch[1];
          const valRaw = kvMatch[2].trim();
          if (valRaw === "") {
            currentListKey = key;
            frontmatter[key] = [];
          } else if (valRaw.startsWith("[") && valRaw.endsWith("]")) {
            currentListKey = null;
            const inner = valRaw.slice(1, -1).trim();
            frontmatter[key] = inner
              ? inner.split(",").map((s) => unquoteYamlScalar(s.trim())).filter(Boolean)
              : [];
          } else {
            currentListKey = null;
            frontmatter[key] = parseYamlScalar(valRaw);
          }
        } else {
          currentListKey = null;
        }
      }

      return {
        hasFrontmatter: true,
        frontmatterRaw: match[0],
        frontmatter,
        body,
      };
    }

    function unquoteYamlScalar(val) {
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        return val.slice(1, -1);
      }
      return val;
    }

    function parseYamlScalar(val) {
      const unquoted = unquoteYamlScalar(val);
      if (unquoted !== val) {
        return unquoted;
      }
      if (val === "true") return true;
      if (val === "false") return false;
      if (val === "null" || val === "~") return null;
      if (/^-?\d+(?:\.\d+)?$/.test(val)) return Number(val);
      return val;
    }

    function stripFrontmatter(markdown) {
      return extractFrontmatter(markdown).body;
    }

    /**
     * Compute code-block and inline-code character ranges so parsers ignore links/comments inside code.
     *
     * @param {string} markdown
     * @returns {Array<[number, number]>}
     */
    function findCodeRanges(markdown) {
      const ranges = [];
      const len = markdown.length;
      let i = 0;

      while (i < len) {
        const atLineStart = i === 0 || markdown.charCodeAt(i - 1) === 10;

        // Fenced code block (``` or ~~~)
        if (atLineStart) {
          let ws = i;
          while (ws < len && (markdown[ws] === " " || markdown[ws] === "\t")) {
            ws += 1;
          }
          const ch = markdown[ws];
          if (ch === "`" || ch === "~") {
            let fenceLen = 0;
            while (ws + fenceLen < len && markdown[ws + fenceLen] === ch) {
              fenceLen += 1;
            }
            if (fenceLen >= 3) {
              const start = i;
              // Advance past opening fence line
              let pos = markdown.indexOf("\n", ws + fenceLen);
              if (pos === -1) {
                ranges.push([start, len]);
                break;
              }
              pos += 1;
              let closed = false;
              while (pos < len) {
                const lineEnd = markdown.indexOf("\n", pos);
                const rawEnd = lineEnd === -1 ? len : lineEnd;
                const lineText = markdown.slice(pos, rawEnd).trim();
                if (lineText.length >= fenceLen && lineText.startsWith(ch.repeat(fenceLen)) && new RegExp(`^${ch}+$`).test(lineText)) {
                  const end = lineEnd === -1 ? len : lineEnd + 1;
                  ranges.push([start, end]);
                  i = end;
                  closed = true;
                  break;
                }
                pos = lineEnd === -1 ? len : lineEnd + 1;
              }
              if (!closed) {
                ranges.push([start, len]);
                break;
              }
              continue;
            }
          }
        }

        // Inline code span (`...` or ``...``)
        if (markdown[i] === "`") {
          let tickCount = 0;
          while (i + tickCount < len && markdown[i + tickCount] === "`") {
            tickCount += 1;
          }
          const delimiter = "`".repeat(tickCount);
          const closeIdx = markdown.indexOf(delimiter, i + tickCount);
          if (closeIdx !== -1) {
            ranges.push([i, closeIdx + tickCount]);
            i = closeIdx + tickCount;
            continue;
          }
          i += tickCount;
          continue;
        }

        i += 1;
      }

      return ranges;
    }

    function indexInRanges(idx, ranges) {
      for (let i = 0; i < ranges.length; i += 1) {
        if (idx >= ranges[i][0] && idx < ranges[i][1]) {
          return true;
        }
      }
      return false;
    }

    /**
     * Strip Obsidian %%inline%% and multiline %% ... %% comments while preserving code blocks.
     *
     * @param {string} markdown
     * @returns {string}
     */
    function stripObsidianComments(markdown) {
      if (typeof markdown !== "string" || !markdown.includes("%%")) {
        return markdown || "";
      }
      const codeRanges = findCodeRanges(markdown);
      const out = [];
      let cursor = 0;
      let pos = 0;
      const len = markdown.length;

      while (pos < len) {
        const openIdx = markdown.indexOf("%%", pos);
        if (openIdx === -1) {
          break;
        }
        if (indexInRanges(openIdx, codeRanges)) {
          pos = openIdx + 2;
          continue;
        }
        // Find matching closing %% outside code ranges
        let searchFrom = openIdx + 2;
        let closeIdx = -1;
        while (searchFrom < len) {
          const candidate = markdown.indexOf("%%", searchFrom);
          if (candidate === -1) {
            break;
          }
          if (!indexInRanges(candidate, codeRanges)) {
            closeIdx = candidate;
            break;
          }
          searchFrom = candidate + 2;
        }

        if (closeIdx === -1) {
          // Unclosed %%: treat remaining text safely as literal to avoid eating entire note
          break;
        }

        out.push(markdown.slice(cursor, openIdx));
        cursor = closeIdx + 2;
        pos = cursor;
      }

      out.push(markdown.slice(cursor));
      return out.join("").replace(/\n{3,}/g, "\n\n");
    }

    /**
     * Clean a note's Markdown text according to frontmatter and comment stripping options.
     *
     * @param {string} markdown
     * @param {{ stripFrontmatter?: boolean, stripComments?: boolean }} [options]
     * @returns {string}
     */
    function cleanNoteContent(markdown, options = {}) {
      const { stripFrontmatter: doStripFm = true, stripComments: doStripComments = true } = options;
      let text = typeof markdown === "string" ? markdown : "";
      if (doStripFm) {
        text = stripFrontmatter(text);
      }
      if (doStripComments) {
        text = stripObsidianComments(text);
      }
      return text.trim();
    }

    function getFileExtension(target) {
      const clean = String(target || "").split(/[?#]/)[0];
      const lastSlash = clean.lastIndexOf("/");
      const base = lastSlash >= 0 ? clean.slice(lastSlash + 1) : clean;
      const dot = base.lastIndexOf(".");
      if (dot <= 0) {
        return "";
      }
      return base.slice(dot + 1).toLowerCase();
    }

    /**
     * Extract all Obsidian [[wikilinks]], ![[embeds]], and optional relative Markdown note links.
     * Skips links inside code blocks, inline code, and Obsidian %%comments%%.
     *
     * @param {string} markdown
     * @returns {Array<{
     *   raw: string,
     *   target: string,
     *   subpath: string,
     *   alias: string | null,
     *   isEmbed: boolean,
     *   isAttachment: boolean,
     *   isSameNote: boolean
     * }>}
     */
    function extractWikiLinks(markdown) {
      if (typeof markdown !== "string" || markdown.length === 0) {
        return [];
      }
      const withoutComments = stripObsidianComments(markdown);
      const codeRanges = findCodeRanges(withoutComments);
      const links = [];

      // 1. Obsidian [[wikilinks]] and ![[embeds]]
      // Note: skip VaultLens redaction placeholders like [[PII_EMAIL_1]], [[SECRET_AWS_1]], [[ALIAS_1]]
      const wikiRe = /(!)?\[\[([^\]\r\n]+)\]\]/g;
      let match;
      while ((match = wikiRe.exec(withoutComments)) !== null) {
        if (indexInRanges(match.index, codeRanges)) {
          continue;
        }
        const isEmbed = Boolean(match[1]);
        const inner = match[2].trim();
        if (!inner) {
          continue;
        }
        if (/^(?:(?:PII|SECRET)_[A-Z0-9_]+_\d+|ALIAS_(?:[A-Z0-9_]+_)?\d+)$/.test(inner)) {
          continue;
        }

        // Split optional |Display Alias (note: handle escaped \| cleanly)
        let targetAndSub = inner;
        let alias = null;
        const pipeIdx = inner.indexOf("|");
        if (pipeIdx !== -1) {
          targetAndSub = inner.slice(0, pipeIdx).trim();
          alias = inner.slice(pipeIdx + 1).trim() || null;
        }

        // Split optional #Heading or #^blockid
        let target = targetAndSub;
        let subpath = "";
        const hashIdx = targetAndSub.indexOf("#");
        if (hashIdx !== -1) {
          target = targetAndSub.slice(0, hashIdx).trim();
          subpath = targetAndSub.slice(hashIdx).trim();
        }

        const isSameNote = target.length === 0 && subpath.length > 0;
        const ext = getFileExtension(target);
        const isAttachment = ext.length > 0 && ext !== "md" && ATTACHMENT_EXTENSIONS.has(ext);

        links.push({
          raw: match[0],
          target,
          subpath,
          alias,
          isEmbed,
          isAttachment,
          isSameNote,
        });
      }

      return links;
    }

    function normalizeVaultPath(p) {
      return String(p || "")
        .replace(/\\/g, "/")
        .replace(/^\/+/, "")
        .replace(/\/+/g, "/");
    }

    function stripMdExtension(p) {
      return p.toLowerCase().endsWith(".md") ? p.slice(0, -3) : p;
    }

    function getDirname(p) {
      const norm = normalizeVaultPath(p);
      const idx = norm.lastIndexOf("/");
      return idx >= 0 ? norm.slice(0, idx) : "";
    }

    function getBasenameWithoutExt(p) {
      const norm = normalizeVaultPath(p);
      const idx = norm.lastIndexOf("/");
      const file = idx >= 0 ? norm.slice(idx + 1) : norm;
      return stripMdExtension(file);
    }

    /**
     * Resolve an Obsidian wikilink target against a vault's Markdown note paths.
     * Mirrors Obsidian's shortest-path & case-insensitive resolution semantics.
     *
     * @param {string} linkTarget
     * @param {string[]} allNotePaths
     * @param {string} [sourcePath]
     * @returns {string | null}
     */
    function resolveLinkTarget(linkTarget, allNotePaths, sourcePath = "") {
      if (!linkTarget || typeof linkTarget !== "string") {
        return null;
      }
      const cleanTarget = normalizeVaultPath(linkTarget.trim()).replace(/^\.\//, "");
      if (!cleanTarget) {
        return null;
      }
      const targetNoExt = stripMdExtension(cleanTarget);
      const targetLower = targetNoExt.toLowerCase();
      const sourceDir = getDirname(sourcePath);

      const hasSlash = cleanTarget.includes("/");

      // 1. If target contains a folder separator, match exact vault-root path first
      if (hasSlash) {
        let caseInsensitivePathMatch = null;
        for (let i = 0; i < allNotePaths.length; i += 1) {
          const p = allNotePaths[i];
          const pNoExt = stripMdExtension(normalizeVaultPath(p));
          if (pNoExt === targetNoExt) {
            return p;
          }
          if (!caseInsensitivePathMatch && pNoExt.toLowerCase() === targetLower) {
            caseInsensitivePathMatch = p;
          }
        }
        if (caseInsensitivePathMatch) {
          return caseInsensitivePathMatch;
        }
      }

      // 2. Check relative to source note's directory (same-folder preference)
      if (sourceDir) {
        const relExact = `${sourceDir}/${targetNoExt}`;
        const relLower = relExact.toLowerCase();
        let relCiMatch = null;
        for (let i = 0; i < allNotePaths.length; i += 1) {
          const p = allNotePaths[i];
          const pNoExt = stripMdExtension(normalizeVaultPath(p));
          if (pNoExt === relExact) {
            return p;
          }
          if (!relCiMatch && pNoExt.toLowerCase() === relLower) {
            relCiMatch = p;
          }
        }
        if (relCiMatch) {
          return relCiMatch;
        }
      }

      // 3. Vault-root exact match for bare link names
      if (!hasSlash) {
        let rootCiMatch = null;
        for (let i = 0; i < allNotePaths.length; i += 1) {
          const p = allNotePaths[i];
          const pNoExt = stripMdExtension(normalizeVaultPath(p));
          if (pNoExt === targetNoExt) {
            return p;
          }
          if (!rootCiMatch && pNoExt.toLowerCase() === targetLower) {
            rootCiMatch = p;
          }
        }
        if (rootCiMatch) {
          return rootCiMatch;
        }
      }

      // 4. Shortest basename match (standard Obsidian wikilink resolution)
      if (!hasSlash) {
        const matches = [];
        for (let i = 0; i < allNotePaths.length; i += 1) {
          const p = allNotePaths[i];
          if (getBasenameWithoutExt(p).toLowerCase() === targetLower) {
            matches.push(p);
          }
        }
        if (matches.length === 1) {
          return matches[0];
        }
        if (matches.length > 1) {
          matches.sort((a, b) => {
            const aSame = getDirname(a) === sourceDir ? 0 : 1;
            const bSame = getDirname(b) === sourceDir ? 0 : 1;
            if (aSame !== bSame) return aSame - bSame;
            if (a.length !== b.length) return a.length - b.length;
            return a.localeCompare(b);
          });
          return matches[0];
        }
      }

      return null;
    }

    /**
     * Extract a specific heading section from Markdown when embedding ![[Note#Heading]].
     *
     * @param {string} markdown
     * @param {string} subpath
     * @returns {string}
     */
    function extractHeadingSection(markdown, subpath) {
      if (!subpath || !subpath.startsWith("#") || subpath.startsWith("#^")) {
        return markdown;
      }
      const headingTarget = subpath.slice(1).trim().toLowerCase();
      if (!headingTarget) {
        return markdown;
      }

      const lines = markdown.split(/\r?\n/);
      let startIdx = -1;
      let targetLevel = 0;

      for (let i = 0; i < lines.length; i += 1) {
        const m = lines[i].match(/^(#{1,6})\s+(.+?)\s*#*$/);
        if (m) {
          const level = m[1].length;
          const title = m[2].trim().toLowerCase();
          if (startIdx === -1) {
            if (title === headingTarget) {
              startIdx = i;
              targetLevel = level;
            }
          } else if (level <= targetLevel) {
            return lines.slice(startIdx, i).join("\n").trim();
          }
        }
      }

      if (startIdx !== -1) {
        return lines.slice(startIdx).join("\n").trim();
      }
      return markdown;
    }

    /**
     * Truncate text cleanly at a line boundary to fit within a target token budget.
     *
     * @param {string} text
     * @param {number} maxTokens
     * @returns {{ text: string, tokens: number, truncated: boolean }}
     */
    function truncateToTokenBudget(text, maxTokens) {
      const initial = estimateTokens(text);
      if (maxTokens <= 0 || initial.tokens <= maxTokens) {
        return { text, tokens: initial.tokens, truncated: false };
      }

      const lines = text.split("\n");
      const marker = `\n\n[... truncated by VaultLens to stay within ${maxTokens.toLocaleString("en-US")} token budget ...]`;
      const markerTokens = estimateTokens(marker).tokens;
      const available = Math.max(16, maxTokens - markerTokens);

      // Binary search line prefix that fits inside `available` tokens
      let lo = 0;
      let hi = lines.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const slice = lines.slice(0, mid).join("\n");
        if (estimateTokens(slice).tokens <= available) {
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }

      if (lo > 0) {
        const kept = `${lines.slice(0, lo).join("\n")}${marker}`;
        return { text: kept, tokens: estimateTokens(kept).tokens, truncated: true };
      }

      // Single ultra-long line fallback: binary search character slice
      let cLo = 0;
      let cHi = text.length;
      while (cLo < cHi) {
        const cMid = Math.ceil((cLo + cHi) / 2);
        if (estimateTokens(text.slice(0, cMid)).tokens <= available) {
          cLo = cMid;
        } else {
          cHi = cMid - 1;
        }
      }
      const kept = `${text.slice(0, Math.max(1, cLo))}${marker}`;
      return { text: kept, tokens: estimateTokens(kept).tokens, truncated: true };
    }

    function escapeXmlAttr(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function formatBundleDocument({ rootPath, includedNotes, omittedNotes, format, totalTokens, redactedCount }) {
      if (format === "markdown") {
        const sections = [];
        sections.push(`# VaultLens AI Context Bundle`);
        sections.push(
          `> Root: \`${rootPath}\` | Notes: ${includedNotes.length} | Tokens: ~${totalTokens.toLocaleString("en-US")}${redactedCount > 0 ? ` | Redacted items: ${redactedCount}` : ""}`
        );
        sections.push("");
        for (const note of includedNotes) {
          const hopLabel = note.hop === 0 ? "root" : `hop-${note.hop}`;
          const truncTag = note.truncated ? " [truncated]" : "";
          sections.push(`## Note: ${note.path} (${hopLabel}, ~${note.tokens} tok${truncTag})`);
          sections.push("```markdown");
          sections.push(note.content);
          sections.push("```");
          sections.push("");
        }
        if (omittedNotes.length > 0) {
          sections.push("### Omitted linked notes (token budget reached)");
          for (const om of omittedNotes) {
            sections.push(`- ${om.path} (hop-${om.hop}, ~${om.tokens} tok)`);
          }
          sections.push("");
        }
        return sections.join("\n").trimEnd() + "\n";
      }

      // Default: XML context pack (preferred by Claude, GPT-5, and Gemini for structured multi-note prompts)
      const lines = [];
      lines.push(
        `<vaultlens_context root="${escapeXmlAttr(rootPath)}" notes="${includedNotes.length}" tokens="${totalTokens}" redacted="${redactedCount}">`
      );
      for (const note of includedNotes) {
        lines.push(
          `  <note path="${escapeXmlAttr(note.path)}" hop="${note.hop}" tokens="${note.tokens}" truncated="${note.truncated}">`
        );
        lines.push(note.content);
        lines.push(`  </note>`);
      }
      if (omittedNotes.length > 0) {
        lines.push(`  <omitted_notes count="${omittedNotes.length}">`);
        for (const om of omittedNotes) {
          lines.push(
            `    <note path="${escapeXmlAttr(om.path)}" hop="${om.hop}" tokens="${om.tokens}" reason="${escapeXmlAttr(om.reason)}" />`
          );
        }
        lines.push(`  </omitted_notes>`);
      }
      lines.push(`</vaultlens_context>`);
      return lines.join("\n") + "\n";
    }

    /**
     * Build a safe, cycle-free, token-budgeted AI context bundle starting from rootPath.
     * Supports both sync in-memory maps (`notesMap`) and async vault readers via `buildContextBundleAsync`.
     *
     * @param {string} rootPath
     * @param {Map<string, string> | Record<string, string>} notesSource
     * @param {{
     *   depth?: number,
     *   includeEmbeds?: boolean,
     *   stripFrontmatter?: boolean,
     *   stripComments?: boolean,
     *   maxTokens?: number,
     *   format?: "xml" | "markdown",
     *   redactionVault?: import("./redactor").RedactionVault | null,
     *   redactSecrets?: boolean,
     *   redactPii?: boolean,
     *   customAliases?: string | Array<string | { term: string, label?: string }>
     * }} [options]
     */
    function buildContextBundle(rootPath, notesSource, options = {}) {
      const notesMap =
        notesSource instanceof Map ? notesSource : new Map(Object.entries(notesSource || {}));
      const allPaths = Array.from(notesMap.keys());

      const depth = Math.max(0, Math.min(2, Number(options.depth ?? 1)));
      const includeEmbeds = options.includeEmbeds !== undefined ? Boolean(options.includeEmbeds) : true;
      const doStripFm = options.stripFrontmatter !== undefined ? Boolean(options.stripFrontmatter) : true;
      const doStripComments = options.stripComments !== undefined ? Boolean(options.stripComments) : true;
      const maxTokens = Math.max(256, Number(options.maxTokens ?? 32000));
      const format = options.format === "markdown" ? "markdown" : "xml";
      const redactionVault = options.redactionVault || null;
      const redactSecrets = options.redactSecrets !== undefined ? Boolean(options.redactSecrets) : true;
      const redactPii = options.redactPii !== undefined ? Boolean(options.redactPii) : true;
      const customAliases = options.customAliases || [];

      const canonicalRoot = notesMap.has(rootPath)
        ? rootPath
        : resolveLinkTarget(rootPath, allPaths, "") || rootPath;

      if (!notesMap.has(canonicalRoot)) {
        throw new Error(`Root note not found: ${rootPath}`);
      }

      const visited = new Set([canonicalRoot]);
      const queue = [{ path: canonicalRoot, hop: 0, subpath: "" }];
      const includedNotes = [];
      const omittedNotes = [];
      const unresolvedLinks = [];
      let runningTokens = 0;
      let totalRedactions = 0;
      const redactionsByCategory = {};

      while (queue.length > 0) {
        const current = queue.shift();
        const rawContent = notesMap.get(current.path) || "";
        const links = extractWikiLinks(rawContent);

        // Enqueue outgoing links before budget checks so unresolved/omitted reporting is accurate
        if (current.hop < depth) {
          for (const link of links) {
            if (link.isSameNote || link.isAttachment) {
              continue;
            }
            if (link.isEmbed && !includeEmbeds) {
              continue;
            }
            const resolved = resolveLinkTarget(link.target, allPaths, current.path);
            if (!resolved) {
              unresolvedLinks.push({
                sourcePath: current.path,
                target: link.target,
                raw: link.raw,
              });
              continue;
            }
            if (!visited.has(resolved)) {
              visited.add(resolved);
              queue.push({
                path: resolved,
                hop: current.hop + 1,
                subpath: link.isEmbed ? link.subpath : "",
              });
            }
          }
        }

        let cleaned = cleanNoteContent(rawContent, {
          stripFrontmatter: doStripFm,
          stripComments: doStripComments,
        });
        if (current.subpath) {
          cleaned = extractHeadingSection(cleaned, current.subpath);
        }

        let displayPath = current.path;
        if (redactionVault) {
          const res = redactionVault.redact(cleaned, {
            includeSecrets: redactSecrets,
            includePii: redactPii,
            customAliases,
          });
          cleaned = res.redactedText;
          totalRedactions += res.redactedCount;
          for (const [cat, count] of Object.entries(res.byCategory)) {
            redactionsByCategory[cat] = (redactionsByCategory[cat] || 0) + count;
          }

          // Also redact custom aliases inside the note path attribute if present
          if (customAliases && String(customAliases).trim().length > 0) {
            const pathRes = redactionVault.redact(displayPath, {
              includeSecrets: false,
              includePii: false,
              customAliases,
            });
            displayPath = pathRes.redactedText;
            totalRedactions += pathRes.redactedCount;
            for (const [cat, count] of Object.entries(pathRes.byCategory)) {
              redactionsByCategory[cat] = (redactionsByCategory[cat] || 0) + count;
            }
          }
        }

        const originalTokens = estimateTokens(cleaned).tokens;
        const remainingBudget = maxTokens - runningTokens;

        if (current.hop === 0) {
          const fitted = truncateToTokenBudget(cleaned, maxTokens);
          includedNotes.push({
            path: displayPath,
            originalPath: current.path,
            hop: 0,
            tokens: fitted.tokens,
            originalTokens,
            truncated: fitted.truncated,
            content: fitted.text,
          });
          runningTokens += fitted.tokens;
        } else if (originalTokens <= remainingBudget) {
          includedNotes.push({
            path: displayPath,
            originalPath: current.path,
            hop: current.hop,
            tokens: originalTokens,
            originalTokens,
            truncated: false,
            content: cleaned,
          });
          runningTokens += originalTokens;
        } else if (remainingBudget >= 200) {
          const fitted = truncateToTokenBudget(cleaned, remainingBudget);
          includedNotes.push({
            path: displayPath,
            originalPath: current.path,
            hop: current.hop,
            tokens: fitted.tokens,
            originalTokens,
            truncated: true,
            content: fitted.text,
          });
          runningTokens += fitted.tokens;
        } else {
          omittedNotes.push({
            path: displayPath,
            originalPath: current.path,
            hop: current.hop,
            tokens: originalTokens,
            reason: "token_budget_exceeded",
          });
        }
      }

      const rootDisplayPath = includedNotes[0]?.path || canonicalRoot;
      const bundleText = formatBundleDocument({
        rootPath: rootDisplayPath,
        includedNotes,
        omittedNotes,
        format,
        totalTokens: runningTokens,
        redactedCount: totalRedactions,
      });

      const finalBundleTokens = estimateTokens(bundleText).tokens;

      return {
        bundleText,
        rootPath: canonicalRoot,
        includedNotes,
        omittedNotes,
        unresolvedLinks,
        totalTokens: runningTokens,
        bundleTokens: finalBundleTokens,
        budgetTokens: maxTokens,
        budgetExceeded: omittedNotes.length > 0 || includedNotes.some((n) => n.truncated),
        redactionSummary: {
          redactedCount: totalRedactions,
          byCategory: redactionsByCategory,
        },
      };
    }

    /**
     * Compute quick 1-hop neighbor summary for live status bar metering.
     *
     * @param {string} activePath
     * @param {string} activeContent
     * @param {Map<string, string>} neighborContentsMap
     * @param {{ stripFrontmatter?: boolean, stripComments?: boolean }} [options]
     */
    function measureActiveAndNeighbors(activePath, activeContent, neighborContentsMap, options = {}) {
      const cleanActive = cleanNoteContent(activeContent, options);
      const noteMetrics = estimateTokens(cleanActive);
      let linkedTokens = 0;
      let linkedNoteCount = 0;

      for (const [nPath, nContent] of neighborContentsMap.entries()) {
        if (nPath === activePath) {
          continue;
        }
        const cleanNeighbor = cleanNoteContent(nContent, options);
        linkedTokens += estimateTokens(cleanNeighbor).tokens;
        linkedNoteCount += 1;
      }

      return {
        noteTokens: noteMetrics.tokens,
        linkedTokens,
        totalTokens: noteMetrics.tokens + linkedTokens,
        linkedNoteCount,
        dominantScript: noteMetrics.dominantScript,
      };
    }

    module.exports = {
      ATTACHMENT_EXTENSIONS,
      extractFrontmatter,
      stripFrontmatter,
      findCodeRanges,
      stripObsidianComments,
      cleanNoteContent,
      extractWikiLinks,
      normalizeVaultPath,
      resolveLinkTarget,
      extractHeadingSection,
      truncateToTokenBudget,
      buildContextBundle,
      measureActiveAndNeighbors,
    };
  },

  "src/core/license.js": function(module, exports, require) {
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
  },

  "src/core/vault_auditor.js": function(module, exports, require) {
    "use strict";

    /**
     * VaultLens Pro offline vault analytics & sanitized RAG JSONL batch exporter.
     * Pure JavaScript, zero Node.js built-ins (100% Desktop + iOS + Android compatible).
     */

    const {
      estimateTokens,
      calculateAllModelCosts,
      calculateModelCost,
      formatUsd,
      formatTokenCount,
    } = require("./tokenizer");
    const {
      extractFrontmatter,
      cleanNoteContent,
      extractWikiLinks,
      normalizeVaultPath,
      resolveLinkTarget,
    } = require("./graph");
    const { scanText, RedactionVault } = require("./redactor");

    function topFolderOf(notePath) {
      const norm = normalizeVaultPath(notePath);
      const idx = norm.indexOf("/");
      return idx >= 0 ? norm.slice(0, idx) : "(Vault Root)";
    }

    function noteWikilinkPath(notePath) {
      const norm = normalizeVaultPath(notePath);
      return norm.toLowerCase().endsWith(".md") ? norm.slice(0, -3) : norm;
    }

    function renderBar(ratio, width = 16) {
      const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
      const filled = Math.round(clamped * width);
      return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
    }

    /**
     * Audit an entire Markdown vault for token heatmap, 6-model RAG cost,
     * orphan notes, broken [[wikilinks]], and masked PII/secret exposure.
     *
     * @param {Array<{ path: string, content: string, mtime?: number }>} notes
     * @param {{
     *   stripFrontmatter?: boolean,
     *   stripComments?: boolean,
     *   topLimit?: number,
     *   customAliases?: string | Array<string | { term: string, label?: string }>,
     *   excludePaths?: string[]
     * }} [options]
     */
    function auditVault(notes, options = {}) {
      const {
        stripFrontmatter = true,
        stripComments = true,
        topLimit = 20,
        customAliases = [],
        excludePaths = [],
      } = options;

      const excludeSet = new Set(excludePaths.map((p) => normalizeVaultPath(p)));
      const filteredNotes = (Array.isArray(notes) ? notes : []).filter(
        (n) => n && typeof n.path === "string" && !excludeSet.has(normalizeVaultPath(n.path))
      );

      const allPaths = filteredNotes.map((n) => n.path);
      const incomingCounts = new Map();
      for (const p of allPaths) {
        incomingCounts.set(p, 0);
      }

      const noteStats = [];
      const brokenLinks = [];
      const folderMap = new Map();
      let totalTokens = 0;
      let totalCharacters = 0;
      let totalWords = 0;
      let totalBytes = 0;
      let totalLinks = 0;
      let totalFindings = 0;

      for (const note of filteredNotes) {
        const raw = typeof note.content === "string" ? note.content : "";
        const cleaned = cleanNoteContent(raw, { stripFrontmatter, stripComments });
        const metrics = estimateTokens(cleaned);
        const links = extractWikiLinks(raw);

        let outgoingResolved = 0;
        let outgoingBroken = 0;
        let embedCount = 0;
        const seenTargetsForNote = new Set();

        for (const link of links) {
          if (link.isEmbed) {
            embedCount += 1;
          }
          if (link.isSameNote || link.isAttachment) {
            continue;
          }
          totalLinks += 1;
          const resolved = resolveLinkTarget(link.target, allPaths, note.path);
          if (!resolved) {
            outgoingBroken += 1;
            brokenLinks.push({
              sourcePath: note.path,
              target: link.target,
              raw: link.raw,
            });
          } else {
            outgoingResolved += 1;
            if (resolved !== note.path && !seenTargetsForNote.has(resolved)) {
              seenTargetsForNote.add(resolved);
              incomingCounts.set(resolved, (incomingCounts.get(resolved) || 0) + 1);
            }
          }
        }

        const findings = scanText(raw, {
          includeSecrets: true,
          includePii: true,
          customAliases,
          respectIgnoreComments: true,
        });
        totalFindings += findings.length;

        const findingsByKind = { secret: 0, pii: 0, alias: 0 };
        const findingSummaries = [];
        for (const f of findings) {
          findingsByKind[f.kind] = (findingsByKind[f.kind] || 0) + 1;
          if (findingSummaries.length < 5) {
            findingSummaries.push({
              ruleId: f.ruleId,
              kind: f.kind,
              severity: f.severity,
              maskedPreview: f.maskedPreview,
              line: f.startLine + 1,
            });
          }
        }

        totalTokens += metrics.tokens;
        totalCharacters += metrics.characters;
        totalWords += metrics.words;
        totalBytes += metrics.bytes;

        const folder = topFolderOf(note.path);
        const fEntry = folderMap.get(folder) || { folder, noteCount: 0, tokens: 0, findings: 0 };
        fEntry.noteCount += 1;
        fEntry.tokens += metrics.tokens;
        fEntry.findings += findings.length;
        folderMap.set(folder, fEntry);

        noteStats.push({
          path: note.path,
          folder,
          tokens: metrics.tokens,
          characters: metrics.characters,
          words: metrics.words,
          lines: metrics.lines,
          bytes: metrics.bytes,
          dominantScript: metrics.dominantScript,
          outgoingResolved,
          outgoingBroken,
          incomingLinks: 0,
          embedCount,
          findingCount: findings.length,
          findingsByKind,
          findingSummaries,
        });
      }

      for (const stat of noteStats) {
        stat.incomingLinks = incomingCounts.get(stat.path) || 0;
      }

      const heaviestNotes = [...noteStats]
        .sort((a, b) => b.tokens - a.tokens || a.path.localeCompare(b.path))
        .slice(0, Math.max(1, topLimit));

      const orphanNotes = noteStats
        .filter((n) => n.incomingLinks === 0 && n.outgoingResolved === 0)
        .sort((a, b) => b.tokens - a.tokens || a.path.localeCompare(b.path));

      const privacyHotspots = noteStats
        .filter((n) => n.findingCount > 0)
        .sort((a, b) => b.findingCount - a.findingCount || b.tokens - a.tokens);

      const folderBreakdown = Array.from(folderMap.values()).sort(
        (a, b) => b.tokens - a.tokens || a.folder.localeCompare(b.folder)
      );

      const modelCosts = calculateAllModelCosts(totalTokens);

      return {
        generatedAt: new Date().toISOString(),
        summary: {
          noteCount: noteStats.length,
          totalTokens,
          averageTokensPerNote: noteStats.length > 0 ? Math.round(totalTokens / noteStats.length) : 0,
          totalCharacters,
          totalWords,
          totalBytes,
          totalLinks,
          brokenLinkCount: brokenLinks.length,
          orphanCount: orphanNotes.length,
          totalFindings,
          notesWithFindings: privacyHotspots.length,
        },
        modelCosts,
        heaviestNotes,
        folderBreakdown,
        orphanNotes,
        brokenLinks,
        privacyHotspots,
        allNoteStats: noteStats,
      };
    }

    /**
     * Render an Obsidian-native Markdown dashboard note from an `auditVault` result.
     * Zero raw secret values are ever written to the report.
     *
     * @param {ReturnType<typeof auditVault>} audit
     * @param {{ defaultModelId?: string }} [options]
     * @returns {string}
     */
    function renderVaultAuditMarkdown(audit, options = {}) {
      const defaultModelId = options.defaultModelId || "claude-sonnet-4";
      const { summary, modelCosts, heaviestNotes, folderBreakdown, orphanNotes, brokenLinks, privacyHotspots } =
        audit;
      const primaryCost = calculateModelCost(summary.totalTokens, defaultModelId);

      const lines = [];
      lines.push("---");
      lines.push("generated_by: vaultlens-pro");
      lines.push(`generated_at: "${audit.generatedAt}"`);
      lines.push(`vault_notes: ${summary.noteCount}`);
      lines.push(`vault_tokens: ${summary.totalTokens}`);
      lines.push(`broken_links: ${summary.brokenLinkCount}`);
      lines.push(`orphan_notes: ${summary.orphanCount}`);
      lines.push(`privacy_findings: ${summary.totalFindings}`);
      lines.push("---");
      lines.push("");
      lines.push("# VaultLens Pro — Vault Token Heatmap & Wikilink Audit");
      lines.push("");
      lines.push("> [!summary] Vault Overview");
      lines.push(
        `> - **Markdown Notes**: ${formatTokenCount(summary.noteCount)} notes (~${formatTokenCount(summary.averageTokensPerNote)} tok/note avg)`
      );
      lines.push(
        `> - **Total Vault Tokens**: **${formatTokenCount(summary.totalTokens)} tokens** (${(summary.totalBytes / 1024).toFixed(1)} KB)`
      );
      lines.push(
        `> - **Full-Vault Input Cost (${primaryCost.modelName})**: **${formatUsd(primaryCost.inputCostUsd)}** (${primaryCost.contextPercent.toFixed(1)}% of ${formatTokenCount(primaryCost.contextWindow)} ctx)`
      );
      lines.push(
        `> - **Graph Health**: ${summary.brokenLinkCount} broken \`[[wikilinks]]\` · ${summary.orphanCount} orphan notes · ${summary.totalFindings} PII/secret alerts across ${summary.notesWithFindings} notes`
      );
      lines.push("");

      // 1. 6-Model Full-Vault RAG Cost Matrix
      lines.push("## Full-Vault RAG Cost Across 6 Frontier Models");
      lines.push("");
      lines.push("| Model | Provider | Context Window | Full-Vault Input Cost | Context Share | Passes Needed |");
      lines.push("| :--- | :--- | ---: | ---: | ---: | ---: |");
      for (const m of modelCosts) {
        lines.push(
          `| **${m.modelName}** | ${m.provider} | ${formatTokenCount(m.contextWindow)} | ${formatUsd(m.inputCostUsd)} | ${m.contextPercent.toFixed(1)}% | ${m.chunksNeeded} |`
        );
      }
      lines.push("");

      // 2. Folder Token Heatmap
      lines.push("## Folder Token Heatmap");
      lines.push("");
      if (folderBreakdown.length === 0) {
        lines.push("_No Markdown notes found in vault._");
      } else {
        const maxFolderTokens = Math.max(1, folderBreakdown[0].tokens);
        lines.push("| Folder | Notes | Tokens | Share | Heatmap |");
        lines.push("| :--- | ---: | ---: | ---: | :--- |");
        for (const f of folderBreakdown.slice(0, 20)) {
          const share = summary.totalTokens > 0 ? ((f.tokens / summary.totalTokens) * 100).toFixed(1) : "0.0";
          lines.push(
            `| \`${f.folder}\` | ${f.noteCount} | ${formatTokenCount(f.tokens)} | ${share}% | \`${renderBar(f.tokens / maxFolderTokens, 14)}\` |`
          );
        }
      }
      lines.push("");

      // 3. Heaviest Notes Ranking
      lines.push(`## Top ${heaviestNotes.length} Heaviest Notes`);
      lines.push("");
      if (heaviestNotes.length === 0) {
        lines.push("_No notes to rank._");
      } else {
        lines.push("| # | Note | Tokens | Share | Claude Sonnet 4 | GPT-5 | Backlinks | PII/Secrets |");
        lines.push("| ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: |");
        heaviestNotes.forEach((n, idx) => {
          const share = summary.totalTokens > 0 ? ((n.tokens / summary.totalTokens) * 100).toFixed(1) : "0.0";
          const claude = formatUsd(calculateModelCost(n.tokens, "claude-sonnet-4").inputCostUsd);
          const gpt5 = formatUsd(calculateModelCost(n.tokens, "gpt-5").inputCostUsd);
          lines.push(
            `| ${idx + 1} | [[${noteWikilinkPath(n.path)}]] | ${formatTokenCount(n.tokens)} | ${share}% | ${claude} | ${gpt5} | ${n.incomingLinks} | ${n.findingCount} |`
          );
        });
      }
      lines.push("");

      // 4. Broken Wikilinks
      lines.push(`## Broken Wikilinks (${brokenLinks.length})`);
      lines.push("");
      if (brokenLinks.length === 0) {
        lines.push("> [!success] Zero broken `[[wikilinks]]` detected across your vault.");
      } else {
        lines.push("| Source Note | Missing Target |");
        lines.push("| :--- | :--- |");
        for (const b of brokenLinks.slice(0, 100)) {
          lines.push(`| [[${noteWikilinkPath(b.sourcePath)}]] | \`${b.target}\` |`);
        }
        if (brokenLinks.length > 100) {
          lines.push("");
          lines.push(`_...and ${brokenLinks.length - 100} additional broken links._`);
        }
      }
      lines.push("");

      // 5. Orphan Notes
      lines.push(`## Orphan Notes (${orphanNotes.length})`);
      lines.push("");
      if (orphanNotes.length === 0) {
        lines.push("> [!success] Every note is connected to at least one other note.");
      } else {
        for (const o of orphanNotes.slice(0, 50)) {
          lines.push(`- [[${noteWikilinkPath(o.path)}]] — ${formatTokenCount(o.tokens)} tokens`);
        }
        if (orphanNotes.length > 50) {
          lines.push(`- _...and ${orphanNotes.length - 50} more orphan notes._`);
        }
      }
      lines.push("");

      // 6. Privacy & Secret Hotspots (Masked previews ONLY — never raw secrets)
      lines.push(`## Privacy & Secret Exposure Hotspots (${privacyHotspots.length} notes)`);
      lines.push("");
      if (privacyHotspots.length === 0) {
        lines.push("> [!success] Zero unredacted secrets or PII detected in scanned notes.");
      } else {
        lines.push("> [!warning] Raw values are masked below for safety. Use VaultLens Safe Context Bundle before sharing with AI tools.");
        lines.push("");
        lines.push("| Note | Findings | Secrets | PII | Aliases | Sample (Masked) |");
        lines.push("| :--- | ---: | ---: | ---: | ---: | :--- |");
        for (const h of privacyHotspots.slice(0, 40)) {
          const sample = h.findingSummaries
            .slice(0, 2)
            .map((s) => `${s.ruleId}@L${s.line} (\`${s.maskedPreview}\`)`)
            .join(", ");
          lines.push(
            `| [[${noteWikilinkPath(h.path)}]] | ${h.findingCount} | ${h.findingsByKind.secret || 0} | ${h.findingsByKind.pii || 0} | ${h.findingsByKind.alias || 0} | ${sample} |`
          );
        }
      }
      lines.push("");

      return lines.join("\n");
    }

    /**
     * Split cleaned Markdown body into heading-aware sections and fit into token-bounded chunks.
     *
     * @param {string} body
     * @param {number} maxChunkTokens
     * @param {number} overlapTokens
     * @returns {Array<{ headingPath: string[], text: string, tokens: number }>}
     */
    function chunkMarkdownByHeadings(body, maxChunkTokens = 800, overlapTokens = 80) {
      const safeMax = Math.max(120, Number(maxChunkTokens) || 800);
      const safeOverlap = Math.max(0, Math.min(Math.floor(safeMax / 3), Number(overlapTokens) || 0));

      const lines = String(body || "").split(/\r?\n/);
      const sections = [];
      const headingStack = [];
      let currentLines = [];

      const flushSection = () => {
        const text = currentLines.join("\n").trim();
        if (text.length > 0) {
          sections.push({
            headingPath: headingStack.map((h) => h.title),
            text,
          });
        }
        currentLines = [];
      };

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        const hMatch = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
        if (hMatch) {
          flushSection();
          const level = hMatch[1].length;
          const title = hMatch[2].trim();
          while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
            headingStack.pop();
          }
          headingStack.push({ level, title });
          currentLines.push(line);
        } else {
          currentLines.push(line);
        }
      }
      flushSection();

      if (sections.length === 0) {
        return [];
      }

      const chunks = [];
      for (const sec of sections) {
        const secTokens = estimateTokens(sec.text).tokens;
        if (secTokens <= safeMax) {
          chunks.push({
            headingPath: sec.headingPath,
            text: sec.text,
            tokens: secTokens,
          });
          continue;
        }

        // Split oversized section on paragraph/line boundaries with light overlap
        const paragraphs = sec.text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
        let buffer = [];
        let bufferTokens = 0;

        for (const para of paragraphs) {
          const pTokens = estimateTokens(para).tokens;
          if (buffer.length > 0 && bufferTokens + pTokens > safeMax) {
            const joined = buffer.join("\n\n").trim();
            chunks.push({
              headingPath: sec.headingPath,
              text: joined,
              tokens: estimateTokens(joined).tokens,
            });

            // Carry tail overlap paragraphs up to safeOverlap tokens
            const overlapBuf = [];
            let ovTokens = 0;
            for (let k = buffer.length - 1; k >= 0 && safeOverlap > 0; k -= 1) {
              const t = estimateTokens(buffer[k]).tokens;
              if (ovTokens + t <= safeOverlap) {
                overlapBuf.unshift(buffer[k]);
                ovTokens += t;
              } else {
                break;
              }
            }
            buffer = overlapBuf;
            bufferTokens = ovTokens;
          }

          if (pTokens > safeMax) {
            // Hard split very long single paragraph on sentence/character chunks
            const words = para.split(/(\s+)/);
            let sub = "";
            for (const w of words) {
              const candidate = sub + w;
              if (sub.length > 0 && estimateTokens(candidate).tokens > safeMax) {
                const trimmed = sub.trim();
                if (trimmed) {
                  chunks.push({
                    headingPath: sec.headingPath,
                    text: trimmed,
                    tokens: estimateTokens(trimmed).tokens,
                  });
                }
                sub = w;
              } else {
                sub = candidate;
              }
            }
            if (sub.trim()) {
              buffer.push(sub.trim());
              bufferTokens += estimateTokens(sub.trim()).tokens;
            }
          } else {
            buffer.push(para);
            bufferTokens += pTokens;
          }
        }

        if (buffer.length > 0) {
          const joined = buffer.join("\n\n").trim();
          if (joined) {
            chunks.push({
              headingPath: sec.headingPath,
              text: joined,
              tokens: estimateTokens(joined).tokens,
            });
          }
        }
      }

      return chunks;
    }

    function redactMetadataValue(val, vault, redactionOpts) {
      if (typeof val === "string") {
        const res = vault.redact(val, redactionOpts);
        return { value: res.redactedText, redactedCount: res.redactedCount };
      }
      if (Array.isArray(val)) {
        let count = 0;
        const out = val.map((item) => {
          const res = redactMetadataValue(item, vault, redactionOpts);
          count += res.redactedCount;
          return res.value;
        });
        return { value: out, redactedCount: count };
      }
      return { value: val, redactedCount: 0 };
    }

    /**
     * Batch safe-export a folder (or whole vault) into sanitized, heading-chunked,
     * frontmatter-enriched RAG JSONL lines.
     *
     * @param {Array<{ path: string, content: string, mtime?: number }>} notes
     * @param {{
     *   folderPrefix?: string,
     *   chunkMaxTokens?: number,
     *   chunkOverlapTokens?: number,
     *   stripComments?: boolean,
     *   redactSecrets?: boolean,
     *   redactPii?: boolean,
     *   customAliases?: string | Array<string | { term: string, label?: string }>,
     *   redactionVault?: RedactionVault
     * }} [options]
     */
    function exportFolderToRagJsonl(notes, options = {}) {
      const {
        folderPrefix = "",
        chunkMaxTokens = 800,
        chunkOverlapTokens = 80,
        stripComments = true,
        redactSecrets = true,
        redactPii = true,
        customAliases = [],
        redactionVault = new RedactionVault(),
      } = options;

      const normPrefix = normalizeVaultPath(folderPrefix).replace(/\/+$/, "");
      const selectedNotes = (Array.isArray(notes) ? notes : [])
        .filter((n) => {
          if (!n || typeof n.path !== "string") return false;
          const np = normalizeVaultPath(n.path);
          if (!normPrefix) return true;
          return np === normPrefix || np.startsWith(`${normPrefix}/`);
        })
        .sort((a, b) => a.path.localeCompare(b.path));

      const redactionOpts = {
        includeSecrets: redactSecrets,
        includePii: redactPii,
        customAliases,
        respectIgnoreComments: true,
      };

      const records = [];
      let totalTokens = 0;
      let totalRedactions = 0;

      for (const note of selectedNotes) {
        const raw = typeof note.content === "string" ? note.content : "";
        const { frontmatter, body } = extractFrontmatter(raw);
        const cleanedBody = cleanNoteContent(body, {
          stripFrontmatter: false,
          stripComments,
        });

        const sanitizedMeta = {};
        for (const [k, v] of Object.entries(frontmatter)) {
          const mRes = redactMetadataValue(v, redactionVault, redactionOpts);
          sanitizedMeta[k] = mRes.value;
          totalRedactions += mRes.redactedCount;
        }

        const links = extractWikiLinks(raw)
          .filter((l) => !l.isSameNote && !l.isAttachment)
          .map((l) => {
            const lRes = redactionVault.redact(l.target, redactionOpts);
            totalRedactions += lRes.redactedCount;
            return lRes.redactedText;
          });
        const uniqueLinks = Array.from(new Set(links));

        const pathRedacted = redactionVault.redact(note.path, {
          includeSecrets: false,
          includePii: false,
          customAliases,
          respectIgnoreComments: false,
        });
        const safePath = pathRedacted.redactedText;
        totalRedactions += pathRedacted.redactedCount;

        const rawChunks = chunkMarkdownByHeadings(cleanedBody, chunkMaxTokens, chunkOverlapTokens);
        const effectiveChunks =
          rawChunks.length > 0
            ? rawChunks
            : cleanedBody
              ? [{ headingPath: [], text: cleanedBody, tokens: estimateTokens(cleanedBody).tokens }]
              : [];

        effectiveChunks.forEach((chunk, idx) => {
          const textRes = redactionVault.redact(chunk.text, redactionOpts);
          totalRedactions += textRes.redactedCount;

          const safeHeadings = chunk.headingPath.map((h) => {
            const hRes = redactionVault.redact(h, redactionOpts);
            totalRedactions += hRes.redactedCount;
            return hRes.redactedText;
          });

          const finalTokens = estimateTokens(textRes.redactedText).tokens;
          totalTokens += finalTokens;

          records.push({
            id: `${safePath}#chunk-${idx}`,
            source_path: safePath,
            chunk_index: idx,
            chunk_count: effectiveChunks.length,
            headings: safeHeadings,
            tags: Array.isArray(sanitizedMeta.tags)
              ? sanitizedMeta.tags
              : typeof sanitizedMeta.tags === "string"
                ? [sanitizedMeta.tags]
                : [],
            frontmatter: sanitizedMeta,
            wikilinks: uniqueLinks,
            tokens: finalTokens,
            redactions: textRes.redactedCount,
            text: textRes.redactedText,
          });
        });
      }

      const jsonl = records.map((r) => JSON.stringify(r)).join("\n") + (records.length > 0 ? "\n" : "");

      return {
        folderPrefix: normPrefix || "/",
        noteCount: selectedNotes.length,
        recordCount: records.length,
        totalTokens,
        totalRedactions,
        records,
        jsonl,
      };
    }

    module.exports = {
      auditVault,
      renderVaultAuditMarkdown,
      chunkMarkdownByHeadings,
      exportFolderToRagJsonl,
    };
  },

  "src/plugin.js": function(module, exports, require) {
    "use strict";

    const {
      Plugin,
      PluginSettingTab,
      Setting,
      Notice,
      Modal,
      MarkdownView,
      normalizePath,
    } = require("obsidian");

    const {
      FRONTIER_MODELS,
      calculateModelCost,
      calculateAllModelCosts,
      formatUsd,
      formatTokenCount,
      formatStatusBarLabel,
    } = require("./core/tokenizer");
    const {
      extractWikiLinks,
      resolveLinkTarget,
      buildContextBundle,
      measureActiveAndNeighbors,
      normalizeVaultPath,
    } = require("./core/graph");
    const { scanText, RedactionVault } = require("./core/redactor");
    const { verifyLicenseKey, formatLicenseSummary } = require("./core/license");
    const {
      auditVault,
      renderVaultAuditMarkdown,
      exportFolderToRagJsonl,
    } = require("./core/vault_auditor");

    const PRO_SPONSOR_URL = "https://github.com/sponsors/pecopeko";
    const REPO_URL = "https://github.com/pecopeko/obsidian-vaultlens";
    const MAX_STATUSBAR_NEIGHBORS = 50;

    const DEFAULT_SETTINGS = Object.freeze({
      defaultModel: "claude-sonnet-4",
      linkDepth: 1,
      includeEmbeds: true,
      stripFrontmatter: true,
      stripComments: true,
      maxTokenBudget: 32000,
      bundleFormat: "xml",
      redactSecrets: true,
      redactPii: true,
      customAliases: "",
      showStatusBar: true,
      licenseKey: "",
      auditOutputPath: "VaultLens-Audit-Report.md",
      jsonlChunkMaxTokens: 800,
    });

    function getClipboardApi() {
      if (typeof globalThis !== "undefined" && globalThis.navigator && globalThis.navigator.clipboard) {
        return globalThis.navigator.clipboard;
      }
      return null;
    }

    class ContextInspectorModal extends Modal {
      constructor(app, plugin, snapshot) {
        super(app);
        this.plugin = plugin;
        this.snapshot = snapshot;
      }

      onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("vaultlens-modal");

        const { filePath, noteTokens, linkedTokens, linkedNoteCount, linkedPaths, findings, totalTokens } =
          this.snapshot;

        contentEl.createEl("h2", { text: "VaultLens context & token inspector" });
        contentEl.createEl("p", {
          cls: "vaultlens-subtitle",
          text: `Active note: ${filePath}`,
        });

        const summaryGrid = contentEl.createDiv({ cls: "vaultlens-summary-grid" });
        const stats = [
          { label: "Active note", value: `${formatTokenCount(noteTokens)} tok` },
          { label: `1-hop links (${linkedNoteCount})`, value: `${formatTokenCount(linkedTokens)} tok` },
          { label: "Combined total", value: `${formatTokenCount(totalTokens)} tok` },
          {
            label: "PII / secret alerts",
            value: findings.length > 0 ? `${findings.length} detected` : "Clean",
          },
        ];
        for (const s of stats) {
          const card = summaryGrid.createDiv({ cls: "vaultlens-stat-card" });
          card.createDiv({ cls: "vaultlens-stat-label", text: s.label });
          card.createDiv({ cls: "vaultlens-stat-value", text: s.value });
        }

        contentEl.createEl("h3", { text: "Estimated input cost across 6 models" });
        const table = contentEl.createEl("table", { cls: "vaultlens-table" });
        const thead = table.createEl("thead");
        const hRow = thead.createEl("tr");
        for (const col of ["Model", "Provider", "Input cost", "Context share"]) {
          hRow.createEl("th", { text: col });
        }
        const tbody = table.createEl("tbody");
        for (const cost of calculateAllModelCosts(totalTokens)) {
          const tr = tbody.createEl("tr");
          if (cost.modelId === this.plugin.settings.defaultModel) {
            tr.addClass("vaultlens-row-active");
          }
          tr.createEl("td", { text: cost.modelName });
          tr.createEl("td", { text: cost.provider });
          tr.createEl("td", { text: formatUsd(cost.inputCostUsd) });
          tr.createEl("td", { text: `${cost.contextPercent.toFixed(2)}%` });
        }

        if (linkedPaths.length > 0) {
          contentEl.createEl("h3", { text: `Linked 1-hop notes (${linkedPaths.length})` });
          const ul = contentEl.createEl("ul", { cls: "vaultlens-list" });
          for (const lp of linkedPaths.slice(0, 15)) {
            ul.createEl("li", { text: lp });
          }
          if (linkedPaths.length > 15) {
            ul.createEl("li", { text: `...and ${linkedPaths.length - 15} more` });
          }
        }

        if (findings.length > 0) {
          contentEl.createEl("h3", { text: `Detected PII, secrets & aliases (${findings.length})` });
          const ul = contentEl.createEl("ul", { cls: "vaultlens-list vaultlens-findings-list" });
          for (const f of findings.slice(0, 12)) {
            ul.createEl("li", {
              text: `L${f.startLine + 1} · [${f.ruleId}] ${f.maskedPreview} (${f.description})`,
            });
          }
        }

        const actions = contentEl.createDiv({ cls: "vaultlens-modal-actions" });
        const copyBtn = actions.createEl("button", {
          cls: "mod-cta",
          text: "Copy safe AI context bundle",
        });
        copyBtn.addEventListener("click", async () => {
          this.close();
          await this.plugin.copySafeContextBundle();
        });

        const closeBtn = actions.createEl("button", { text: "Close" });
        closeBtn.addEventListener("click", () => this.close());
      }

      onClose() {
        this.contentEl.empty();
      }
    }

    class RestoreReplyModal extends Modal {
      constructor(app, plugin, initialText = "") {
        super(app);
        this.plugin = plugin;
        this.initialText = initialText;
      }

      onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("vaultlens-modal");

        contentEl.createEl("h2", { text: "Restore redacted AI reply" });
        contentEl.createEl("p", {
          cls: "vaultlens-subtitle",
          text: `Session vault currently holds ${this.plugin.redactionVault.size()} reversible placeholder mapping(s). Paste the AI response below to restore placeholders locally.`,
        });

        const textarea = contentEl.createEl("textarea", {
          cls: "vaultlens-textarea",
          attr: {
            rows: "10",
            placeholder: "Paste AI response containing [[PII_EMAIL_1]], [[ALIAS_1]], [[SECRET_AWS_1]]...",
          },
        });
        textarea.value = this.initialText;

        const previewEl = contentEl.createDiv({ cls: "vaultlens-status-pill" });
        const updatePreview = () => {
          const check = this.plugin.redactionVault.restore(textarea.value);
          const unknownNote =
            check.unknownPlaceholders.length > 0
              ? ` · ${check.unknownPlaceholders.length} unknown placeholder(s)`
              : "";
          previewEl.setText(`Ready to restore ${check.replacedCount} placeholder(s)${unknownNote}`);
        };
        textarea.addEventListener("input", updatePreview);
        updatePreview();

        const actions = contentEl.createDiv({ cls: "vaultlens-modal-actions" });
        const insertBtn = actions.createEl("button", {
          cls: "mod-cta",
          text: "Restore & insert into active note",
        });
        insertBtn.addEventListener("click", () => {
          const res = this.plugin.redactionVault.restore(textarea.value);
          const inserted = this.plugin.insertTextIntoActiveEditor(res.restoredText);
          if (inserted) {
            new Notice(`VaultLens: Restored ${res.replacedCount} placeholder(s) into active note.`);
            this.close();
          } else {
            new Notice("VaultLens: No active Markdown editor found. Use Restore & copy instead.");
          }
        });

        const copyBtn = actions.createEl("button", { text: "Restore & copy to clipboard" });
        copyBtn.addEventListener("click", async () => {
          const res = this.plugin.redactionVault.restore(textarea.value);
          const ok = await this.plugin.writeClipboard(res.restoredText);
          if (ok) {
            new Notice(`VaultLens: Restored ${res.replacedCount} placeholder(s) and copied to clipboard.`);
            this.close();
          } else {
            textarea.value = res.restoredText;
            new Notice(`VaultLens: Restored ${res.replacedCount} placeholder(s) in editor box.`);
          }
        });

        const closeBtn = actions.createEl("button", { text: "Cancel" });
        closeBtn.addEventListener("click", () => this.close());
      }

      onClose() {
        this.contentEl.empty();
      }
    }

    class ProUpgradeModal extends Modal {
      constructor(app, plugin, featureName, verification) {
        super(app);
        this.plugin = plugin;
        this.featureName = featureName;
        this.verification = verification;
      }

      onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("vaultlens-modal");

        contentEl.createEl("h2", { text: "VaultLens Pro feature" });
        contentEl.createEl("p", {
          text: `"${this.featureName}" is part of VaultLens Pro — verified 100% offline with zero telemetry or license server.`,
        });

        const list = contentEl.createEl("ul", { cls: "vaultlens-list" });
        list.createEl("li", {
          text: "Vault-Wide Token Heatmap & Broken Wikilink Audit dashboard across 6 frontier models",
        });
        list.createEl("li", {
          text: "Batch Safe-Export Folder to sanitized, heading-chunked RAG JSONL",
        });
        list.createEl("li", {
          text: "Works offline on Desktop, iOS, and Android via Web Crypto ES256 verification",
        });

        if (this.verification && this.verification.reason === "expired") {
          contentEl.createEl("p", {
            cls: "vaultlens-warning-text",
            text: `Your current license expired (${formatLicenseSummary(this.verification)}).`,
          });
        }

        let keyDraft = this.plugin.settings.licenseKey || "";
        new Setting(contentEl)
          .setName("Pro license key")
          .setDesc("Paste your offline VLPRO-... license key")
          .addText((text) =>
            text
              .setPlaceholder("VLPRO-...")
              .setValue(keyDraft)
              .onChange((val) => {
                keyDraft = val.trim();
              })
          );

        const actions = contentEl.createDiv({ cls: "vaultlens-modal-actions" });
        const activateBtn = actions.createEl("button", {
          cls: "mod-cta",
          text: "Verify & activate key",
        });
        activateBtn.addEventListener("click", async () => {
          const res = await verifyLicenseKey(keyDraft);
          if (res.valid) {
            this.plugin.settings.licenseKey = keyDraft;
            await this.plugin.saveSettings();
            new Notice(`VaultLens Pro activated: ${formatLicenseSummary(res)}`);
            this.close();
          } else {
            new Notice(`VaultLens: Invalid license key (${res.reason}).`);
          }
        });

        const sponsorLink = actions.createEl("a", {
          cls: "vaultlens-link-btn",
          text: "Get Pro via GitHub Sponsors",
          href: PRO_SPONSOR_URL,
        });
        sponsorLink.setAttr("target", "_blank");
        sponsorLink.setAttr("rel", "noopener noreferrer");

        const closeBtn = actions.createEl("button", { text: "Close" });
        closeBtn.addEventListener("click", () => this.close());
      }

      onClose() {
        this.contentEl.empty();
      }
    }

    class JsonlExportModal extends Modal {
      constructor(app, plugin, defaultFolder) {
        super(app);
        this.plugin = plugin;
        this.folder = defaultFolder || "";
        this.chunkMaxTokens = plugin.settings.jsonlChunkMaxTokens || 800;
      }

      onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("vaultlens-modal");

        contentEl.createEl("h2", { text: "Pro: batch safe-export folder to RAG JSONL" });
        contentEl.createEl("p", {
          cls: "vaultlens-subtitle",
          text: "Exports Markdown notes to sanitized, heading-chunked, frontmatter-enriched JSONL inside your vault.",
        });

        new Setting(contentEl)
          .setName("Folder path")
          .setDesc("Leave blank to export the entire vault, or enter a folder path (e.g. Projects/Research)")
          .addText((text) =>
            text
              .setPlaceholder("Projects/Research")
              .setValue(this.folder)
              .onChange((val) => {
                this.folder = val.trim();
              })
          );

        new Setting(contentEl)
          .setName("Max tokens per chunk")
          .setDesc("Heading-aware chunk target size (120 - 8000 tokens)")
          .addText((text) =>
            text
              .setValue(String(this.chunkMaxTokens))
              .onChange((val) => {
                const parsed = Number.parseInt(val, 10);
                if (Number.isFinite(parsed) && parsed >= 120 && parsed <= 8000) {
                  this.chunkMaxTokens = parsed;
                }
              })
          );

        const actions = contentEl.createDiv({ cls: "vaultlens-modal-actions" });
        const runBtn = actions.createEl("button", {
          cls: "mod-cta",
          text: "Export sanitized JSONL",
        });
        runBtn.addEventListener("click", async () => {
          this.close();
          await this.plugin.executeProBatchJsonlExport(this.folder, this.chunkMaxTokens);
        });

        const cancelBtn = actions.createEl("button", { text: "Cancel" });
        cancelBtn.addEventListener("click", () => this.close());
      }

      onClose() {
        this.contentEl.empty();
      }
    }

    class VaultLensSettingTab extends PluginSettingTab {
      constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
      }

      display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass("vaultlens-settings");

        new Setting(containerEl).setName("Token & cost meter").setHeading();

        new Setting(containerEl)
          .setName("Default pricing model")
          .setDesc("Model used for status bar cost estimation and inspection reports")
          .addDropdown((dropdown) => {
            for (const m of FRONTIER_MODELS) {
              dropdown.addOption(m.id, `${m.name} ($${m.inputPerMillionUsd}/M in)`);
            }
            dropdown.setValue(this.plugin.settings.defaultModel);
            dropdown.onChange(async (value) => {
              this.plugin.settings.defaultModel = value;
              await this.plugin.saveSettings();
              this.plugin.scheduleStatusBarUpdate(0);
            });
          });

        new Setting(containerEl)
          .setName("Show live status bar meter")
          .setDesc("Display active note + 1-hop wikilink tokens and estimated cost in the status bar")
          .addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.showStatusBar).onChange(async (value) => {
              this.plugin.settings.showStatusBar = value;
              await this.plugin.saveSettings();
              this.plugin.scheduleStatusBarUpdate(0);
            })
          );

        new Setting(containerEl).setName("AI context bundler").setHeading();

        new Setting(containerEl)
          .setName("Default wikilink expansion depth")
          .setDesc("How many hops of [[wikilinks]] to bundle with the active note")
          .addDropdown((dropdown) => {
            dropdown.addOption("0", "0 hops (active note only)");
            dropdown.addOption("1", "1 hop (active note + directly linked notes)");
            dropdown.addOption("2", "2 hops (active note + 2-hop graph)");
            dropdown.setValue(String(this.plugin.settings.linkDepth));
            dropdown.onChange(async (value) => {
              this.plugin.settings.linkDepth = Number.parseInt(value, 10) || 0;
              await this.plugin.saveSettings();
            });
          });

        new Setting(containerEl)
          .setName("Include ![[embeds]]")
          .setDesc("Expand embedded Markdown notes and heading sections when bundling")
          .addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.includeEmbeds).onChange(async (value) => {
              this.plugin.settings.includeEmbeds = value;
              await this.plugin.saveSettings();
            })
          );

        new Setting(containerEl)
          .setName("Strip YAML frontmatter")
          .setDesc("Remove leading YAML metadata blocks to save prompt tokens")
          .addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.stripFrontmatter).onChange(async (value) => {
              this.plugin.settings.stripFrontmatter = value;
              await this.plugin.saveSettings();
              this.plugin.scheduleStatusBarUpdate(0);
            })
          );

        new Setting(containerEl)
          .setName("Strip Obsidian %%comments%%")
          .setDesc("Remove private %%inline%% and multiline comment blocks before copying")
          .addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.stripComments).onChange(async (value) => {
              this.plugin.settings.stripComments = value;
              await this.plugin.saveSettings();
              this.plugin.scheduleStatusBarUpdate(0);
            })
          );

        new Setting(containerEl)
          .setName("Max bundle token budget")
          .setDesc("Safely cap bundled context length to avoid blowing past model limits")
          .addText((text) =>
            text
              .setPlaceholder("32000")
              .setValue(String(this.plugin.settings.maxTokenBudget))
              .onChange(async (value) => {
                const parsed = Number.parseInt(value, 10);
                if (Number.isFinite(parsed) && parsed >= 512 && parsed <= 1000000) {
                  this.plugin.settings.maxTokenBudget = parsed;
                  await this.plugin.saveSettings();
                }
              })
          );

        new Setting(containerEl)
          .setName("Context bundle format")
          .setDesc("XML tags work best for Claude/GPT-5/Gemini; Markdown fences are human-friendly")
          .addDropdown((dropdown) => {
            dropdown.addOption("xml", "XML (<vaultlens_context>)");
            dropdown.addOption("markdown", "Markdown fenced blocks");
            dropdown.setValue(this.plugin.settings.bundleFormat);
            dropdown.onChange(async (value) => {
              this.plugin.settings.bundleFormat = value === "markdown" ? "markdown" : "xml";
              await this.plugin.saveSettings();
            });
          });

        new Setting(containerEl).setName("Local PII, secrets & custom aliases").setHeading();

        new Setting(containerEl)
          .setName("Redact secrets & API keys")
          .setDesc("Automatically shield AWS, OpenAI, Anthropic, GitHub, Slack, Stripe, JWT, PEM, and DB URLs")
          .addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.redactSecrets).onChange(async (value) => {
              this.plugin.settings.redactSecrets = value;
              await this.plugin.saveSettings();
              this.plugin.scheduleStatusBarUpdate(0);
            })
          );

        new Setting(containerEl)
          .setName("Redact personal information (PII)")
          .setDesc("Automatically shield emails, phone numbers, IPv4 addresses, and Japanese MyNumber (Mod-11)")
          .addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.redactPii).onChange(async (value) => {
              this.plugin.settings.redactPii = value;
              await this.plugin.saveSettings();
              this.plugin.scheduleStatusBarUpdate(0);
            })
          );

        new Setting(containerEl)
          .setName("Custom confidential aliases")
          .setDesc(
            "One term per line (e.g. Project Phoenix -> [[ALIAS_1]], or Acme Corp => CLIENT -> [[ALIAS_CLIENT_1]]). Restored locally on paste."
          )
          .addTextArea((area) => {
            area
              .setPlaceholder("Project Phoenix\nAcme Holdings\n田中太郎")
              .setValue(this.plugin.settings.customAliases)
              .onChange(async (value) => {
                this.plugin.settings.customAliases = value;
                await this.plugin.saveSettings();
                this.plugin.scheduleStatusBarUpdate(0);
              });
            if (area.inputEl) {
              area.inputEl.rows = 4;
              area.inputEl.addClass("vaultlens-settings-textarea");
            }
          });

        new Setting(containerEl).setName("VaultLens Pro (offline license)").setHeading();

        const statusSetting = new Setting(containerEl)
          .setName("License status")
          .setDesc("Checking offline ES256 license...");

        verifyLicenseKey(this.plugin.settings.licenseKey).then((res) => {
          statusSetting.setDesc(formatLicenseSummary(res));
        });

        new Setting(containerEl)
          .setName("Offline Pro license key")
          .setDesc("Verified 100% offline via Web Crypto ECDSA P-256 (Desktop & Mobile). Zero server calls.")
          .addText((text) =>
            text
              .setPlaceholder("VLPRO-...")
              .setValue(this.plugin.settings.licenseKey)
              .onChange(async (value) => {
                this.plugin.settings.licenseKey = value.trim();
                await this.plugin.saveSettings();
                const res = await verifyLicenseKey(this.plugin.settings.licenseKey);
                statusSetting.setDesc(formatLicenseSummary(res));
              })
          );

        new Setting(containerEl)
          .setName("Audit report output path")
          .setDesc("Vault path written by Pro: vault-wide token heatmap & broken wikilink audit")
          .addText((text) =>
            text
              .setPlaceholder("VaultLens-Audit-Report.md")
              .setValue(this.plugin.settings.auditOutputPath)
              .onChange(async (value) => {
                this.plugin.settings.auditOutputPath = value.trim() || "VaultLens-Audit-Report.md";
                await this.plugin.saveSettings();
              })
          );

        new Setting(containerEl)
          .setName("RAG JSONL max tokens per chunk")
          .setDesc("Default heading-aware chunk target for Pro batch JSONL export")
          .addText((text) =>
            text
              .setPlaceholder("800")
              .setValue(String(this.plugin.settings.jsonlChunkMaxTokens))
              .onChange(async (value) => {
                const parsed = Number.parseInt(value, 10);
                if (Number.isFinite(parsed) && parsed >= 120 && parsed <= 8000) {
                  this.plugin.settings.jsonlChunkMaxTokens = parsed;
                  await this.plugin.saveSettings();
                }
              })
          );

        new Setting(containerEl)
          .setName("Support & documentation")
          .setDesc(`Source & issue tracker: ${REPO_URL}`)
          .addButton((btn) =>
            btn.setButtonText("Get VaultLens Pro").onClick(() => {
              if (typeof globalThis.open === "function") {
                globalThis.open(PRO_SPONSOR_URL, "_blank", "noopener,noreferrer");
              }
            })
          );
      }
    }

    class VaultLensPlugin extends Plugin {
      async onload() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) || {});
        this.redactionVault = new RedactionVault();
        this.statusBarEl = null;
        this._statusTimer = null;
        this._lastSnapshot = null;

        if (typeof this.addStatusBarItem === "function") {
          this.statusBarEl = this.addStatusBarItem();
          this.statusBarEl.addClass("vaultlens-status-bar");
          this.statusBarEl.setAttr("aria-label", "VaultLens token meter — click to inspect");
          this.statusBarEl.addEventListener("click", () => {
            this.openContextInspector();
          });
        }

        if (typeof this.addRibbonIcon === "function") {
          this.addRibbonIcon(
            "shield-check",
            "VaultLens: Copy note + linked notes safely (redact PII & secrets)",
            async () => {
              await this.copySafeContextBundle();
            }
          );
        }

        this.addCommand({
          id: "copy-safe-context-bundle",
          name: "Copy note + linked notes safely (redact PII & secrets)",
          callback: () => this.copySafeContextBundle(),
        });

        this.addCommand({
          id: "copy-safe-context-1hop",
          name: "Copy note + 1-hop links safely (redact PII & secrets)",
          callback: () => this.copySafeContextBundle(1),
        });

        this.addCommand({
          id: "copy-safe-context-2hop",
          name: "Copy note + 2-hop links safely (redact PII & secrets)",
          callback: () => this.copySafeContextBundle(2),
        });

        this.addCommand({
          id: "restore-redacted-tokens",
          name: "Paste / restore redacted tokens into active note",
          callback: () => this.pasteAndRestoreIntoActiveNote(),
        });

        this.addCommand({
          id: "open-restore-modal",
          name: "Open interactive AI reply restore modal",
          callback: () => new RestoreReplyModal(this.app, this, "").open(),
        });

        this.addCommand({
          id: "inspect-note-context",
          name: "Inspect active note tokens, links & PII findings",
          callback: () => this.openContextInspector(),
        });

        this.addCommand({
          id: "clear-redaction-vault",
          name: "Clear in-memory PII redaction session vault",
          callback: () => {
            const count = this.redactionVault.size();
            this.redactionVault.clear();
            new Notice(`VaultLens: Cleared ${count} in-memory redaction mapping(s).`);
          },
        });

        this.addCommand({
          id: "pro-vault-audit",
          name: "Pro: vault-wide token heatmap & broken wikilink audit",
          callback: () => this.runProVaultAudit(),
        });

        this.addCommand({
          id: "pro-batch-export-jsonl",
          name: "Pro: batch safe-export folder to RAG JSONL",
          callback: () => this.openProBatchJsonlExport(),
        });

        this.addSettingTab(new VaultLensSettingTab(this.app, this));

        this.registerEvent(
          this.app.workspace.on("active-leaf-change", () => this.scheduleStatusBarUpdate(100))
        );
        this.registerEvent(
          this.app.workspace.on("file-open", () => this.scheduleStatusBarUpdate(100))
        );
        this.registerEvent(
          this.app.workspace.on("editor-change", () => this.scheduleStatusBarUpdate(350))
        );
        if (this.app.metadataCache && typeof this.app.metadataCache.on === "function") {
          this.registerEvent(
            this.app.metadataCache.on("resolved", () => this.scheduleStatusBarUpdate(200))
          );
        }

        await this.updateStatusBar();
      }

      onunload() {
        if (this._statusTimer !== null) {
          globalThis.clearTimeout(this._statusTimer);
          this._statusTimer = null;
        }
        if (this.redactionVault) {
          this.redactionVault.clear();
        }
      }

      async saveSettings() {
        await this.saveData(this.settings);
      }

      scheduleStatusBarUpdate(delayMs = 250) {
        if (this._statusTimer !== null) {
          globalThis.clearTimeout(this._statusTimer);
          this._statusTimer = null;
        }
        if (delayMs <= 0) {
          this.updateStatusBar();
          return;
        }
        this._statusTimer = globalThis.setTimeout(() => {
          this._statusTimer = null;
          this.updateStatusBar();
        }, delayMs);
      }

      getActiveMarkdownFileAndText() {
        const view =
          typeof this.app.workspace.getActiveViewOfType === "function"
            ? this.app.workspace.getActiveViewOfType(MarkdownView)
            : null;
        if (view && view.file) {
          const editorText =
            view.editor && typeof view.editor.getValue === "function" ? view.editor.getValue() : null;
          return { file: view.file, editorText, view };
        }
        const activeFile =
          typeof this.app.workspace.getActiveFile === "function"
            ? this.app.workspace.getActiveFile()
            : null;
        if (activeFile && activeFile.extension === "md") {
          return { file: activeFile, editorText: null, view: null };
        }
        return { file: null, editorText: null, view: null };
      }

      resolveMarkdownFile(linkTarget, sourcePath, allFilesCache) {
        if (
          this.app.metadataCache &&
          typeof this.app.metadataCache.getFirstLinkpathDest === "function"
        ) {
          const dest = this.app.metadataCache.getFirstLinkpathDest(linkTarget, sourcePath);
          if (dest && dest.extension === "md") {
            return dest;
          }
        }
        const files = allFilesCache || this.app.vault.getMarkdownFiles();
        const resolvedPath = resolveLinkTarget(
          linkTarget,
          files.map((f) => f.path),
          sourcePath
        );
        if (!resolvedPath) {
          return null;
        }
        return files.find((f) => f.path === resolvedPath) || null;
      }

      async collectReachableNotesMap(rootFile, rootContent, depth) {
        const allFiles = this.app.vault.getMarkdownFiles();
        const notesMap = new Map();
        notesMap.set(rootFile.path, rootContent);

        const visited = new Set([rootFile.path]);
        const queue = [{ file: rootFile, content: rootContent, hop: 0 }];

        while (queue.length > 0) {
          const current = queue.shift();
          if (current.hop >= depth) {
            continue;
          }
          const links = extractWikiLinks(current.content);
          for (const link of links) {
            if (link.isSameNote || link.isAttachment) {
              continue;
            }
            if (link.isEmbed && !this.settings.includeEmbeds) {
              continue;
            }
            const targetFile = this.resolveMarkdownFile(link.target, current.file.path, allFiles);
            if (!targetFile || visited.has(targetFile.path)) {
              continue;
            }
            visited.add(targetFile.path);
            const content = await this.app.vault.cachedRead(targetFile);
            notesMap.set(targetFile.path, content);
            queue.push({ file: targetFile, content, hop: current.hop + 1 });
          }
        }

        return notesMap;
      }

      async computeActiveSnapshot() {
        const { file, editorText } = this.getActiveMarkdownFileAndText();
        if (!file) {
          return null;
        }
        const activeContent = editorText !== null ? editorText : await this.app.vault.cachedRead(file);
        const allFiles = this.app.vault.getMarkdownFiles();
        const links = extractWikiLinks(activeContent);
        const neighborMap = new Map();
        const linkedPaths = [];

        for (const link of links) {
          if (link.isSameNote || link.isAttachment) {
            continue;
          }
          if (link.isEmbed && !this.settings.includeEmbeds) {
            continue;
          }
          if (neighborMap.size >= MAX_STATUSBAR_NEIGHBORS) {
            break;
          }
          const dest = this.resolveMarkdownFile(link.target, file.path, allFiles);
          if (dest && dest.path !== file.path && !neighborMap.has(dest.path)) {
            const neighborText = await this.app.vault.cachedRead(dest);
            neighborMap.set(dest.path, neighborText);
            linkedPaths.push(dest.path);
          }
        }

        const metrics = measureActiveAndNeighbors(file.path, activeContent, neighborMap, {
          stripFrontmatter: this.settings.stripFrontmatter,
          stripComments: this.settings.stripComments,
        });

        const findings = scanText(activeContent, {
          includeSecrets: this.settings.redactSecrets,
          includePii: this.settings.redactPii,
          customAliases: this.settings.customAliases,
          respectIgnoreComments: true,
        });

        return {
          filePath: file.path,
          ...metrics,
          linkedPaths,
          findings,
        };
      }

      async updateStatusBar() {
        if (!this.statusBarEl) {
          return;
        }
        if (!this.settings.showStatusBar) {
          this.statusBarEl.setText("");
          return;
        }

        try {
          const snapshot = await this.computeActiveSnapshot();
          this._lastSnapshot = snapshot;
          if (!snapshot) {
            this.statusBarEl.setText("VaultLens: no active note");
            this.statusBarEl.removeClass("vaultlens-status-alert");
            return;
          }

          const label = formatStatusBarLabel({
            noteTokens: snapshot.noteTokens,
            linkedTokens: snapshot.linkedTokens,
            linkedNoteCount: snapshot.linkedNoteCount,
            modelId: this.settings.defaultModel,
            findingCount: snapshot.findings.length,
          });
          this.statusBarEl.setText(label);
          if (snapshot.findings.length > 0) {
            this.statusBarEl.addClass("vaultlens-status-alert");
          } else {
            this.statusBarEl.removeClass("vaultlens-status-alert");
          }
        } catch (_) {
          this.statusBarEl.setText("VaultLens: ready");
        }
      }

      async openContextInspector() {
        const snapshot = await this.computeActiveSnapshot();
        if (!snapshot) {
          new Notice("VaultLens: Open a Markdown note first to inspect its context.");
          return;
        }
        new ContextInspectorModal(this.app, this, snapshot).open();
      }

      async writeClipboard(text) {
        const cb = getClipboardApi();
        if (!cb || typeof cb.writeText !== "function") {
          return false;
        }
        try {
          await cb.writeText(text);
          return true;
        } catch (_) {
          return false;
        }
      }

      async readClipboard() {
        const cb = getClipboardApi();
        if (!cb || typeof cb.readText !== "function") {
          return null;
        }
        try {
          return await cb.readText();
        } catch (_) {
          return null;
        }
      }

      insertTextIntoActiveEditor(text) {
        const { view } = this.getActiveMarkdownFileAndText();
        if (!view || !view.editor) {
          return false;
        }
        if (typeof view.editor.replaceSelection === "function") {
          view.editor.replaceSelection(text);
          return true;
        }
        return false;
      }

      async copySafeContextBundle(depthOverride) {
        const { file, editorText } = this.getActiveMarkdownFileAndText();
        if (!file) {
          new Notice("VaultLens: Open a Markdown note first.");
          return null;
        }

        const activeContent = editorText !== null ? editorText : await this.app.vault.cachedRead(file);
        const depth =
          depthOverride !== undefined ? depthOverride : Number(this.settings.linkDepth ?? 1);
        const notesMap = await this.collectReachableNotesMap(file, activeContent, depth);

        const bundle = buildContextBundle(file.path, notesMap, {
          depth,
          includeEmbeds: this.settings.includeEmbeds,
          stripFrontmatter: this.settings.stripFrontmatter,
          stripComments: this.settings.stripComments,
          maxTokens: this.settings.maxTokenBudget,
          format: this.settings.bundleFormat,
          redactionVault: this.redactionVault,
          redactSecrets: this.settings.redactSecrets,
          redactPii: this.settings.redactPii,
          customAliases: this.settings.customAliases,
        });

        const copied = await this.writeClipboard(bundle.bundleText);
        const cost = calculateModelCost(bundle.bundleTokens, this.settings.defaultModel);
        const noteCount = bundle.includedNotes.length;
        const redacted = bundle.redactionSummary.redactedCount;
        const truncNote = bundle.budgetExceeded ? " (budget capped)" : "";

        if (copied) {
          new Notice(
            `VaultLens: Copied ${noteCount} note(s) (~${formatTokenCount(bundle.bundleTokens)} tok · ${formatUsd(cost.inputCostUsd)} on ${cost.modelName}) · ${redacted} item(s) redacted${truncNote}.`
          );
        } else {
          new Notice("VaultLens: Context bundle generated, but clipboard access was unavailable.");
        }
        return bundle;
      }

      async pasteAndRestoreIntoActiveNote() {
        const { view } = this.getActiveMarkdownFileAndText();

        // If user selected text containing placeholders in active editor, restore selection directly
        if (view && view.editor && typeof view.editor.getSelection === "function") {
          const selected = view.editor.getSelection();
          if (selected && selected.length > 0) {
            const selRes = this.redactionVault.restore(selected);
            if (selRes.replacedCount > 0) {
              view.editor.replaceSelection(selRes.restoredText);
              new Notice(
                `VaultLens: Restored ${selRes.replacedCount} placeholder(s) in current selection.`
              );
              return selRes;
            }
          }
        }

        const clipText = await this.readClipboard();
        if (clipText === null || clipText.length === 0) {
          new RestoreReplyModal(this.app, this, "").open();
          return null;
        }

        const res = this.redactionVault.restore(clipText);
        const inserted = this.insertTextIntoActiveEditor(res.restoredText);
        if (inserted) {
          new Notice(
            `VaultLens: Restored ${res.replacedCount} placeholder(s) and inserted into active note.`
          );
        } else {
          new RestoreReplyModal(this.app, this, clipText).open();
        }
        return res;
      }

      async verifyCurrentLicense() {
        return verifyLicenseKey(
          this.settings.licenseKey,
          this._publicKeyJwk ? { publicKeyJwk: this._publicKeyJwk } : {}
        );
      }

      async writeOrUpdateVaultFile(targetPath, content) {
        const normalized = normalizePath(targetPath);
        const existing = this.app.vault.getAbstractFileByPath(normalized);
        if (existing) {
          await this.app.vault.modify(existing, content);
          return existing;
        }
        return this.app.vault.create(normalized, content);
      }

      async runProVaultAudit() {
        const verification = await this.verifyCurrentLicense();
        if (!verification.valid) {
          new ProUpgradeModal(
            this.app,
            this,
            "Vault-Wide Token Heatmap & Broken Wikilink Audit",
            verification
          ).open();
          return null;
        }

        const outPath = normalizePath(this.settings.auditOutputPath || "VaultLens-Audit-Report.md");
        const mdFiles = this.app.vault.getMarkdownFiles();
        const notes = [];
        for (const f of mdFiles) {
          if (normalizeVaultPath(f.path) === normalizeVaultPath(outPath)) {
            continue;
          }
          const content = await this.app.vault.cachedRead(f);
          notes.push({ path: f.path, content, mtime: f.stat?.mtime || 0 });
        }

        const audit = auditVault(notes, {
          stripFrontmatter: this.settings.stripFrontmatter,
          stripComments: this.settings.stripComments,
          customAliases: this.settings.customAliases,
          excludePaths: [outPath],
        });
        const reportMd = renderVaultAuditMarkdown(audit, {
          defaultModelId: this.settings.defaultModel,
        });
        const reportFile = await this.writeOrUpdateVaultFile(outPath, reportMd);

        if (this.app.workspace && typeof this.app.workspace.getLeaf === "function") {
          const leaf = this.app.workspace.getLeaf(false);
          if (leaf && typeof leaf.openFile === "function") {
            await leaf.openFile(reportFile);
          }
        }

        new Notice(
          `VaultLens Pro Audit complete: ${audit.summary.noteCount} notes · ${formatTokenCount(audit.summary.totalTokens)} tok · ${audit.summary.brokenLinkCount} broken links · ${audit.summary.orphanCount} orphans.`
        );
        return { audit, reportPath: outPath, reportMd };
      }

      async openProBatchJsonlExport() {
        const verification = await this.verifyCurrentLicense();
        if (!verification.valid) {
          new ProUpgradeModal(
            this.app,
            this,
            "Batch Safe-Export Folder to RAG JSONL",
            verification
          ).open();
          return;
        }
        const { file } = this.getActiveMarkdownFileAndText();
        const defaultFolder = file && file.parent && file.parent.path !== "/" ? file.parent.path : "";
        new JsonlExportModal(this.app, this, defaultFolder).open();
      }

      async executeProBatchJsonlExport(folderPrefix = "", chunkMaxTokens = 800) {
        const verification = await this.verifyCurrentLicense();
        if (!verification.valid) {
          new ProUpgradeModal(
            this.app,
            this,
            "Batch Safe-Export Folder to RAG JSONL",
            verification
          ).open();
          return null;
        }

        const normPrefix = normalizeVaultPath(folderPrefix).replace(/\/+$/, "");
        const mdFiles = this.app.vault.getMarkdownFiles().filter((f) => {
          const np = normalizeVaultPath(f.path);
          if (!normPrefix) return true;
          return np === normPrefix || np.startsWith(`${normPrefix}/`);
        });

        const notes = [];
        for (const f of mdFiles) {
          const content = await this.app.vault.cachedRead(f);
          notes.push({ path: f.path, content });
        }

        const exported = exportFolderToRagJsonl(notes, {
          folderPrefix: normPrefix,
          chunkMaxTokens,
          stripComments: this.settings.stripComments,
          redactSecrets: this.settings.redactSecrets,
          redactPii: this.settings.redactPii,
          customAliases: this.settings.customAliases,
          redactionVault: this.redactionVault,
        });

        const slug = normPrefix ? normPrefix.replace(/[^A-Za-z0-9_-]+/g, "-") : "vault";
        const outPath = normalizePath(`VaultLens-RAG-Export-${slug}.jsonl`);
        await this.writeOrUpdateVaultFile(outPath, exported.jsonl);

        new Notice(
          `VaultLens Pro RAG JSONL exported to ${outPath}: ${exported.recordCount} chunks from ${exported.noteCount} note(s) · ${exported.totalRedactions} item(s) redacted.`
        );
        return { ...exported, outputPath: outPath };
      }
    }

    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = VaultLensPlugin;
    exports.VaultLensPlugin = VaultLensPlugin;
    exports.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  }
};

var __vaultlensCache = Object.create(null);

function __vaultlensResolve(fromId, spec) {
  if (!spec || spec.charAt(0) !== ".") {
    return spec;
  }
  var baseParts = fromId.split("/").slice(0, -1);
  var specParts = spec.split("/");
  for (var i = 0; i < specParts.length; i += 1) {
    var part = specParts[i];
    if (!part || part === ".") continue;
    if (part === "..") {
      baseParts.pop();
    } else {
      baseParts.push(part);
    }
  }
  var joined = baseParts.join("/");
  if (!joined.endsWith(".js")) {
    joined += ".js";
  }
  return joined;
}

function __vaultlensRequire(fromId, spec) {
  var resolved = __vaultlensResolve(fromId, spec);
  if (Object.prototype.hasOwnProperty.call(__vaultlensModules, resolved)) {
    if (__vaultlensCache[resolved]) {
      return __vaultlensCache[resolved].exports;
    }
    var mod = { exports: {} };
    __vaultlensCache[resolved] = mod;
    __vaultlensModules[resolved](mod, mod.exports, function(childSpec) {
      return __vaultlensRequire(resolved, childSpec);
    });
    return mod.exports;
  }
  return __vaultlensHostRequire(resolved);
}

module.exports = __vaultlensRequire("", "src/plugin.js");
