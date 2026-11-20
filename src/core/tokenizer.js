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
