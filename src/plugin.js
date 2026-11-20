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
