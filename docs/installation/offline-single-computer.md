# Offline installation — single computer

Runs entirely on one Windows/Linux/macOS computer with **no internet**. The browser on that computer opens
`http://localhost:8080`.

## Requirements
* Node.js 20.11+ (install from the offline installer `.msi`/`.pkg`, or your distro packages)
* MongoDB Community Server 7.x (offline installer from mongodb.com, downloaded in advance)
* The release ZIP of this project **with `node_modules` already installed** (run `npm ci && npm run build` on any
  machine with internet and the same OS/CPU architecture, then copy the folder), or an npm cache/mirror.

## 1. Local MongoDB
Run MongoDB as a **single-node replica set** so transactions are available (recommended):

*Linux* `/etc/mongod.conf`:
```yaml
net: { bindIp: 127.0.0.1, port: 27017 }
replication: { replSetName: rs0 }
storage: { dbPath: /var/lib/mongodb }
```
```bash
sudo systemctl enable --now mongod
mongosh --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27017"}]})'
```
*Windows*: during setup choose "Run service as Network Service"; edit `C:\Program Files\MongoDB\Server\7.0\bin\mongod.cfg`
to add `replication: { replSetName: rs0 }`, restart the "MongoDB" service, then run the same `rs.initiate` in
`mongosh`.

Optional but recommended: enable authentication and create an app user with `readWrite` on the school database.

## 2. Configure the app (`server/.env`)
```ini
NODE_ENV=production
APP_MODE=local
HOST=127.0.0.1                # this computer only
PORT=8080
APP_URL=http://localhost:8080
COOKIE_SECURE=false           # plain HTTP on localhost
SCHOOL_INSTALL_ID=school-a
NODE_ID=school-a-local-1
PACKAGE=starter               # SMS needs internet; Standard is allowed and jobs wait until online
MONGODB_URI=mongodb://127.0.0.1:27017/?replicaSet=rs0
MONGODB_DB_NAME=school_a
SESSION_SECRET=<64+ hex>
DATA_ENCRYPTION_KEY=<64 hex>
BACKUP_DIR=D:/SchoolBackups   # ideally a second disk
```

## 3. Initialise and start
```bash
npm run init:school
cd server && node dist/index.js
```
Open `http://localhost:8080`. To start automatically at boot: Windows Task Scheduler ("At startup", run
`node C:\school\server\dist\index.js`, start in `C:\school\server`) or NSSM; Linux systemd:
```ini
[Unit]
Description=School Management System
After=mongod.service
[Service]
WorkingDirectory=/opt/school/server
ExecStart=/usr/bin/node dist/index.js
Restart=always
User=school
[Install]
WantedBy=multi-user.target
```

## Authentication offline
Sign-in is handled by the local server against the local database — no internet involved. Sessions, lockouts and
password resets work exactly as online (password resets are issued by the principal in *Staff & users*).

## Backups offline
Scheduled backups run daily (Backups page). Also run `npm run backup` before risky changes. Copy
`BACKUP_DIR` to a USB drive weekly. Restore: Backups page (principal) or
`npm run backup -- --restore <id> --yes-i-understand`.

## What does not work without internet
SMS delivery (jobs stay **pending** and are sent when a connection exists), Atlas sync, and the public website for
outside visitors. Everything else works.
