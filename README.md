# Pickleball Round Robin — self-hosted, multi-user

A real-time round robin manager. Each signed-in user has their own account:
they create sessions, see their history, and get a shareable link for each
session that lets players enter scores and check standings without signing
in. One Node server holds everyone's session state and pushes updates over
WebSockets, so nothing gets out of sync when two people log scores at once.

## What's here

```
server/     Node/Express + Socket.IO + SQLite — the authoritative app
client/     React UI (Vite) — built into server/public at image build time
Dockerfile  Multi-stage build: builds the client, then packages it with the server
docker-compose.yml
```

## How access works

- **You (and anyone you add)** sign in at `/` with Google, land on `/app`,
  and can create/end sessions and see your own history. Only email
  addresses on the allowlist can sign in at all — there's no self-serve
  signup.
- **Admin** (`/admin`) is gated the same way, but only for the email
  addresses in `ADMIN_EMAILS`. From there you add people to the allowlist,
  see overall usage, manage any user's sessions, and download a database
  backup.
- **Players** get a share link per session (shown on the session page and
  the dashboard) — no login needed. They can submit scores and view
  standings/history, but can't touch rosters, courts, shuffle, or end the
  session. Once you end a session, its link keeps working but goes
  read-only.

## 1. Prerequisites on the Docker server

Docker + Docker Compose, and a way to reach the box from the public
internet over HTTPS — this setup assumes a **Cloudflare Tunnel** pointed at
it (so there's no port-forwarding and TLS is handled by Cloudflare).

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # log out/in after this
```

If you haven't already, set up `cloudflared` on the same box (or anywhere
that can reach it) pointing your tunnel hostname at `http://localhost:3000`
(or whatever host/port this container is published on). That's independent
of this app — see Cloudflare's own Tunnel docs for that part.

## 2. Google OAuth credentials

1. Go to the [Google Cloud Console](https://console.cloud.google.com/),
   create (or pick) a project.
2. **APIs & Services → OAuth consent screen** — set it up as "External,"
   fill in the basics (app name, your email). You can leave it in "Testing"
   mode since only allowlisted emails can actually sign in anyway, or
   publish it — either works.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**,
   type **Web application**.
4. Under **Authorized redirect URIs**, add exactly:
   `https://pb.jonathanandamanda.com/auth/google/callback`
   (swap in your real `PUBLIC_URL` if different — it must match exactly,
   including `https://` and no trailing slash before `/auth/...`).
5. Save, then copy the **Client ID** and **Client secret** — you'll put
   these in `.env` below.

## 3. Configure environment

```bash
cd ~/pickleball-app
cp .env.example .env
```

Edit `.env` and fill in every value — see the comments in `.env.example`
for what each one does. At minimum you need:

- `PUBLIC_URL` — your Cloudflare Tunnel hostname, e.g.
  `https://pb.jonathanandamanda.com`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from step 2
- `SESSION_SECRET` — generate with `openssl rand -base64 48`
- `ADMIN_EMAILS` — your Google account email (comma-separate more than one)

## 4. Build and run

```bash
docker compose up -d --build
```

That builds the React client, bundles it with the server into one image,
and starts it listening on port 3000 (published to the host — point your
Cloudflare Tunnel at `http://localhost:3000`, or adjust the port mapping in
`docker-compose.yml` to match whatever your tunnel config expects). Data
lives in a Docker volume (`pickleball-data`), so it survives restarts and
rebuilds.

Check it's up:

```bash
docker compose logs -f
```

On first boot with `ADMIN_EMAILS` set, the server automatically:
- adds those emails to the allowlist as admins
- if there was pre-existing single-tenant data from before this version
  (an old live session and/or archived history), imports all of it as
  sessions owned by the **first** email in `ADMIN_EMAILS` — this only
  happens once.

## 5. First login

Open `https://pb.jonathanandamanda.com/` and sign in with Google using one
of the `ADMIN_EMAILS` addresses. You'll land on `/admin`. From there, use
**Add an instance user** to allowlist anyone else who should get their own
account — they can then sign in at `/` and land on `/app`.

## 6. Updating later

```bash
cd ~/pickleball-app
git pull                     # if using git
docker compose up -d --build
```

Your data isn't touched by rebuilds — it lives in the named volume. Bump
`APP_VERSION` in `.env` when you want the footer to reflect a new release.

## 7. Notes

- **Session cookies require HTTPS in production** (`NODE_ENV=production`,
  set by default in `docker-compose.yml`). This only works correctly
  because Cloudflare's edge sets `X-Forwarded-Proto` on everything it
  proxies, including through a Tunnel, and the server trusts that header
  (`app.set("trust proxy", 1)`). If you ever front this with something
  other than Cloudflare, confirm your proxy forwards that header the same
  way, or logins will silently fail to persist.
- **Logins persist across restarts.** Sessions are stored in the same
  SQLite database as everything else, so a redeploy or container restart
  doesn't log anyone out. The cookie's 30-day expiry also resets on every
  request (`rolling: true`), so a device that's used at least once a month
  effectively stays signed in indefinitely.
- **Backups**: the admin page's **Download database** button exports the
  raw SQLite file (every user's sessions and history). From the command
  line: `docker compose exec pickleball cat /app/data/pickleball.db > backup.db`.
- **Allowlist-only.** There's no self-serve signup — an admin has to add an
  email in `/admin` before that Google account can sign in at all.
