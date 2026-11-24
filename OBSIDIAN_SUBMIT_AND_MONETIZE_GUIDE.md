# VaultLens — 5-Minute `$0.00` Obsidian Submission, BRAT Install & Pro Monetization Guide

This guide takes **`VaultLens AI Context & PII Shield` (`1.0.0`)** from your public GitHub Release to **instant BRAT installs**, **official Obsidian Community Plugin directory listing (`$0.00`)**, and **`$0.00`-backend Pro license revenue** via Gumroad, Lemon Squeezy, or GitHub Sponsors.

---

## Step 1: Test & Share via BRAT Today (1 Minute — Already Live!)

Obsidian's **BRAT** plugin installs directly from your GitHub Release `1.0.0` (`main.js`, `manifest.json`, `styles.css` — note the tag is **`1.0.0`** with **no `v` prefix**, matching `manifest.json`).

1. Open Obsidian -> **Settings -> Community plugins -> Browse -> BRAT** -> Install & Enable.
2. Open **BRAT -> Add Beta plugin**.
3. Paste: `https://github.com/pecopeko/obsidian-vaultlens`
4. Click **Add Plugin** -> enable **VaultLens AI Context & PII Shield**!

You can immediately share the BRAT install link on r/ObsidianMD, Obsidian Forum ("Share & Showcase"), Hacker News, and X/Twitter while your official directory PR is reviewed.

---

## Step 2: Submit to the Official Obsidian Community Directory (`$0.00`)

Getting listed in Obsidian's built-in **Community Plugins** browser costs **$0.00** and exposes your plugin to millions of Obsidian Desktop & Mobile users.

> **2026 Platform Note**: `obsidianmd/obsidian-releases` now mirrors `https://community.obsidian.md/assets/community-plugins.json` hourly via GitHub Actions (`.github/workflows/mirror-community-json.yml`), and new plugin submissions go through the **[Obsidian Community Developer Dashboard](https://community.obsidian.md)** rather than manual GitHub PRs on `obsidian-releases`.

### Pre-Submission Checklist (Already Verified in `1.0.0`)
- [x] `manifest.json` uses valid `id` (`"vaultlens-ai-context"`), `version` (`"1.0.0"`), `minAppVersion` (`"1.5.0"`), `author` (`"peco"`), `isDesktopOnly: false`, and `description` <= 250 chars with no trailing period or "Obsidian" redundancy.
- [x] `versions.json` exists at repo root with `{"1.0.0": "1.5.0"}`.
- [x] GitHub Release tag is **`1.0.0`** (NO leading `v`) with exact 3 assets attached: `main.js`, `manifest.json`, `styles.css`.
- [x] Zero Node.js built-ins (`fs`, `path`, `crypto`, `Buffer`) and zero `innerHTML` usage inside `main.js` (100% iOS/Android mobile-safe).
- [x] `LICENSE` (MIT) and clear `README.md` at repo root.
- [x] All settings headings use `new Setting(containerEl).setName(...).setHeading()` and sentence case.

### Submit via Obsidian Community Developer Dashboard (2 Minutes)
1. Sign in to **`https://community.obsidian.md`** with your Obsidian account and connect your GitHub account (`pecopeko`).
2. Open **Developer Dashboard -> Plugins -> New plugin**.
3. Enter repository URL: **`https://github.com/pecopeko/obsidian-vaultlens`** (`author: "peco"`, `id: "vaultlens-ai-context"`).
4. Agree to Developer Policies and click **Submit** — automated validation checks your `manifest.json`, `versions.json`, Release `1.0.0` assets, and mobile-safe `main.js` bundle, and once approved the hourly mirror publishes this entry to `community-plugins.json`:

```json
  {
    "id": "vaultlens-ai-context",
    "name": "VaultLens AI Context & PII Shield",
    "author": "peco",
    "description": "Measure note and wikilink token costs, bundle linked Markdown context with local PII redaction, and audit vault health offline",
    "repo": "pecopeko/obsidian-vaultlens"
  }
```

---

## Step 3: Rotate Your Creator ES256 Private Key Before Selling Pro Keys (1 Minute)

Before fulfilling paid Pro licenses, generate your personal **ECDSA P-256 (`ES256`)** issuer keypair stored strictly **outside** git:

```bash
node tools/keygen.mjs init --out ~/.vaultlens/issuer.es256.private.jwk
```

1. Store `~/.vaultlens/issuer.es256.private.jwk` safely in your password manager (1Password / Bitwarden). **Never commit it to git.**
2. Paste the printed public-only JWK (`{ kty, crv, x, y }` — no `d` field!) into `DEFAULT_PUBLIC_KEY_JWK` in `src/core/license.js`.
3. Rebuild, verify tests, and cut Release `1.0.1` (updating `manifest.json` + `versions.json` to `1.0.1`):

```bash
npm run verify
```

---

## Step 4: `$0.00`-Backend Pro License Fulfillment (Gumroad / Lemon Squeezy / GitHub Sponsors)

Because VaultLens Pro verifies **ECDSA P-256 (`ES256`)** signatures **100% offline via Web Crypto** on Desktop, iOS, and Android, your ongoing backend infrastructure cost is **$0.00/month**.

### Recommended Pricing Ladder
- **Pro Monthly**: `$7/month` (`--plan pro-monthly --expires 2027-01-01T00:00:00Z`)
- **Pro Lifetime**: `$29 one-time` (`--plan pro-lifetime`) — highest conversion among Obsidian PKM power users!
- **Team / Lab (10 seats)**: `$129 one-time` (`--plan team --seats 10`)

### Mint a Key Locally (Day 1 — Zero Server Code)

```bash
node tools/keygen.mjs sign \
  --key ~/.vaultlens/issuer.es256.private.jwk \
  --email researcher@university.edu \
  --plan pro-lifetime
```

Verify any minted key offline:

```bash
node tools/keygen.mjs verify \
  --key ~/.vaultlens/issuer.es256.private.jwk \
  --license "VLPRO-..."
```

### Zero-Cost Automated Delivery Channels
1. **Gumroad Pre-Generated Key Pool (`$0.00` monthly fee, zero code)**:
   - Pre-mint 200 `pro-lifetime` keys (each with a unique `id`) and paste them into Gumroad's built-in **"Upload your own license keys"** option. Gumroad emails one key per buyer automatically!
2. **Gumroad / Lemon Squeezy Webhook -> Free Cloudflare Worker**:
   - Store your private JWK in a Cloudflare Worker Secret (`wrangler secret put VL_ES256_PRIVATE_JWK`) on the free tier (`100,000 req/day`, `$0.00`).
   - Because Cloudflare Workers natively implement `crypto.subtle` (`ECDSA` / `P-256` / `SHA-256`), the exact same 15-line Web Crypto signing code mints personalized `VLPRO-...` keys on every sale webhook!
3. **GitHub Sponsors (Already Linked in `manifest.json` `"fundingUrl"`)**:
   - Obsidian natively renders a **"Support"** heart button next to your plugin linking directly to `https://github.com/sponsors/pecopeko`.
   - Offer a `$29 one-time` or `$7/mo` sponsor tier and include a freshly minted `VLPRO-...` key in your sponsor welcome reply.
