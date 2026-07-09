# Muy Rico Order Tracker — Deploy

Internal tool for Jeff & Rebecca. Cloudflare Pages + Worker + D1.

## One-time setup (you do this in Cloudflare dashboard)

### 1. D1 database
```bash
npx wrangler d1 create muy-rico-orders
```
Copy the `database_id` into `wrangler.toml` → `database_id = "..."`

Run the schema (local dev DB first, then prod):
```bash
npx wrangler d1 execute muy-rico-orders --file=migrations/0001_initial.sql
npx wrangler d1 execute muy-rico-orders --remote --file=migrations/0001_initial.sql
```

### 2. Deploy the Worker (the API)
```bash
npx wrangler deploy
```
After deploy, copy the URL — e.g. `https://muy-rico-orders-api.YOUR-SUBDOMAIN.workers.dev`

### 3. Pages project (the UI)
- Cloudflare dashboard → **Pages** → **Create** → **Direct Upload**
- Name: `muy-rico`
- **Upload** the contents of the `public/` folder (intake.html, dashboard.html, index.html)
- After upload, your site is at `https://muy-rico.pages.dev`

### 4. Wire Worker to Pages (so /api/* calls go to the Worker)
- Cloudflare dashboard → **Workers Routes**
- Route: `muy-rico.pages.dev/api/*`
- Worker: `muy-rico-orders-api`
- Save

### 5. Lock it down with Cloudflare Access
- **Zero Trust** → **Access** → **Applications** → **Add**
- Name: `Muy Rico Orders`
- Domain: `muy-rico.pages.dev`
- Path: `*` (or just `/dashboard` and `/intake.html`)
- Policy: **Allow** specific emails — add `jeffery.garcia1@icloud.com` and Rebecca's email
- Identity provider: One-time PIN (Cloudflare sends her a 6-digit code by email)
- Save. Done — both of you login with email, no passwords to manage.

## After deploy

- Public: `https://muy-rico.pages.dev` → redirects to dashboard (which requires Access login)
- Add new order: `https://muy-rico.pages.dev/intake.html`
- View / manage orders: `https://muy-rico.pages.dev/dashboard`

## Notifications (optional)

New orders can send alerts via Telegram, email, or both.

### Telegram
1. Create a bot via [@BotFather](https://t.me/botfather) on Telegram — get the bot token.
2. Start a chat with your bot, then visit `https://api.telegram.org/bot<TOKEN>/getUpdates` to find your chat ID.
3. Uncomment `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` in `wrangler.toml`.
4. Run `npx wrangler deploy`.

### Email (Cloudflare Email Sending)
1. Go to **Cloudflare Dashboard → Email → Email Sending**.
2. Add and verify a sender domain or address (e.g. `orders@yourdomain.com`).
3. Set `EMAIL_FROM` to your verified sender address and `EMAIL_RECIPIENT` to where you want notifications.
4. Run `npx wrangler deploy`.

## Local dev
```bash
npx wrangler dev
# UI lives in /public — open public/dashboard.html in a browser pointed at the local Worker
```
