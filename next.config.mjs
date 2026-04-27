/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Prevent Next.js file-tracing from pulling the Electron build directory
  // (electron-app/dist/, electron-app/resources/, etc.) into the standalone
  // output. Without this, a previous Electron build adds ~18,000 files to the
  // nextapp bundle, causing macOS "Preparing to copy" to stall for minutes.
  outputFileTracingExcludes: {
    "**": [
      "electron-app/**/*",
      ".claude/**/*",
      "calibration/**/*",
      "docs/**/*",
    ],
  },
}

export default nextConfig
