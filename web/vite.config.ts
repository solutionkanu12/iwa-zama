import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// Iwa frontend dev/build config. Static site, no server, public Sepolia RPC only.
// The Zama Relayer SDK (@zama-fhe/relayer-sdk) needs Node globals (Buffer/global/
// process) in the browser, provided by vite-plugin-node-polyfills. We use the
// SDK's prebuilt `/bundle` entry which ships its own WASM, so it is excluded from
// dependency pre-bundling to keep Vite from trying to transform the WASM.
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
  ],
  optimizeDeps: {
    exclude: ["@zama-fhe/relayer-sdk"],
  },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    rollupOptions: {
      // Three pages: index.html (main.tsx) serves both the landing page and
      // the app from one bundle, so a connected wallet carries straight
      // through with no second connect step. litepaper.html and roadmap.html
      // stay separate, untouched entries.
      input: {
        main: "index.html",
        litepaper: "litepaper.html",
        roadmap: "roadmap.html",
      },
    },
  },
});
