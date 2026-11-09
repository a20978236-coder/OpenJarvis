# HELL in the cloud (Cloudflare)

This folder puts HELL on the internet so it runs from your iPhone alone — no
computer, home server, Ollama or Tailscale. It is a small Cloudflare Worker
that:

- serves the HELL iPhone app (the same dashboard, unchanged) over HTTPS;
- asks for your passcode before anything private works;
- talks to Claude (Anthropic's AI) for you, holding your Anthropic key so it
  is never in the app or on the phone.

It uses Cloudflare's **free plan** (100,000 requests a day). Nothing here
costs money.

Every step below can be done in **Safari on your iPhone**.

## 1. Create a Cloudflare account

1. Go to **dash.cloudflare.com** and sign up (free).
2. In the dashboard, open **Account home** and copy your **Account ID**.
   (It is also shown under *Workers & Pages* on the right.) Keep it for step 3.
3. Open **Workers & Pages** once. If Cloudflare asks you to choose a
   `workers.dev` subdomain, pick one (e.g. your name) — HELL's address will be
   `hell.<that-name>.workers.dev`.

## 2. Create an API token for GitHub

1. In Cloudflare, tap your profile icon → **My Profile** → **API Tokens** →
   **Create Token**.
2. Pick the template **Edit Cloudflare Workers** → **Use template**.
3. Under *Account Resources* choose your account; under *Zone Resources*
   choose **All zones** (or none if offered). Tap **Continue to summary** →
   **Create Token**.
4. Copy the token. Cloudflare only shows it once.

This token lets GitHub upload HELL to your account. It is not your AI key and
it never reaches the phone app.

## 3. Give GitHub the token

In your GitHub repository (github.com → your HELL repository):

1. **Settings** → **Secrets and variables** → **Actions** → **New repository
   secret**.
2. Add `CLOUDFLARE_API_TOKEN` = the token from step 2.
3. Put your Account ID from step 1 in `cloud/wrangler.jsonc` as
   `account_id` (it is an ID, not a secret).
4. Open the **Actions** tab. If GitHub asks, tap **I understand my workflows,
   go ahead and enable them**.

## 4. Deploy

In the **Actions** tab, choose **HELL Cloud (Cloudflare)** → **Run workflow**
→ **Run workflow**. (It also runs by itself whenever `main` changes.)

When it finishes (about 3 minutes), the log's last step shows HELL's address,
like `https://hell.<your-name>.workers.dev`.

## 5. Set your passcode

HELL refuses every sign-in until you do this — it is never left open.

1. In Cloudflare: **Workers & Pages** → **hell** → **Settings** →
   **Variables and Secrets** → **Add**.
2. Type **Secret**, name `HELL_PASSCODE`, value: a passcode of **at least 8
   characters** (a few unrelated words is easy to type and hard to guess,
   e.g. `blue falcon 42 river`). Save.
3. Add another **Secret** named `SESSION_SECRET` with **at least 32 random
   characters**. Any long random text works — for example, mash the keyboard
   or use Safari's suggested strong password. You never need to type it again.
4. **Deploy** if Cloudflare asks.

## 6. Open HELL on your iPhone

1. Open the `https://hell.<your-name>.workers.dev/m` address in Safari.
2. Enter your passcode.
3. Tap **Share** → **Add to Home Screen** for the full-screen app.

## 7. Try on-phone AI (works offline)

1. In HELL, open **AI Modules** → **On-phone AI · test**.
2. Pick **Qwen2.5 0.5B** (recommended first) and tap **Download 491 MB and
   test**. Use Wi-Fi: the model downloads once from Hugging Face directly to
   your phone and is kept there.
3. When it finishes, tap **Copy results** and paste them to Claude. Try the
   other sizes too: if Safari reloads the page mid-test, that model is too
   big for the phone's memory, and HELL will say so next time.
4. **Remove from phone** frees the space again.

## 8. Turn on cloud AI (Claude)

Claude is pay-per-use from Anthropic (not part of Cloudflare's free plan).
HELL caps spending at **$1 a day** by default.

1. Go to **console.anthropic.com**, sign up, and add credit under
   **Billing** (you can also set a monthly limit there).
2. **API Keys** → **Create Key** → copy it.
3. In Cloudflare: **Workers & Pages** → **hell** → **Settings** →
   **Variables and Secrets** → **Add** → type **Secret**, name
   `ANTHROPIC_API_KEY`, paste the key → **Save**.
4. In HELL, run **Diagnostics**: *AI service* should say **Connected to
   Claude** and show today's spending.

To change the daily cap, edit `DAILY_LIMIT_USD` in `cloud/wrangler.jsonc`
and redeploy. HELL uses Claude Opus 5.5 at low effort for quick, low-cost
replies; if Claude declines a request for safety reasons, Anthropic may
answer with another Claude model instead (charged at that model's price).

## Good to know

- **Signing out everywhere:** change `SESSION_SECRET` in Cloudflare. Every
  device must enter the passcode again.
- **Wrong passcodes:** after 5 wrong tries, sign-in pauses for 10 minutes.
- **Sign-in lasts** 30 days per device.
- **Without the GitHub secrets** the workflow still tests HELL but skips the
  deploy (it says so in the log) — nothing breaks.
- **What works in the cloud today:** the app, sign-in, the dashboard, chat,
  camera questions (Vision) and the AI hologram builder (with your Anthropic
  key), and the on-phone AI test. Weather and on-phone storage arrive next;
  until then those screens say they are unavailable rather than pretending.
- **Listening** uses the iPhone's own speech recognition (Apple may process
  the audio). Turn it off in **Settings › Voice** if you prefer.

## For developers

```bash
npm ci               # install (install scripts are off by design)
npm test             # Worker tests
npm run typecheck
npm run build:app    # build the iPhone app into public/
npx wrangler dev     # run locally; put secrets in .dev.vars (git-ignored)
```
