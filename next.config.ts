import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Kill the floating Next.js dev indicator — it overlaps the Electron sidebar
  devIndicators: false,
  // When building for Electron we need the self-contained standalone server.
  // ELECTRON_BUILD=1 is set by electron-app/package.json's build:next script.
  output: "standalone",
  // Silence the "multiple lockfiles" warning caused by the git worktree setup
  // and pin Turbopack's module resolution to this project directory.
  outputFileTracingRoot: path.resolve(__dirname),
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Next.js 16 blocks cross-origin requests to /_next/* dev resources by
  // default. Our Electron shell loads pages from localhost:3000 (matched to
  // Supabase's default OAuth callback host), but legacy launches from
  // 127.0.0.1 or LAN IPs should still succeed during dev. Allow them all.
  allowedDevOrigins: ["localhost", "127.0.0.1", "192.168.1.146"],
};

export default nextConfig;
