# Put VIP HopOn online (free trial)

Three free services. About 30–45 minutes the first time.

| What | Where | Why |
|---|---|---|
| Database | **Neon** (PostgreSQL) | Keeps tickets, trips and accounts. Free, doesn't expire. |
| Server | **Render** (free web service) | Runs the API and live map updates. |
| Screens | **Netlify** | Hosts the passenger app, crew app and ops dashboard. |

All three give you HTTPS, so the camera (QR scanning), GPS and "Install app" work on every phone. No Wi-Fi tricks and no certificate warnings.

> **Render free plan sleeps** after about 15 minutes with no visitors. The first person after that waits 30–60 seconds while it wakes up; after that it's normal speed. Fine for a trial. A paid Render plan (or another host) removes the wait.

---

## 0. Put the code on GitHub

Render and Netlify deploy from GitHub.

1. Create a free account at https://github.com and a **new private repository**, e.g. `vip-hopon`. Don't add a README.
2. In PowerShell, in the `hopon` folder:

```powershell
git init
```
```powershell
git add .
```
```powershell
git commit -m "VIP HopOn MVP"
```
```powershell
git branch -M main
```
```powershell
git remote add origin https://github.com/YOUR-NAME/vip-hopon.git
```
```powershell
git push -u origin main
```

`.gitignore` already keeps out `node_modules`, `data` (your local database) and any `.env` file with secrets.

---

## 1. Neon: the database

1. Sign up at https://neon.tech (you can use your GitHub account).
2. **Create project** → name `vip-hopon` → region **AWS Europe (Frankfurt)**, the closest to Ghana → PostgreSQL version: the default.
3. On the project dashboard click **Connect**, choose **Node.js** or **Connection string**, and copy the string. It looks like:
   `postgresql://neondb_owner:xxxxx@ep-something.eu-central-1.aws.neon.tech/neondb?sslmode=require`
4. Keep it private. You'll paste it into Render in step 2.

You don't need to create tables: the server creates them, plus all 34 towns, 72 routes and the demo buses, the first time it starts.

---

## 2. Render: the server

1. Sign up at https://render.com with your GitHub account.
2. **New** → **Blueprint** → pick your `vip-hopon` repository. Render reads `render.yaml` and proposes a web service called `vip-hopon-api`.
3. It asks for the settings marked secret. Fill them in:

| Setting | What to put |
|---|---|
| `DATABASE_URL` | The Neon connection string from step 1 |
| `PUBLIC_URL` | Leave as `https://example.com` for now; you'll fix it after step 3 |
| `CORS_ORIGIN` | Same, fix after step 3 |
| `FIRST_MANAGER_PHONE` | The phone number of the first VIP manager, e.g. `0244123456` |
| `FIRST_MANAGER_PIN` | A 4–6 digit PIN they'll use to sign in (not 1234, not all the same digit) |
| `FIRST_MANAGER_NAME` | Their full name |
| `TEST_PHONES` | Phone numbers allowed to sign in as passengers during the trial, comma separated: `0244123456,0551234567` |
| `SMS_PROVIDER` | Leave empty for now (codes show on screen) |

4. Click **Apply**. The first build takes a few minutes. When it says **Live**, copy the address at the top, e.g. `https://vip-hopon-api.onrender.com`.
5. Check it: open `https://vip-hopon-api.onrender.com/api/config` in a browser. You should see a short line of text starting with `{"hubtelMode":"mock"`.

The **first manager** signs in at `/ops` with Staff ID **VIP-M9001** and the PIN you chose. Demo logins (PIN 1111 and so on) are **not** created online.

---

## 3. Netlify: the screens

1. Sign up at https://netlify.com with your GitHub account.
2. **Add new site** → **Import an existing project** → **GitHub** → pick `vip-hopon`.
3. Netlify reads `netlify.toml`, so the build command and publish folder are already filled in. Before deploying, open **Add environment variables**:

| Key | Value |
|---|---|
| `VITE_API_URL` | Your Render address from step 2, e.g. `https://vip-hopon-api.onrender.com` (no slash at the end) |

4. **Deploy**. When it finishes, Netlify gives you an address like `https://random-name-123.netlify.app`. You can rename it under **Site configuration → Change site name**, e.g. `vip-hopon.netlify.app`.

---

## 4. Connect them

Back in Render → `vip-hopon-api` → **Environment**:

| Setting | Value |
|---|---|
| `PUBLIC_URL` | Your Netlify address, e.g. `https://vip-hopon.netlify.app` |
| `CORS_ORIGIN` | The same Netlify address |

Save; Render restarts by itself. Now:

- **Passengers:** `https://vip-hopon.netlify.app`. Only numbers in `TEST_PHONES` can get a login code, and the code shows on screen.
- **Crew:** `https://vip-hopon.netlify.app/crew`.
- **Managers:** `https://vip-hopon.netlify.app/ops`. Sign in with VIP-M9001 and your PIN, then go to *Crew and Staff IDs* → **Issue Staff ID** for each conductor and driver. Each person activates their ID on their phone with the code shown on the slip.

On each phone, open the address, sign in, and tap **Install** (Android) or **Share → Add to Home Screen** (iPhone).

---

## Everyday changes

- **New version of the app:** push to GitHub (`git add .`, `git commit -m "..."`, `git push`). Render and Netlify rebuild automatically.
- **Add trial testers:** Render → Environment → edit `TEST_PHONES` → Save.
- **Turn off the "Test mode" buttons** (check in without location, demo drive): set `TEST_MODE` to `false`.
- **Start the database again from scratch:** in Neon, *Branches* → reset, or delete and recreate the project, then put the new connection string in Render. The server re-creates the tables, towns and the first manager.

## Real SMS later (login codes, tickets, arrival texts)

1. Open an account with **Arkesel**, **mNotify** or **Hubtel SMS**, and register the sender name **VIPHopOn** (approval takes a few days).
2. In Render → Environment, add:
   - `SMS_PROVIDER` = `arkesel`, `mnotify` or `hubtel`
   - `SMS_SENDER` = `VIPHopOn`
   - The provider's key: `ARKESEL_API_KEY`, `MNOTIFY_API_KEY`, or `HUBTEL_SMS_CLIENT_ID` + `HUBTEL_SMS_CLIENT_SECRET`
   - `OTP_MODE` = `sms`
3. Test with one number first. Every message also appears in *Messages sent* on the ops dashboard, marked sent or failed.

Check `server/sms.ts` against the provider's current API docs before going live.

## What stays free

- **Neon:** a small database (0.5 GB) is plenty for a trial.
- **Render:** one free web service (it sleeps when idle).
- **Netlify:** free for a site this size.
- **Maps:** OpenStreetMap, free for light trial use. Before launch, move to Google Maps or MapTiler (one line in `web/src/ui.tsx`).
- **Payments:** test checkout only. Real Hubtel payments need VIP's merchant account (`HUBTEL_MODE=live` plus keys).
