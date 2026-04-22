import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
    return config;
  },
};

export default withPWA(nextConfig);
