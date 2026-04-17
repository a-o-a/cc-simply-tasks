/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // app router is stable in 13.5, no flag needed
    instrumentationHook: true,
    // Avoid bundling libsql native packages into the RSC/server build.
    serverComponentsExternalPackages: ["@libsql/client", "libsql"],
  },
};

module.exports = nextConfig;
