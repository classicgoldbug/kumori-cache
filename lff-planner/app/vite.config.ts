import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("../shared", import.meta.url)),
      "@scheduler": fileURLToPath(new URL("../scheduler", import.meta.url)),
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
