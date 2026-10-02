/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // This app has no optimized images; keep the unused public optimizer disabled.
  images: { unoptimized: true },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
      ],
    }];
  },
  // Keep native SQLite bindings external in both development and production.
  serverExternalPackages: ["@libsql/client", "libsql", "node-cron"],
  experimental: {
    // Use the established TypeScript API while native CLI integration is experimental.
    useTypeScriptCli: false,
  },
};

module.exports = nextConfig;
