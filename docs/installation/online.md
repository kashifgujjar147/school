# Online installation (MongoDB Atlas)

One installation per school. Repeat for every school with **its own** Atlas database user and database name.

## Requirements
* Node.js 20.11 or newer (LTS 22 recommended), npm 10
* A Linux/Windows host able to run a Node process (VPS, PaaS such as Render/Railway/Fly/Azure App Service, or a
  managed Node host), with a persistent disk for `data/uploads` and `data/backups`
* A domain name and HTTPS (terminated by the host or a reverse proxy such as Nginx/Caddy)

## 1. MongoDB Atlas
1. Create (or reuse) a cluster. A dedicated **project per school** is the strongest isolation; at minimum use a
   separate **database name and database user per school**.
2. *Database Access → Add user*: username `school_a_app`, strong password, **built-in role "readWrite" on the
   specific database only** (`Specific Privileges → readWrite @ school_a`). Do not grant `atlasAdmin` or
   "read and write to any database".
3. *Network Access*: add the server's outbound IP address(es). Avoid `0.0.0.0/0` in production.
4. *Connect → Drivers*: copy the `mongodb+srv://…` URI.
5. Enable Atlas cloud backups if your tier supports it (in addition to the app's own backups).

## 2. Configure
```bash
git clone <repo> school-a && cd school-a        # or extract the release ZIP
npm ci
cp .env.example server/.env
```
Edit `server/.env`:
```ini
NODE_ENV=production
APP_MODE=cloud
APP_URL=https://attendance.school-a.example
COOKIE_SECURE=true
TRUST_PROXY=1
SCHOOL_INSTALL_ID=school-a
NODE_ID=school-a-cloud
PACKAGE=standard            # or starter
MONGODB_URI=mongodb+srv://school_a_app:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB_NAME=school_a
SESSION_SECRET=<64+ hex>    # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
DATA_ENCRYPTION_KEY=<64 hex>
```

## 3. Build, initialise, start
```bash
npm run build
INIT_SCHOOL_NAME="School A" INIT_TIMEZONE=Asia/Karachi npm run init:school   # prints the principal password ONCE
cd server && node dist/index.js
```
Keep it running with your host's process manager (systemd unit, PM2 `pm2 start dist/index.js --name school-a`,
Windows service via NSSM, or the PaaS start command `npm run start -w server`).

Health check URL for the host: `GET /api/health` (200 when the database is connected).

## 4. HTTPS and domain
* Point the school's domain (DNS A/CNAME) at the host. Domain purchase/ownership verification happens at your
  registrar; this software does not do it.
* Terminate TLS at the host/proxy and forward to `PORT`. Nginx example:
```nginx
server {
  server_name attendance.school-a.example;
  listen 443 ssl http2;   # certificates via certbot
  client_max_body_size 10m;
  location / { proxy_pass http://127.0.0.1:8080; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto https; }
}
```
* With TLS in front, keep `COOKIE_SECURE=true` and `TRUST_PROXY=1`.

## 5. After first start
Sign in as the principal → change the password → Settings (profile, branding, time zone, working days, holidays)
→ Classrooms (classes, sections, classrooms) → Staff & users (teachers) → assign teachers → import students →
(Standard) SMS provider, templates, automation → Backups (schedule + first manual backup).

## Backups
App backups go to `BACKUP_DIR` on the host. Copy them off-host regularly — see
[backup-and-recovery.md](backup-and-recovery.md).
