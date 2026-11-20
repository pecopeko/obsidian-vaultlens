#!/usr/bin/env node
/**
 * Zero-dependency deterministic CommonJS bundler for VaultLens Obsidian Plugin.
 * Compiles src/core/* + src/plugin.js into a single mobile-safe main.js consuming ONLY require("obsidian").
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

const MODULE_ORDER = [
  "src/core/tokenizer.js",
  "src/core/redactor.js",
  "src/core/graph.js",
  "src/core/license.js",
  "src/core/vault_auditor.js",
  "src/plugin.js",
];

const FORBIDDEN_REQUIRES = new Set([
  "fs",
  "path",
  "crypto",
  "os",
  "child_process",
  "http",
  "https",
  "net",
  "tls",
  "zlib",
  "stream",
  "url",
  "util",
  "buffer",
  "worker_threads",
  "vm",
]);

function normalizeModuleId(fromId, spec) {
  if (!spec.startsWith(".")) {
    return spec;
  }
  const baseParts = fromId.split("/").slice(0, -1);
  const specParts = spec.split("/");
  for (const part of specParts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      baseParts.pop();
    } else {
      baseParts.push(part);
    }
  }
  let joined = baseParts.join("/");
  if (!joined.endsWith(".js")) {
    joined += ".js";
  }
  return joined;
}

function validateModuleSafety(modId, source) {
  // Check require(...) calls
  const reqRe = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
  let m;
  while ((m = reqRe.exec(source)) !== null) {
    const spec = m[1];
    if (spec.startsWith("node:") || FORBIDDEN_REQUIRES.has(spec)) {
      throw new Error(`Mobile-incompatible Node built-in require("${spec}") found in ${modId}`);
    }
    if (!spec.startsWith(".") && spec !== "obsidian") {
      throw new Error(`Unexpected external dependency require("${spec}") found in ${modId}`);
    }
  }

  // Ensure no Node globals or unsafe DOM APIs sneak into mobile bundle
  const forbiddenPatterns = [
    { name: "Buffer global", re: /\bBuffer\.(?:from|alloc|byteLength|concat)\b/ },
    { name: "process global", re: /\bprocess\.(?:env|cwd|platform|versions|exit)\b/ },
    { name: "innerHTML/outerHTML", re: /\.(?:innerHTML|outerHTML)\s*=/ },
    { name: "private JWK d parameter", re: /["']d["']\s*:\s*["'][A-Za-z0-9_-]{20,}["']/ },
    {
      name: "PEM private key",
      re: new RegExp("-----BEGIN (?:RSA |EC |OPENSSH )?" + "PRIVATE KEY-----"),
    },
  ];
  for (const rule of forbiddenPatterns) {
    if (rule.re.test(source)) {
      throw new Error(`Build safety guard tripped (${rule.name}) in ${modId}`);
    }
  }
}

function validateManifests() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "manifest.json"), "utf8"));
  const versions = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "versions.json"), "utf8"));

  if (manifest.isDesktopOnly !== false) {
    throw new Error("manifest.json must set isDesktopOnly: false");
  }
  if (!versions[manifest.version]) {
    throw new Error(`versions.json is missing entry for manifest version ${manifest.version}`);
  }
  if (versions[manifest.version] !== manifest.minAppVersion) {
    throw new Error(
      `versions.json[${manifest.version}] (${versions[manifest.version]}) !== manifest.minAppVersion (${manifest.minAppVersion})`
    );
  }
  return manifest;
}

export function buildBundle() {
  const manifest = validateManifests();
  const knownIds = new Set(MODULE_ORDER);
  const moduleEntries = [];

  for (const modId of MODULE_ORDER) {
    const absPath = path.join(ROOT_DIR, modId);
    const source = fs.readFileSync(absPath, "utf8");
    validateModuleSafety(modId, source);

    // Verify all local requires exist in MODULE_ORDER
    const reqRe = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
    let m;
    while ((m = reqRe.exec(source)) !== null) {
      const spec = m[1];
      if (spec.startsWith(".")) {
        const resolved = normalizeModuleId(modId, spec);
        if (!knownIds.has(resolved)) {
          throw new Error(`Unresolved local module "${spec}" -> "${resolved}" in ${modId}`);
        }
      }
    }

    const indented = source
      .replace(/\r\n/g, "\n")
      .trimEnd()
      .split("\n")
      .map((line) => (line.length > 0 ? `    ${line}` : ""))
      .join("\n");

    moduleEntries.push(
      `  ${JSON.stringify(modId)}: function(module, exports, require) {\n${indented}\n  }`
    );
  }

  const bundle = `/*
 * ${manifest.name} (${manifest.id}) v${manifest.version}
 * Generated deterministically by scripts/build_bundle.mjs — zero external runtime dependencies.
 * Desktop & Mobile compatible (isDesktopOnly: false, Web Crypto ES256 offline license verification).
 */
"use strict";

var __vaultlensHostRequire = require;

var __vaultlensModules = {
${moduleEntries.join(",\n\n")}
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
`;

  const outPath = path.join(ROOT_DIR, "main.js");
  fs.writeFileSync(outPath, bundle, "utf8");
  const stat = fs.statSync(outPath);
  return { outPath, bytes: stat.size, modules: MODULE_ORDER.length };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const res = buildBundle();
  console.log(
    `Built ${path.relative(ROOT_DIR, res.outPath)} (${res.bytes.toLocaleString("en-US")} bytes, ${res.modules} modules, 0 external deps)`
  );
}
