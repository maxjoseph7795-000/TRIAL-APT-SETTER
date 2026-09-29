# Appointment Booking App

Your clients book appointments on their own from their phone. You get a **WhatsApp message for every new booking** (and every cancellation), and you manage everything from an owner dashboard.

Works for doctors, dentists, clinics, physiotherapists, spas, salons — any business that books by time slot.

## What's inside

| File | What it is |
|---|---|
| `server.js` | The app server. Handles bookings, availability, the dashboard and WhatsApp alerts. |
| `public/index.html` | **Booking page** your clients open (Spanish / English). |
| `public/admin.html` | **Owner dashboard** at `/admin` (password protected). |
| `package.json` | Tells the server what to install. |
| `data/data.json` | Created automatically. Holds your settings and all appointments. |

**Client side:** choose service → pick a day and a free hour (every appointment is 1 hour, offered 8:00 AM to 3:00 PM) → enter name, phone, insurance, reason → get a reference number. Clients can also look up or cancel their appointment with the reference and phone number.

**Owner side (`/admin`):**
- Appointments grouped by day: confirm, mark done / no-show, cancel, delete.
- "WhatsApp client" button opens WhatsApp with a ready-made confirmation message for that client.
- Add appointments made by phone or walk-in (blocks that time online).
- Settings: business name, doctor, address, brand color, first and last appointment hour per day, optional lunch hour, days off, services with price, WhatsApp alerts.
- Share link: your booking link, a QR code for the front desk, and a ready-to-send message.
- Export all appointments to CSV (opens in Excel).

Every appointment lasts 1 hour and starts on the hour: 8:00, 9:00, 10:00 … 3:00 PM (Monday to Saturday by default). As soon as an hour is booked it disappears for everyone else, and it comes back if the appointment is cancelled. Double bookings are blocked on the server, including for appointments you add yourself.

---

## Step 1 — Put it online (Railway, about 10 minutes)

You need a free GitHub account and a Railway account.

1. **Upload the code to GitHub**
   - Go to github.com → **New repository** → name it `appointment-app` → Private → **Create repository**.
   - Click **uploading an existing file**, then drag in **everything inside** the unzipped folder: `server.js`, `package.json`, `package-lock.json`, `Dockerfile`, `railway.json`, `README.md` and the `public` folder. Don't drag the folder itself. Use Chrome or Edge so the `public` folder uploads correctly.
   - Check: the repository's first page must show `server.js` and `package.json` directly, not inside another folder.
   - Click **Commit changes**.

2. **Create the app on Railway**
   - Go to railway.app → **New Project** → **Deploy from GitHub repo** → pick `appointment-app`.
   - Railway detects Node.js and starts it with `npm start`.

3. **Set your password** (Variables tab of the service)
   - `ADMIN_PASSWORD` = a strong password only you know
   - `DATA_DIR` = `/data`

4. **Add storage so appointments are never lost**
   - Right-click the service (or use the **+** button) → **Volume** → mount path: `/data`.
   - Without this, appointments are erased every time Railway restarts the app.

5. **Get your link**
   - Settings tab → **Networking** → **Generate Domain**.
   - Booking page: `https://your-app.up.railway.app/`
   - Dashboard: `https://your-app.up.railway.app/admin`

Want your own name like `citas.miclinica.com`? In Railway → Settings → Networking → **Custom Domain**, then add the record it shows you at your domain provider.

## Step 2 — Turn on WhatsApp alerts (free, 3 minutes)

The app uses CallMeBot, a free service that sends WhatsApp messages to **your own** number.

1. On your phone, save the contact **+34 611 021 695**.
2. Send it this exact WhatsApp message: `I allow callmebot to send me messages`
3. It replies within about 2 minutes with your **API key** (a number). If nothing arrives, wait 24 hours and try again.
4. Open `/admin` → **Settings** → **WhatsApp alerts**. Enter your WhatsApp number with country code (for example `+18095550100`) and the API key.
5. Press **Send test message**. You should get a WhatsApp right away.

Each alert looks like this:

```
📅 NUEVA CITA / NEW BOOKING
Clínica Dental Sonrisa

👤 María Pérez
📞 809-555-0101
🩺 Limpieza dental (60 min)
🗓️ miércoles, 30 de septiembre · 9:15 AM
• Seguro: ARS Humano
📝 Dolor en muela

Ref: C-7K2QD
```

Until WhatsApp alerts are set up, clients see a green **Send confirmation on WhatsApp** button after booking, so you still get the booking on WhatsApp.

## Step 3 — Set up your business

Everything starts empty. In `/admin` → **Settings**: fill in the name, doctor, address, phone, color, first/last appointment hour, lunch hour, days off and services, then **Save changes**. The booking page updates immediately.

Then go to **Share link** and send the link to your clients or put it in your WhatsApp Business profile and Instagram bio.

## Setting it up for each client (reselling)

Each doctor or clinic gets their **own copy**: repeat Step 1 with a new Railway project (you can deploy the same GitHub repo again), give it its own `ADMIN_PASSWORD`, and set up WhatsApp with **their** phone number and key. Their data stays separate from everyone else's.

## Running it on your own computer (optional)

Requires Node.js 18 or newer.

```bash
npm install
ADMIN_PASSWORD=mypassword npm start
```

Open http://localhost:3000 (booking page) and http://localhost:3000/admin (dashboard).
On Windows PowerShell use: `$env:ADMIN_PASSWORD="mypassword"; npm start`

## Good to know

- **Privacy:** appointments contain patient names, phones and visit reasons. Keep the admin password private and use a strong one. The booking page never shows other clients' information.
- **CallMeBot limits:** free and meant for personal use, it only messages your own number and can be slow at busy times. For a larger clinic, alerts can be switched to the official WhatsApp Business API (Twilio or Meta), which costs a small amount per message.
- **Backups:** use **Export CSV** in the dashboard from time to time.
