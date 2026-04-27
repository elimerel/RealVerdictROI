import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // When building for Electron we need the self-contained standalone server.
  // ELECTRON_BUILD=1 is set by electron-app/package.json's build:next script.
  output: process.env.ELECTRON_BUILD === "1" ? "standalone" : undefined,
  // Silence the "multiple lockfiles" warning caused by the git worktree setup.
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
