# Offline installation — school LAN

One school computer is the server; principal and teachers use browsers on laptops/phones over the school Wi-Fi.
No internet required.

## 1. Server computer
Follow [offline-single-computer.md](offline-single-computer.md) steps 1–3 with these differences in `server/.env`:
```ini
HOST=0.0.0.0                        # listen on the LAN
APP_URL=http://192.168.1.10:8080    # the server's fixed LAN address
CORS_ORIGINS=http://school-server.local:8080   # any other names you use
COOKIE_SECURE=false                 # plain HTTP on LAN (see "HTTPS on LAN" below)
```
On start the server logs `LAN access URLs` — give that URL to staff.

## 2. Fixed address
Give the server a static IP or a DHCP reservation in the Wi-Fi router (e.g. `192.168.1.10`). Optionally add a
local DNS name in the router.

## 3. Firewall
* Windows: *Windows Defender Firewall → Advanced → Inbound Rules → New Rule → Port → TCP 8080 → Allow →
  Private profile only*. PowerShell: `New-NetFirewallRule -DisplayName "School SMS 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Profile Private -Action Allow`
* Linux (ufw): `sudo ufw allow from 192.168.1.0/24 to any port 8080 proto tcp`
* **Never** expose MongoDB (27017) on the LAN: keep `bindIp: 127.0.0.1`.
* Put staff devices on the staff Wi-Fi, not a guest/student network, or isolate with the router.

## 4. Teacher phones and laptops
Open `http://192.168.1.10:8080`, sign in, and (optional) "Add to Home screen". The first sign-in on each device
must happen while the device can reach the server; afterwards the device can also work when Wi-Fi drops (see
[browser offline](../offline/browser-offline.md)).

## HTTPS on LAN (optional, recommended)
Browsers only allow the full PWA install, service worker and WebCrypto (used for offline sign-in) on **HTTPS or
localhost**. On plain-HTTP LAN addresses, online use, attendance and reports work normally, but the device-level
offline features (service worker cache, offline sign-in) are disabled by the browser. To enable them, serve the
LAN install over HTTPS: put Caddy in front with an internal CA (`tls internal`), install Caddy's root certificate
on staff devices, and set `COOKIE_SECURE=true`, `APP_URL=https://school-server.local`.

## Multiple users
The local server handles concurrent users like the cloud server: optimistic version checks prevent lost updates,
and attendance is unique per classroom per day.

## Backups
As in the single-computer guide. A second computer can pull nightly copies of `BACKUP_DIR` over a shared folder.
