/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Helps keep server bundles smaller
    serverMinification: true,
    // Let these stay external (don’t deep-bundle them)
    serverComponentsExternalPackages: [
      "@solana/web3.js",
      "@solana/spl-token",
      "mongoose",
    ],
  },

  // Fine-grained control of what gets traced into the function bundle
  outputFileTracingExcludes: {
    // This key must match the route segment
    "/api/relay": [
      // Big native/dev-only bits we don’t want in a serverless fn
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
      // any other purely-UI libs you don’t need in the API
      "node_modules/@reown/**",
    ],
  },
};

module.exports = nextConfig;
