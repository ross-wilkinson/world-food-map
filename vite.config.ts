import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  // relative base so the build works on GitHub Pages project sites and locally
  base: "./",
  build: { outDir: "../dist", emptyOutDir: true, target: "es2022" },
});
