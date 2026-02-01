import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { config as dotenvConfig } from "dotenv";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Load environment variables from root .env
dotenvConfig({ path: resolve(__dirname, "..", ".env") });

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_GEMINI_API_KEY": JSON.stringify(process.env.GEMINI_API_KEY || ""),
    "import.meta.env.VITE_VEO_API_KEY": JSON.stringify(process.env.VEO_API_KEY || ""),
    "import.meta.env.VITE_GEMINI_MODEL": JSON.stringify(process.env.GEMINI_MODEL || ""),
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify(process.env.API_BASE_URL || "http://localhost:8000"),
    "import.meta.env.VITE_WS_BASE_URL": JSON.stringify(process.env.WS_BASE_URL || "ws://localhost:8000"),
    "import.meta.env.VITE_LIBRARY_URL": JSON.stringify(process.env.LIBRARY_URL || "http://localhost:3001"),
  },
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: false, // Don't empty - content.js was already built
    sourcemap: false, // Disable source maps to avoid encoding issues
    rollupOptions: {
      input: resolve(__dirname, "src/background/index.ts"),
      output: {
        entryFileNames: "background.js",
        format: "es",
      },
    },
  },
});
