import { createLogger, defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The pipeline writes JSON to ../data/public; serve it as the site's static data.
// Served under /data via a tiny middleware so app routes and data paths never collide.
import { cpSync, createReadStream, existsSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = normalize(fileURLToPath(new URL("../data/public", import.meta.url)));

// When a page with a live connection (Live, Watch rooms) reloads or closes, the proxy can be
// mid-write and logs a long "ws proxy socket error" stack. It's harmless (the page reconnects),
// so drop just those; every other error, including a rooms server that isn't running, still shows.
const logger = createLogger();
const logError = logger.error.bind(logger);
const HARMLESS = /ws proxy socket error[\s\S]*(ECONNABORTED|ECONNRESET|EPIPE)/;
logger.error = (msg, options) => {
  const text = `${msg}\n${options?.error?.stack ?? ""}`;
  if (HARMLESS.test(text)) return;
  logError(msg, options);
};

export default defineConfig({
  customLogger: logger,
  plugins: [
    react(),
    {
      name: "pitbox-data",
      configureServer(server) {
        server.middlewares.use("/data", (req, res, next) => {
          const rel = decodeURIComponent((req.url || "/").split("?")[0]);
          const file = normalize(join(DATA_DIR, rel));
          if (!file.startsWith(DATA_DIR) || !existsSync(file) || !statSync(file).isFile()) return next();
          res.setHeader("Content-Type", file.endsWith(".gz") ? "application/octet-stream" : "application/json");
          createReadStream(file).pipe(res);
        });
      },
      // a production build ships the data with the site (dist/data), so one upload deploys everything
      closeBundle() {
        if (!existsSync(DATA_DIR)) { console.warn("pitbox: no ../data/public to copy; run the pipeline first"); return; }
        const out = fileURLToPath(new URL("./dist", import.meta.url));
        if (!existsSync(out)) return;
        // the speech model's runtime loads its WebAssembly from a CDN at run time; the bundled copy
        // (27 MB) is never used and is over Cloudflare Pages' 25 MB file limit, so leave it out
        for (const f of readdirSync(join(out, "assets"))) if (f.endsWith(".wasm")) rmSync(join(out, "assets", f));
        cpSync(DATA_DIR, join(out, "data"), { recursive: true });
        // data changes after each race weekend; the app's own files are fingerprinted
        writeFileSync(join(out, "_headers"), "/data/*\n  Cache-Control: public, max-age=300\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n");
        console.log("pitbox: copied race data into dist/data");
      },
    },
  ],
  // the speech-to-text worker imports modules, so build it as an ES module worker
  worker: { format: "es" },
  server: {
    port: 5173, // localhost only: the dev server should not be reachable from other machines
    // the rooms worker (npm run dev in ../rooms) answers /api; the web app shares its protocol file
    proxy: {
      "/api": { target: "http://localhost:8787", ws: true },
      // local AI model (Ollama); nothing leaves this computer
      "/ollama": { target: "http://localhost:11434", changeOrigin: true, rewrite: (p) => p.replace(/^\/ollama/, "") },
    },
    fs: { allow: [".."] },
  },
});
