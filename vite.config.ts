import { defineConfig } from "vite";

// Relative assets work at / and at GitHub Pages /<repository>/ without hard-coding a repo name.
export default defineConfig({
  base: "./",
  server: { proxy: { "/api": "http://127.0.0.1:3000" } },
});
