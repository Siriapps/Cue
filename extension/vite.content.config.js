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
