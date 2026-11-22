# VIP HopOn MVP

Book from home. Hop on. They watch you arrive.

A working first version of the three HopOn products on one backend:

| Part | Address | Who |
|---|---|---|
| Passenger web app | `http://localhost:5173/` | Travellers: sign in by SMS code, book open tickets, pay, QR ticket, check in, live trip, share link, change date, cancel |
| Crew app | `http://localhost:5173/crew` | Conductors open boarding, scan tickets (also offline), sell walk-in seats, close boarding. Drivers start and end the trip and share location |
| Operations dashboard | `http://localhost:5173/ops` | Managers: live bus map, loading status, sales, cash per conductor, alerts, SMS log, fares and online limits |
| Family tracking page | `http://localhost:5173/t/<token>` | Anyone with the link, no sign-in |

## Run it

Needs Node.js 22.18 or newer (it runs TypeScript directly). The database is PostgreSQL: on your computer a built-in copy (PGlite) saves to `data/pg`, so there is nothing to install.

```powershell
npm install
npm run dev
```

Open http://localhost:5173.

### On real phones (passenger on one phone, admin or crew on another)

```powershell
npm run dev:phone
```

1. Connect the phones to the same Wi-Fi as this computer.
2. Open the `https://192.168.x.x:5173` address Vite prints as "Network" on each phone.
3. Each phone shows a certificate warning once (it's a local test certificate). Tap Advanced, then Proceed.
4. Use one phone as a passenger, one at `/ops` as the manager, and one at `/crew` as the conductor or driver. The map, seat counts and loading board update live on all of them.

HTTPS is needed because phones only allow the camera (QR scanning) and GPS (check-in, driver location) on secure pages. If Windows asks, allow Node.js through the firewall on private networks.

- `npm run reset` clears the local demo data (restart afterwards to re-seed).
- `npm run test:e2e` runs a whole trip (41 checks) against the running server.
- `npm run build` then `npm start` serves the built app and API from one port.

**Putting it online for a trial (Neon + Render + Netlify): see [DEPLOY.md](DEPLOY.md).**

## Test logins

Passengers sign in with any Ghana number. In test mode no SMS is sent, so the code shows on screen.

### Crew accounts: VIP Staff IDs

Nobody can sign up as crew. A crew account exists only when a VIP manager issues a **Staff ID** (the number printed on the staff ID card):

1. **Manager issues it:** Ops dashboard → *Crew and Staff IDs* → name, phone, role → **Issue Staff ID**. The person gets an SMS with their Staff ID and a one-time activation code, valid for 7 days. The manager can print the slip.
2. **Crew member activates it once:** Crew app → *First time? Activate your Staff ID*. They enter their Staff ID, the phone VIP has on file, the code, and a PIN they choose. All three must match.
3. **Every day after:** sign in with Staff ID + PIN.
4. **Digital staff ID card:** in the crew app, tap the ID-card button. It shows a signed QR and a live clock, so screenshots are easy to spot. A conductor can scan another staff member's card to confirm it is genuine.
5. **Manager controls:** *New code* (lost phone or forgotten PIN) and *Switch off* (signs the person out at once and blocks the Staff ID).

Security rules: PINs are stored hashed, never as plain text. Five wrong PINs lock the Staff ID for 15 minutes, and weak PINs (1234, 1111) are refused.

Demo Staff IDs (from `server/seed.ts`, demo only):

| Role | Staff ID | PIN |
|---|---|---|
| Conductor | VIP-C1001 | 1111 |
| Conductor | VIP-C1002 | 2222 |
| Driver | VIP-D2001 | 3333 |
| Driver | VIP-D2002 | 4444 |
| Manager (ops dashboard) | VIP-M9001 | 9999 |
| Conductor, **not yet activated** | VIP-C1003 | activate with phone 0244000005 and code 482915 |

Each browser holds one crew sign-in at a time, so use separate phones (or a private window) for the conductor, the driver and the manager.

### Install as an app

- **Android (Chrome):** sign in, then tap **Install** on the yellow card (or browser menu → *Install app*).
- **iPhone (Safari):** tap **Share → Add to Home Screen**.
- The passenger app installs as **VIP HopOn**. The crew app, opened at `/crew`, installs separately as **VIP HopOn Crew** with its own icon, so a conductor's phone can have both.
- Installing needs HTTPS: use `npm run dev:phone` on Wi-Fi, or a hosted address.
- Once installed, the app opens from the home screen without the browser bar. Tickets and the crew scanner keep working with weak signal; live data needs a connection.

## One phone per bus

Each bus carries one VIP phone (the "Bus 14 phone"). The conductor and driver share it:

1. **Conductor** signs in with their Staff ID, taps *Open boarding*, picks the route, bus and driver, then scans tickets and sells walk-in seats.
2. **When the bus is full** (or the conductor decides to go), they tap **Close boarding · hand to driver**.
3. **The same phone shows the driver a big Start Trip button.** The driver taps it. The phone now sends its GPS location and stays awake. Keep it on the dashboard, charging.
4. **On arrival** the driver taps **End Trip**. Passengers and families get "arrived safely", and the phone goes back to boarding for the next trip.

Drivers can still sign in on their own phone if VIP prefers; the trip shows there too.

## Demo a whole trip

1. Passenger phone: sign in, add an emergency contact (tap your initials), pick Accra to Kumasi, book, approve the test payment.
2. Passenger: open the ticket, tap "Test mode: check in without location".
3. Bus phone: sign in as conductor `VIP-C1001`, open boarding, scan the passenger's QR (or type the `VIP-XXXXXX` code), add walk-ins, then *Close boarding · hand to driver*.
4. Bus phone (driver): Start Trip.
5. Passenger: Live trip shows the bus moving. "Share my trip" gives the family link.
6. Manager (`/ops`, `VIP-M9001`): watch the bus on the map, the cash totals and the SMS log.
7. Bus phone: End Trip. The contact gets "arrived safely" (see the SMS log).

## Testing the live map

- **Real GPS:** the bus phone uses its own location after Start Trip. To see it move for real, carry the bus phone (walk, or ride in a car) while another phone watches the passenger's Live trip or `/ops`. The bus appears where the phone is. Use a short route nearby, or any route; the dot follows the phone, and the ETA and "km to go" assume you're on the route.
- **No travelling:** on the bus phone, after Start Trip, tap **Test mode: demo drive**. The bus moves along the real highway (about 4 minutes end to end) and every watching phone updates live.
- **Adding buses:** Ops dashboard → *Fleet* → fleet number, plate (e.g. `GT 4412-21`), seats → **Add bus**. Conductors can pick it when opening boarding.

## VIP towns, routes and fares

34 towns and 72 routes: Accra (Circle) to 33 towns, plus Kumasi to Tamale, Wa and Kulungugu, each in both directions. Passengers can type a town, a nickname (Bolga, Tadi, Takyiman) or a region (Upper East) to find it.

- **Towns and fares:** VIP Jeoun's fare notice effective 8 April 2026 (Graphic Online), using executive-coach fares where listed and standard fares otherwise. Accra to Wa, Asante Bekwai and Ho come from troski.me (October 2026) and are marked "Fare unconfirmed" on the dashboard.
- **Locations:** OpenStreetMap. **Road paths, distances and drive times:** OSRM, saved in `server/routes-data.json`.
- **Stops on the live trip** (e.g. Kumasi, Techiman, Kintampo and Tamale on the Bolgatanga route) are worked out from which VIP towns the road passes.
- VIP's other Accra terminals (Kaneshie, Achimota) are listed as search names for Circle until VIP confirms which routes leave from where.

## What is real and what is simulated

| Area | In this MVP |
|---|---|
| Tickets | Real: Ed25519-signed QR codes, single use, checked by the server or offline on the crew phone |
| Payments | Simulated checkout (`HUBTEL_MODE=mock`). `server/hubtel.ts` holds the live Hubtel checkout and status-check calls; confirm endpoints and fields with Hubtel before switching to `live` |
| SMS | Written to an outbox shown on the ops dashboard, not sent. Replace `sendSms` in `server/lib.ts` with Hubtel SMS |
| Live location | Real phone GPS from the driver's browser, plus a demo drive for showing it without travelling |
| Maps | OpenStreetMap tiles (free, no key, fine for demos, not for production traffic). The architecture picks Google Maps; swap when costs are agreed |
| Payment logos | Drawn in each brand's colours for the checkout. Replace with official artwork from Hubtel's merchant kit before launch |
| Fares | VIP's April 2026 published fares (see above), editable on the dashboard |
| Offline scanning | Crew app caches the day's tickets and the public key, checks signatures without signal and syncs later; double scans across buses are flagged on the dashboard |
| Crew app | An installable web app (Android and iPhone). Background GPS while the screen is locked still needs the native Android app the architecture plans |
| Database | PostgreSQL: built-in PGlite locally, Neon online (set `DATABASE_URL`) |

## Policies built in (pending VIP approval)

- Open tickets: valid on any VIP bus on the route for the travel date.
- Checked-in app passengers board first; app seats per bus capped (default 30 of 50) to protect walk-ins.
- Daily online cap per route; held places released after 15 minutes unpaid.
- First date change free, then GH₵5. Cancel before the travel date: refund minus 10%. On the day, or unused: travel credit.

## Code map

```
server/index.ts   API routes, live updates (Socket.IO), background jobs
server/db.ts      PostgreSQL schema, queries   server/seed.ts   towns, routes, buses, crew
server/sms.ts     SMS providers (Arkesel, Hubtel, mNotify)   scripts/e2e.mjs  end-to-end trip test
server/lib.ts     ticket signing, SMS, geo   server/hubtel.ts payment adapter
web/src/passenger.tsx  passenger screens     web/src/crew.tsx   conductor and driver
web/src/ops.tsx        operations dashboard  web/src/ui.tsx     icons, map, sheets
```

## Before real passengers

- Hubtel merchant account and live keys; SMS sender ID.
- Real crew sign-in (SMS code per person or per bus phone) instead of seeded PINs.
- Paid hosting (no sleeping server), backups, error tracking.
- Data Protection Commission registration and a privacy notice.
- Native Android crew app for reliable background GPS.
