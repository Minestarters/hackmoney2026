import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()] as PluginOption[],
  resolve: {
    alias: {
      // Force all wagmi imports to resolve to the same instance.
      // The monorepo root has wagmi@2.19.5 (what @privy-io/wagmi was built for).
      // Without this alias, Vite picks frontend/node_modules/wagmi@3.4.2 for app
      // code while @privy-io/wagmi uses the root wagmi@2.19.5, creating two
      // separate React contexts and causing "No WagmiProvider" errors.
      wagmi: resolve(__dirname, "../node_modules/wagmi"),
    },
  },
});
