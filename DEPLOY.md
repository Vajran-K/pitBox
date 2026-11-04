# Deploying PitBox to Cloudflare, with automatic updates (free)

Once this is set up, PitBox runs and updates itself:
- **On Cloudflare (free plan):** the website and its race data on Pages (`https://pitbox.pages.dev`), and the rooms server on Workers (`https://pitbox-rooms.<subdomain>.workers.dev`). The rooms server handles watch rooms, the live timing relay, radio clips and AI.
- **On GitHub (free):** a scheduled job, every 4 hours from Friday to Monday plus Wednesday mornings. It exports any newly finished race or qualifying session, updates the standings and redeploys, but only when something changed.
- **Code changes:** anything you push to GitHub is deployed automatically too.

Your laptop doesn't need to be on. You set it up once, which takes about 20 minutes.

---

## Part A: Cloudflare (once)

### A1. Create an account
Go to https://dash.cloudflare.com/sign-up, sign up and verify your email. No card is needed. Skip any "add a site / domain" screens.

### A2. Pick your workers.dev subdomain
In the dashboard, open **Workers & Pages** (under **Compute** in newer layouts). The first visit asks for a subdomain, for example `peter-pitbox`. Save it.

### A3. Create an API token, so GitHub can deploy for you
1. Top right, click your profile icon → **Profile** → **API Tokens** → **Create Token**.
2. Next to **Edit Cloudflare Workers**, click **Use template**.
3. Under **Permissions**, click **+ Add more** twice and add:
   - **Account** → **Cloudflare Pages** → **Edit**
   - **Account** → **Workers AI** → **Read**
4. **Account Resources**: *Include → your account*. **Zone Resources**: *Include → All zones*.
5. Click **Continue to summary**, then **Create Token**. **Copy the token now**, because it's shown only once. Keep it somewhere private for step B3.

### A4. Find your Account ID
On the **Workers & Pages** overview page, **Account ID** is in the right-hand column. Copy it. It's also the long code in the dashboard's address bar.

---

## Part B: GitHub (once)

### B1. Create an empty repository
1. On https://github.com/new, name it `pitbox`. Private is fine (the free plan includes 2,000 Actions minutes a month; PitBox uses about 300).
2. Don't add a README, .gitignore or licence. Click **Create repository** and copy its address, like `https://github.com/you/pitbox.git`.

### B2. Upload PitBox: double-click `publish_to_github.bat`
- If Git isn't installed, it says so. Install it from https://git-scm.com/download/win with the default options, then run it again.
- Paste the repository address when asked. A GitHub sign-in window may open the first time.
- It uploads the code and the current race data, about 50 MB. Ollama models, downloads, logs and `node_modules` stay on your laptop.

### B3. Add the two secrets
On the repository page, go to **Settings → Secrets and variables → Actions → New repository secret**. Add:
| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the token from A3 |
| `CLOUDFLARE_ACCOUNT_ID` | the ID from A4 |

### B4. Run it the first time
1. Open the repository's **Actions** tab. If asked, click **I understand my workflows, go ahead and enable them**.
2. Click **Update race data and deploy** → **Run workflow** → **Run workflow**.
3. It takes about 5–10 minutes. When it's green, open the run: the **Summary** shows the website address.

From now on it runs by itself.

---

## Part C: check it works (5 minutes)
- [ ] **Home**: shows the next race weekend in your timezone, and the last race's podium.
- [ ] **Races → a race**: lap chart, strategy and replay load.
- [ ] **Watch rooms**: start a replay room, open the invite link on your phone using mobile data, and chat both ways.
- [ ] **Ask AI**: ask "who won?". The line under the chat says *Using a free AI model on Cloudflare Workers AI*.
- [ ] **Schedule**: `https://pitbox-rooms.<subdomain>.workers.dev/api/schedule` lists this year's sessions.
- [ ] **Live relay**: with the Live page open in another tab, `…workers.dev/api/live/state` shows `"upstream":"connected"`.
- [ ] **Radio transcripts**: in a replay, turn on *Radio transcripts*. The first time downloads an 80 MB speech model.

Two things could only be tested from your laptop, not from Cloudflare's network:
- **Live timing**: if the Live page says *F1's live timing isn't answering* during a session, F1 is refusing Cloudflare's servers. `dev.bat` on your laptop still works.
- **Radio clips**: if transcripts say *Couldn't get the clip (502)*, F1's file host is refusing Cloudflare. Clips still play; only transcripts are affected.

---

## How the automatic updates work
- **When:** every 4 hours from Friday to Monday (UTC), plus Wednesday morning. A race usually appears on the site within about 4–5 hours of the chequered flag.
- **During a live session:** OpenF1 locks its free API, so that run skips and the next one catches up.
- **What it fetches:** only the current season's standings and sessions not yet exported. Old seasons come from the job's cache.
- **Deploying:** when there's new data, the job commits it to the repository (as *pitbox-bot*) and deploys. Otherwise it stops after about 2 minutes.
- **Right away:** to update without waiting, go to the Actions tab → **Update race data and deploy** → **Run workflow**.
- **Failures:** GitHub emails you if a run fails. Open the run to see the error.

## Changing the code later
Edit as usual, test with `dev.bat`, then double-click `push_changes.bat`, which does the following for you:
```
git pull
git add -A
git commit -m "what changed"
git push
```
The push deploys automatically. Run `git pull` first, because the bot adds race data commits.
The schedule itself lives in `tools/github-update.yml`. `publish_to_github.bat` copies it to `.github/workflows/update.yml`. If you change the schedule, edit both copies, or run the .bat again.
You no longer need `run_overnight.bat` or `deploy.bat`. `deploy.bat` still works for a manual deploy from your laptop.

## Free plan limits
| What | Free allowance | PitBox use |
|---|---|---|
| Cloudflare Pages | 20,000 files, 25 MB per file | ~4,500 files, all well under 1 MB |
| Workers requests | 100,000 / day | API calls, room joins |
| Durable Objects (SQLite) | 100,000 requests and 13,000 GB-s / day, 5 GB storage | rooms + one live relay; a 2-hour race is ~1,000 GB-s |
| Workers AI | 10,000 neurons / day (resets 00:00 UTC) | ~30 per question, so roughly 300 a day; each visitor is limited to 40 AI requests per 10 min |
| GitHub Actions (private repo) | 2,000 minutes / month | ~300 minutes / month |

When a Cloudflare daily limit runs out, that feature errors until midnight UTC. The rest of the site keeps working, and the chat falls back to PitBox's built-in reader.

## Local development is unchanged
`dev.bat` still runs everything on your laptop, with Ollama for AI. The cloud AI model is only in `rooms/wrangler.deploy.toml`, so local development needs no Cloudflare login.

## Removing it
- **Cloudflare:** **Workers & Pages → pitbox → Settings → Delete**, then the same for **pitbox-rooms**.
- **GitHub:** delete the repository, or turn off the workflow (**Actions → Update race data and deploy → ⋯ → Disable workflow**).
