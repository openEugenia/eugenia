import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

/**
 * Politique de sécurité du contenu (§12), injectée à la construction seulement (le
 * serveur de développement a besoin de scripts en ligne). GitHub Pages ne permet pas
 * d'en-têtes HTTP : elle passe par une balise meta.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.github.com https://raw.githubusercontent.com https://api.anthropic.com https: http://localhost:* http://127.0.0.1:* http://[::1]:*",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob: https:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function contentSecurityPolicy(): Plugin {
  return {
    name: "eugenia-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<!-- CSP -->",
        `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  base: process.env.EUGENIA_BASE ?? "/eugenia/",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    contentSecurityPolicy(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      includeAssets: ["icons/*.svg", "icons/*.png"],
      manifest: {
        name: "Eugenia — wiki personnel de connaissances",
        short_name: "Eugenia",
        description:
          "Extraire, structurer et mémoriser durablement vos connaissances, dans vos propres dépôts git.",
        lang: "fr",
        theme_color: "#11161d",
        background_color: "#11161d",
        display: "standalone",
        start_url: ".",
        scope: ".",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          { src: "icons/mark.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,mjs,css,html,svg,png,woff2}"],
        navigateFallback: "index.html",
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 1600,
  },
  worker: {
    format: "es",
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});
