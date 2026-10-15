import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  define: {
    // single source of truth for the renderer's version display
    APP_VERSION: JSON.stringify(pkg.version)
  },
  server: { port: 5173, strictPort: true },
  build: {
    outDir: "dist",
    target: "chrome120",
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      // converter.html is a second entry: the hidden offscreen window that
      // renders .docx files for Word → PDF printing
      input: {
        main: "index.html",
        converter: "converter.html"
      }
    }
  }
});
