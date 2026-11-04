// Deploys PitBox to Cloudflare (free plan): the rooms worker first (its address goes into the
// website build), then the website with its race data to Cloudflare Pages.
//   node deploy.mjs            (or double-click deploy.bat)
// Optional: set PITBOX_PAGES_NAME to use a different Pages project name (default "pitbox").
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const ROOMS = join(ROOT, "rooms"), WEB = join(ROOT, "web");
const PAGES = process.env.PITBOX_PAGES_NAME || "pitbox";

/** Run a command, showing its output live; resolves with what it printed. */
function run(cmd, cwd, env = {}, { allowFail = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, { cwd, shell: true, env: { ...process.env, ...env }, stdio: ["inherit", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", (d) => { out += d; process.stdout.write(d); });
    p.stderr.on("data", (d) => { out += d; process.stderr.write(d); });
    p.on("close", (code) => (code === 0 || allowFail ? resolve({ code, out }) : reject(new Error(`"${cmd}" failed (exit ${code})`))));
  });
}

export const workerUrl = (text) => (text.match(/https:\/\/[\w.-]+\.workers\.dev/g) ?? []).pop() ?? null;
export const pagesUrl = (text) => (text.match(/https:\/\/[\w.-]+\.pages\.dev/g) ?? []).pop() ?? null;

async function main() {
  const step = (n, text) => console.log(`\n==== ${n}. ${text} ====\n`);
  if (!existsSync(join(ROOT, "data/public/index.json"))) throw new Error("No race data yet. Run the pipeline (run_overnight.bat) first.");

  step(1, "Cloudflare login");
  const who = await run("npx wrangler whoami", ROOMS, {}, { allowFail: true });
  if (/not authenticated|not logged in/i.test(who.out)) {
    console.log("A browser window opens: sign in to Cloudflare and click Allow.");
    await run("npx wrangler login", ROOMS);
  }

  step(2, "Rooms server (watch rooms, live timing relay, radio, AI)");
  const w = await run("npx wrangler deploy --config wrangler.deploy.toml", ROOMS);
  const api = workerUrl(w.out);
  if (!api) throw new Error("Couldn't find the worker's address in wrangler's output. Is a workers.dev subdomain set up (Workers & Pages in the dashboard)?");
  console.log(`\nRooms server: ${api}`);

  step(3, "Website build (with race data)");
  await run("npm run build", WEB, { VITE_ROOMS_URL: api });

  step(4, "Website upload (Cloudflare Pages)");
  await run(`npx wrangler pages project create ${PAGES} --production-branch main`, ROOMS, {}, { allowFail: true }); // already exists: fine
  const pg = await run(`npx wrangler pages deploy "${join(WEB, "dist")}" --project-name ${PAGES} --branch main --commit-dirty=true`, ROOMS);
  const site = pagesUrl(pg.out);

  writeFileSync(join(ROOT, "deployed.txt"), `Website: https://${PAGES}.pages.dev (this upload: ${site ?? "see above"})\nRooms server: ${api}\nDeployed: ${new Date().toString()}\n`);
  console.log(`\nDone.\n  Website:      https://${PAGES}.pages.dev   (this upload: ${site ?? "see above"})\n  Rooms server: ${api}\nSaved to deployed.txt. If ${PAGES}.pages.dev was taken, Cloudflare shows the real address under Workers & Pages.`);
}

if (!process.env.PITBOX_DEPLOY_TEST) {
  main().catch((e) => { console.error(`\nDeploy stopped: ${e.message}`); process.exit(1); });
}
