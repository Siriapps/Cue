import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync, statSync } from "fs";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Plugin to copy manifest and icons and ensure UTF-8 encoding
function copyManifestPlugin() {
  return {
    name: "copy-manifest",
    writeBundle() {
      // Ensure content.js is valid UTF-8 immediately after Vite writes it
      const contentPath = resolve(__dirname, "dist/content.js");
      if (existsSync(contentPath)) {
        try {
          const rawBytes = readFileSync(contentPath);
          
          // Re-encode as UTF-8 to ensure Chrome compatibility
          // Convert all non-ASCII characters to Unicode escape sequences
          const content = rawBytes.toString('utf8');
          const asciiSafe = content.replace(/[^\x00-\x7F]/g, (char) => {
            const code = char.charCodeAt(0);
            return '\\u' + code.toString(16).padStart(4, '0');
          });
          const utf8Buffer = Buffer.from(asciiSafe, 'utf8');
          writeFileSync(contentPath, utf8Buffer);
        } catch (e) {
          console.error('Error ensuring UTF-8 encoding in writeBundle:', e.message);
        }
      }
      
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
      
      // Copy permission files
      const permissionHtml = resolve(__dirname, "public/permission.html");
      const permissionJs = resolve(__dirname, "public/permission.js");
      if (existsSync(permissionHtml)) {
        copyFileSync(permissionHtml, resolve(__dirname, "dist/permission.html"));
      }
      if (existsSync(permissionJs)) {
        copyFileSync(permissionJs, resolve(__dirname, "dist/permission.js"));
      }
      
      // Copy offscreen files
      const offscreenHtml = resolve(__dirname, "public/offscreen.html");
      const offscreenJs = resolve(__dirname, "public/offscreen.js");
      if (existsSync(offscreenHtml)) {
        copyFileSync(offscreenHtml, resolve(__dirname, "dist/offscreen.html"));
      }
      if (existsSync(offscreenJs)) {
        copyFileSync(offscreenJs, resolve(__dirname, "dist/offscreen.js"));
      }
      
      // Copy capture-popup files
      const capturePopupHtml = resolve(__dirname, "public/capture-popup.html");
      const capturePopupJs = resolve(__dirname, "public/capture-popup.js");
      if (existsSync(capturePopupHtml)) {
        copyFileSync(capturePopupHtml, resolve(__dirname, "dist/capture-popup.html"));
      }
      if (existsSync(capturePopupJs)) {
        copyFileSync(capturePopupJs, resolve(__dirname, "dist/capture-popup.js"));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyManifestPlugin()],
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    sourcemap: false,
    charset: 'utf8',
    rollupOptions: {
      input: resolve(__dirname, "src/content/index.tsx"),
      output: {
        entryFileNames: "content.js",
        format: "iife",
        name: "CueContent",
        inlineDynamicImports: true,
      },
    },
  },
});
