import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()] as PluginOption[],
  resolve: {
    // Force single copies of packages with nested versions in the dep tree
    dedupe: ["@noble/hashes", "@noble/curves"],
    alias: {
      // Force all wagmi imports to resolve to the same instance.
      // The monorepo root has wagmi@2.19.5 (what @privy-io/wagmi was built for).
      // Without this alias, Vite picks frontend/node_modules/wagmi@3.4.2 for app
      // code while @privy-io/wagmi uses the root wagmi@2.19.5, creating two
      // separate React contexts and causing "No WagmiProvider" errors.
      wagmi: resolve(__dirname, "../node_modules/wagmi"),
      // Pin @noble/hashes to the root copy (v1.8.0, which exports `anumber`).
      // @wagmi/connectors nests v1.4.0 (missing that export), causing an esbuild
      // error when Vite resolves @noble/curves imports from that subtree.
      "@noble/hashes": resolve(__dirname, "../node_modules/@noble/hashes"),
      "@noble/curves": resolve(__dirname, "../node_modules/@noble/curves"),
    },
  },
});
