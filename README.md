# VaultLens Context Shield

**Privacy-first AI context bundler, live wikilink token & cost meter, and reversible PII/secret vault for Obsidian (Desktop & Mobile).**

Stop leaking client names, emails, Japanese MyNumbers, or API keys when pasting notes into ChatGPT, Claude, or Gemini — and stop guessing how many tokens your linked notes will cost before hitting send.

- **100% Local & Offline**: Zero cloud telemetry, zero external API calls, zero runtime dependencies.
- **Desktop & Mobile (`isDesktopOnly: false`)**: Runs identically on macOS, Windows, Linux, iOS, and Android using standard Web APIs and Web Crypto (`ES256`).
- **Instant Reversible Redaction**: Redacts PII, secrets, and custom client/project aliases into clean placeholders (`[[PII_EMAIL_1]]`, `[[ALIAS_1]]`, `[[SECRET_AWS_1]]`) and restores AI replies locally in one click.

---

## Free Features (Daily Utility — Forever Free)

1. **Live Status Bar Token & Cost Meter**
   - Displays active note tokens + 1-hop `[[wikilink]]` neighbor tokens + real-time input cost across 6 frontier models (`GPT-5`, `Claude Sonnet 4`, `Gemini 2.5 Pro`, `GPT-4o mini`, `Claude Haiku 4.5`, `Gemini 2.5 Flash`).
   - Calibrated for **English, Markdown, source code, Japanese (Hiragana/Katakana/Kanji), CJK, Hangul, and Emoji**.
   - Click the status bar item anytime to open the **Context & Token Inspector** modal with a 6-model cost comparison and masked PII/secret findings.
2. **Safe AI Context Bundler (`Copy note + linked notes safely`)**
   - Expands **0-hop, 1-hop, or 2-hop** `[[wikilinks]]` and `![[embeds]]` (including `![[Note#Heading]]` section embeds) with automatic **cycle detection** (`A -> B -> A`).
   - Strips YAML frontmatter and private Obsidian `%%comments%%` (while preserving `%%` inside fenced code blocks).
   - Enforces a configurable **max token budget** with clean boundary truncation so you never exceed context limits.
   - Outputs structured **XML (`<vaultlens_context>`)** or **Markdown fenced** packs straight to your clipboard.
3. **Reversible PII, Secret & Custom Alias Shield + AI Reply Restore**
   - Detects & masks:
     - **Secrets**: AWS Access/Secret Keys, OpenAI & Anthropic API keys, GitHub tokens, Slack tokens/webhooks, Stripe keys, JWTs, PEM private keys, database URLs with credentials, and hardcoded `API_KEY`/`DB_PASSWORD` assignments.
     - **PII**: Emails, JP/US/International phone numbers, IPv4 addresses, and **Japanese Individual Numbers (MyNumber)** verified via MIC Mod-11 check digit (supports full-width digits and hyphens).
     - **Custom Client & Project Aliases**: Add sensitive terms in Settings (e.g. `Project Phoenix`, `Acme Holdings`, `株式会社ミライ`) -> automatically mapped to `[[ALIAS_1]]`, `[[ALIAS_2]]` (or custom labels like `Project Phoenix => CLIENT_A` -> `[[ALIAS_CLIENT_A_1]]`).
   - **One-Click Restore (`Paste / restore redacted tokens into active note`)**: Restores placeholders in an AI response back to exact original values from the in-memory session vault (safely handles `$&` / `$1` inside passwords). Includes an interactive Restore Modal for mobile devices where clipboard read permissions may be restricted.

---

## VaultLens Pro (Offline `ES256` License — Zero Subscription Lock-In)

Verified **100% offline** using Web Crypto **ECDSA P-256 (`ES256`)** — works air-gapped on Desktop, iOS, and Android with zero license server calls.

1. **Pro: Vault-Wide Token Heatmap & Broken Wikilink Audit**
   - Scans your entire Markdown vault locally and generates `VaultLens-Audit-Report.md` with:
     - Full-vault RAG input cost matrix across all 6 frontier models
     - Folder-level token heatmap with inline bar charts
     - Top heaviest notes ranking with clickable `[[wikilinks]]`
     - Orphan notes & broken `[[wikilinks]]` audit tables
     - Masked privacy & secret exposure hotspots (zero raw secrets written to disk!)
2. **Pro: Batch Safe-Export Folder to RAG JSONL**
   - Exports any folder (or your entire vault) to heading-aware, token-bounded, frontmatter-enriched, **PII-redacted JSONL** locally inside your vault — ready for local embeddings, vector databases, or fine-tuning pipelines.

Support development & unlock Pro via **[GitHub Sponsors](https://github.com/sponsors/pecopeko)**.

---

## Installation

### Option 1: Install Instantly via BRAT (Beta Reviewers Auto-update Tester)
1. Install the community plugin **BRAT** in Obsidian (`Settings -> Community plugins -> Browse -> BRAT`).
2. Open **BRAT Settings -> Add Beta plugin**.
3. Enter: `https://github.com/pecopeko/obsidian-vaultlens`
4. Enable **VaultLens AI Context & PII Shield** in `Settings -> Community plugins`.

### Option 2: Manual Install from GitHub Releases
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [GitHub Release (`1.0.0`)](https://github.com/pecopeko/obsidian-vaultlens/releases/tag/1.0.0).
2. Copy all 3 files into `<YourVault>/.obsidian/plugins/vaultlens-ai-context/`.
3. Reload Obsidian and enable **VaultLens AI Context & PII Shield**.

---

## Commands

| Command | Tier | Description |
| :--- | :---: | :--- |
| `Copy note + linked notes safely (redact PII & secrets)` | Free | Bundle active note + configured wikilink depth, redact locally, copy to clipboard |
| `Copy note + 1-hop links safely (redact PII & secrets)` | Free | Quick 1-hop safe context bundle |
| `Copy note + 2-hop links safely (redact PII & secrets)` | Free | Quick 2-hop safe context bundle |
| `Paste / restore redacted tokens into active note` | Free | Restore `[[PII_*]]` / `[[SECRET_*]]` / `[[ALIAS_*]]` in selection or clipboard |
| `Open interactive AI reply restore modal` | Free | Paste & preview placeholder restoration (ideal for iOS/Android) |
| `Inspect active note tokens, links & PII findings` | Free | Open live 6-model cost matrix and masked findings inspector |
| `Clear in-memory PII redaction session vault` | Free | Immediately wipe in-memory placeholder mappings |
| `Pro: vault-wide token heatmap & broken wikilink audit` | Pro | Generate complete Markdown vault audit & heatmap report |
| `Pro: batch safe-export folder to RAG JSONL` | Pro | Export folder into sanitized, heading-chunked RAG JSONL |

---

## Development & Verification

Zero external dependencies (`npm install` is not even needed — runs directly on Node.js >= 20):

```bash
# Build deterministic mobile-safe main.js bundle from src/core/* + src/plugin.js
npm run build

# Run full Node.js native test suite (including mocked Obsidian plugin lifecycle against built main.js)
npm test
```

## Privacy & Security Guarantee

- **Zero network requests**: VaultLens makes zero HTTP requests anywhere in `main.js`.
- **Session-only PII vault**: Redaction mappings live strictly in memory and are cleared automatically on plugin unload or manual clear.
- **Zero raw secrets written to disk**: Audit reports display only masked previews (e.g., `AKIA••••7890`).

## License

MIT — see [LICENSE](./LICENSE).
