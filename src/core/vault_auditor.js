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
