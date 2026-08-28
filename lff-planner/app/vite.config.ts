import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: null,
      manifest: false, // static public/manifest.webmanifest
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        // Programme data and images are runtime-cached by the SW, not precached.
        globIgnores: ["data/**"],
      },
    }),
  ],
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("../shared", import.meta.url)),
      "@scheduler": fileURLToPath(new URL("../scheduler", import.meta.url)),
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
