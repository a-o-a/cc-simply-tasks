/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep the SQLite native driver in the Node.js runtime.
  serverExternalPackages: ["@libsql/client", "libsql"],
  // Databases, backups and local environment files belong to the deployment,
  // not the application bundle (including a future standalone deployment).
  outputFileTracingExcludes: {
    "**/*": ["./db/**/*", "./.env*", "./.claude/**/*"],
  },
};

module.exports = nextConfig;
