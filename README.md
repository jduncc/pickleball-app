# Pickleball Round Robin — self-hosted

A real-time, multi-user round robin manager. Everyone on the network opens the
same page in a browser and sees live courts, queue, and standings — no app
install needed. One Node server holds the session state and pushes updates to
every connected device over WebSockets, so nothing gets out of sync when two
people log scores at the same time.

## What's here

```
server/     Node/Express + Socket.IO + SQLite — the authoritative app
client/     React UI (Vite) — built into server/public at image build time
Dockerfile  Multi-stage build: builds the client, then packages it with the server
docker-compose.yml
```

## 1. Prerequisites on the Linux VM

Docker + Docker Compose. On Debian/Ubuntu:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out/in after this
```

## 2. Get the code onto the VM

Copy this whole `pickleball-app` folder to the VM (scp, rsync, or push it to a
private git repo and clone it) — e.g.:

```bash
scp -r pickleball-app your-user@your-vm-ip:~/pickleball-app
```

## 3. Build and run

```bash
cd ~/pickleball-app
docker compose up -d --build
```

That builds the React client, bundles it with the server into one image, and
starts it listening on port 3000. Score data lives in a Docker volume
(`pickleball-data`), so it survives restarts and rebuilds.

Check it's up:

```bash
docker compose logs -f
```

## 4. Access on your home WiFi

Find the VM's LAN IP:

```bash
hostname -I
```

Then from any phone/laptop on the same WiFi, open:

```
http://<vm-lan-ip>:3000
```

Everyone who opens that address is in the same live session.

## 5. Access when you're away from home

**Don't port-forward 3000 on your router** — this app has no login, so
exposing it directly to the public internet means anyone who finds the port
can edit your session. Since you also want remote access, the easiest secure
option is **Tailscale** (a free personal VPN that just works):

On the VM:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Follow the printed link to authorize the VM to your Tailscale account (free
for personal use, up to 100 devices). Then install the Tailscale app on your
phone and any other devices you want to use this from, and sign in with the
same account.

Once connected, find the VM's Tailscale address:

```bash
tailscale ip -4
```

From any device on your tailnet (at home or away), open:

```
http://<vm-tailscale-ip>:3000
```

This is encrypted end-to-end and doesn't require opening anything on your
router or exposing the app to the open internet. Only devices you've
explicitly signed into your tailnet can reach it.

*(If you'd rather everyone at a session — including guests without
Tailscale — use it on the local WiFi only, and just use Tailscale yourself
for checking standings remotely, that works too; both can be true at once.)*

## 6. Admin: backups and reset

Open `http://<vm-ip>:3000/admin` (or the Tailscale equivalent) for a small
admin page with two things:

- **Download database** — exports the raw SQLite file (live session + all
  archived history) as a backup.
- **Reset database** — permanently wipes everything (live session and all
  archived history) for everyone connected. Requires typing `RESET` to enable
  the button plus a confirmation dialog, since it can't be undone.

By default this route has no login. To protect it with a shared token:

```bash
cp .env.example .env
# edit .env and set ADMIN_TOKEN to something private
docker compose up -d --build
```

Once set, `/admin` will ask for that token before allowing a download or
reset (enter it once in the page — it's remembered for that browser tab via
session storage). If you don't set `ADMIN_TOKEN`, the server logs a warning
on startup and the route is left open — fine if this box is only reachable
over your home LAN/tailnet and you trust everyone on it, but worth locking
down if you're at all unsure who can reach port 3000.

## 7. Updating later

```bash
cd ~/pickleball-app
git pull                     # if using git
docker compose up -d --build
```

Your data isn't touched by rebuilds — it lives in the named volume.

## 8. Notes

- **No authentication.** Anyone with network access (LAN or your tailnet) can
  view and edit the live session. Fine for household/friend use; if you want
  extra protection even over Tailscale, a simple option later is adding
  HTTP basic auth in front via a reverse proxy like Caddy.
- **One live session at a time.** Ending a session archives it (visible in
  the Log tab's "Past sessions" list) and starts a fresh one. Multi-room
  support (several concurrent round robins) isn't built, but the server
  architecture would support adding it later if you ever run simultaneous
  sessions on different court sets.
- **Backups**: easiest is the Download button on `/admin`. If you'd rather
  do it from the command line: `docker compose exec pickleball cat /app/data/pickleball.db > backup.db`.
