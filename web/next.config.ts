import type { NextConfig } from "next";
import { outsideProxyHeaderRules } from "./lib/guard/headers";

// cacheComponents / partialPrefetching (create-next-app 16.4 defaults) are left off on purpose:
// almost every page here reads the per-session cookie and live in-memory data, so the classic
// "dynamic when you read cookies()" model is simpler for the module builders.
const nextConfig: NextConfig = {
  // C2 track L: the 3.4 response headers on the paths the proxy's matcher leaves out (lib/guard/headers.ts); every
  // other path gets them from the proxy
  headers: async () => outsideProxyHeaderRules(),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
