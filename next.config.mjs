import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  runtimeCaching: [
    { urlPattern: /\/(?:setup\.sh|installer\/setup\.sh|llms\.txt|\.well-known\/)/, handler: "NetworkOnly", method: "GET" },
    // Authenticated data must never come from a previous session's SW cache.
    { urlPattern: /\/api\//, handler: "NetworkOnly", method: "GET" },
    ...require("next-pwa/cache"),
  ],
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() { return ["/setup.sh", "/installer/setup.sh", "/llms.txt"].map(source => ({ source, headers: [{ key: "Content-Type", value: "text/plain; charset=utf-8" }, { key: "Cache-Control", value: "public, max-age=0, must-revalidate" }, { key: "X-Content-Type-Options", value: "nosniff" }] })); },
  // Avoid EMFILE: too many open files on some macOS setups (watchers exhaust
  // `ulimit -n`). Polling is slightly slower but far fewer file descriptors.
  // Raise limits if you prefer fast native watch: `ulimit -n 10240` in the shell.
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        poll: 2_000,
        aggregateTimeout: 500,
      };
    }
    // The /api/mcp route imports the CLI's TypeScript sources (cli/src),
    // which use NodeNext-style `.js` import specifiers for sibling `.ts`
    // files. Teach webpack to resolve them the way tsc/vite/tsup already do.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".jsx": [".tsx", ".jsx"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
      ...config.resolve.extensionAlias,
    };
    return config;
  },
};

export default withPWA(nextConfig);
