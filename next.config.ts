/** @type {import('next').NextConfig} */
const nextConfig = {
  // NEW name in Next 15+
  serverExternalPackages: ["@solana/web3.js", "@solana/spl-token", "mongoose"],

  // Keep trimming the relay function to avoid the 250MB limit:
  outputFileTracingExcludes: {
    // For App Router API route
    "/app/api/relay/route": [
      "node_modules/@next/swc-*/**",
      "node_modules/lightningcss-*/**",
      "node_modules/@img/**",
      "node_modules/sharp/**",
      "node_modules/@napi-rs/**",
      "node_modules/typescript/**",
      "node_modules/eslint/**",
      "node_modules/@typescript-eslint/**",
      "node_modules/axe-core/**",
      "node_modules/@heroicons/**",
      "node_modules/react-icons/**",
      "node_modules/lucide-react/**",
      "node_modules/@reown/**",
    ],
    // (If you ever move relay to pages/api or a standalone)
    "/api/relay": [
      "node_modules/@next/swc-*/**",
      "node_modules/lightningcss-*/**",
      "node_modules/@img/**",
      "node_modules/sharp/**",
      "node_modules/@napi-rs/**",
      "node_modules/typescript/**",
      "node_modules/eslint/**",
      "node_modules/@typescript-eslint/**",
      "node_modules/axe-core/**",
      "node_modules/@heroicons/**",
      "node_modules/react-icons/**",
      "node_modules/lucide-react/**",
      "node_modules/@reown/**",
    ],
  },

  // Optional: reduces some bundling weight in server fns
  experimental: {
    serverMinification: true,
  },

  // Optional: if you don’t rely on static image imports
  images: { disableStaticImages: true },
};

module.exports = nextConfig;
