/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@frontdesk/types"],
  // Disable built-in ESLint during `next build`. Linting is handled
  // separately by the root `pnpm lint` script (CI: Lint step).
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Disable outputFileTracing to prevent write-lock errors on Windows/OneDrive
  outputFileTracing: false,
};

module.exports = nextConfig;
