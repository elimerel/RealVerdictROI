#!/usr/bin/env node
/**
 * Copies the Next.js standalone build output into electron-app/resources/nextapp/
 * so electron-builder can include it as extraResources.
 *
 * Next.js standalone layout after `next build`:
 *   .next/standalone/   ← self-contained server + trimmed node_modules
 *   .next/static/       ← must be copied to <standalone>/.next/static/
 *   public/             ← must be copied to <standalone>/public/
 */

const { cpSync, mkdirSync, rmSync, existsSync } = require("fs")
const path = require("path")

// Support REPO_ROOT env var for builds where the Next.js standalone was built
// from a different directory (e.g. parent repo when using git worktrees).
const repoRoot = process.env.REPO_ROOT
  ? path.resolve(process.env.REPO_ROOT)
  : path.resolve(__dirname, "..", "..")
const standaloneDir = path.join(repoRoot, ".next", "standalone")

if (!existsSync(standaloneDir)) {
  console.error(
    "[copy-next] ERROR: .next/standalone not found.\n" +
      "  Run `npm run build:next` first (requires ELECTRON_BUILD=1 in next.config.ts)."
  )
  process.exit(1)
}

const dest = path.resolve(__dirname, "..", "resources", "nextapp")

// Clean slate
rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })

// 1. Copy the standalone server bundle
console.log("[copy-next] Copying .next/standalone → resources/nextapp/ …")
cpSync(standaloneDir, dest, { recursive: true })

// 2. Copy static assets (not included in standalone by default)
const staticSrc = path.join(repoRoot, ".next", "static")
const staticDest = path.join(dest, ".next", "static")
console.log("[copy-next] Copying .next/static → resources/nextapp/.next/static/ …")
mkdirSync(path.join(dest, ".next"), { recursive: true })
cpSync(staticSrc, staticDest, { recursive: true })

// 3. Copy public/ (same)
const publicSrc = path.join(repoRoot, "public")
if (existsSync(publicSrc)) {
  console.log("[copy-next] Copying public/ → resources/nextapp/public/ …")
  cpSync(publicSrc, path.join(dest, "public"), { recursive: true })
}

console.log("[copy-next] Done. Resources ready at electron-app/resources/nextapp/")
