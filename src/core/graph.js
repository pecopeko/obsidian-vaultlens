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
