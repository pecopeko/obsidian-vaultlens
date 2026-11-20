# Changelog

All notable changes to **VaultLens AI Context & PII Shield** will be documented in this file.

## [1.0.0] - 2026-11-20

### Added
- **Live Status Bar Token & Cost Meter**: Displays active note tokens, 1-hop `[[wikilink]]` neighbor tokens, estimated API input cost across 6 frontier models (`GPT-5`, `Claude Sonnet 4`, `Gemini 2.5 Pro`, `GPT-4o mini`, `Claude Haiku 4.5`, `Gemini 2.5 Flash`), and sensitive finding alerts.
- **Safe AI Context Bundler**: Expands 0-hop, 1-hop, or 2-hop `[[wikilinks]]` and `![[embeds]]` with cycle detection, configurable token budget truncation, YAML frontmatter stripping, and `%%comment%%` stripping, emitting clean XML or Markdown context packs straight to clipboard.
- **Reversible Local PII, Secret & Custom Alias Shield**: Redacts emails, phone numbers, AWS/GitHub/OpenAI/Anthropic/Slack/Stripe keys, JWTs, PEM blocks, database URLs, IPv4 addresses, Japanese MyNumber (Mod-11 verified, full-width/half-width), and user-defined confidential project/client aliases (`Project Phoenix` -> `[[ALIAS_1]]`) into an in-memory session vault with one-click AI reply restoration (`$&`/`$1`-safe).
- **100% Desktop & Mobile Ready (`isDesktopOnly: false`)**: Zero Node.js built-ins and zero external runtime npm packages; runs natively on macOS, Windows, Linux, iOS, and Android.
- **VaultLens Pro (Offline Web Crypto `ES256` License)**:
  - **Vault-Wide Token Heatmap & Broken Wikilink Audit**: Generates a Markdown dashboard note ranking heaviest notes, total vault RAG cost across 6 frontier models, folder token heatmap, orphan notes, broken `[[wikilinks]]`, and masked privacy hotspots.
  - **Batch Safe-Export Folder to RAG JSONL**: Exports any folder (or the full vault) into heading-aware, sanitized, frontmatter-enriched JSONL chunks inside the vault.
