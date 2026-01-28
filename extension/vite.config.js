import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { copyFileSync, mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";

// Plugin to copy manifest and icons
function copyManifestPlugin() {
  return {
    name: "copy-manifest",
    writeBundle() {
      const manifestSrc = resolve(__dirname, "public/manifest.json");
      const manifestDest = resolve(__dirname, "dist/manifest.json");
      const iconsSrc = resolve(__dirname, "public/icons");
      const iconsDest = resolve(__dirname, "dist/icons");
      
      // Copy manifest
      if (existsSync(manifestSrc)) {
        copyFileSync(manifestSrc, manifestDest);
      }
      
      // Copy icons directory
      if (existsSync(iconsSrc)) {
        if (!existsSync(iconsDest)) {
          mkdirSync(iconsDest, { recursive: true });
        }
        const iconFile = resolve(iconsSrc, "icon.svg");
        if (existsSync(iconFile)) {
          copyFileSync(iconFile, resolve(iconsDest, "icon.svg"));
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyManifestPlugin()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        content: resolve(__dirname, "src/content/index.tsx"),
        background: resolve(__dirname, "src/background/index.ts"),
      },
      output: [
        // Content script: inline everything (no code splitting) as IIFE
        {
          entryFileNames: "content.js",
          format: "iife",
          name: "CueContent",
          inlineDynamicImports: true,
        },
        // Background script: ES module format
        {
          entryFileNames: "background.js",
          format: "es",
        },
      ],
    },
  },
});
