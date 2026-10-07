# Pickleball Round Robin: notes for working on this repo

Node/Express + Socket.IO + SQLite server (`server/`), React/Vite client (`client/`),
shipped as one Docker image. Pushes to `main` build and deploy automatically.

## Keeping the manual and version history current

The user manual and version history are built into the app (linked from the
footer). **Any change a player or host can see needs three things:**

1. **Manual:** update the matching section in `client/src/Help.jsx`. If the
   screens changed, refresh the screenshots (below).
2. **Version history:** add a new entry at the **top** of `RELEASES` in
   `client/src/changelog.js` with the version, today's date (`YYYY-MM-DD`) and
   short plain-language lines starting with `New:`, `Improved:` or `Fixed:`.
   Never rewrite old entries.
3. **Version number:** for a feature release, bump the minor version to match the
   new entry: `cd server && npm version minor --no-git-tag-version`
   (or `npm version 1.2.0 --no-git-tag-version`). Run `git pull` first.

Purely internal changes (refactors, infrastructure, tests) don't need an entry.

### Versioning rules

- `server/package.json` is the single source of truth; the footer and
  `/api/version` read it.
- CI (`.github/workflows/docker.yml`) bumps the **patch** number on every build
  and commits it back with `[skip ci]`. Don't bump patch by hand, and always
  `git pull` before committing so you pick up those bot commits.
- So a release logged as `1.2.0` first appears in the footer as `1.2.1`; builds
  count up from there until the next minor bump.

### Refreshing screenshots

`docs/make-screenshots.mjs` starts a throwaway local server with fictional
players (Alex, Blake, Casey...), drives a headless browser at phone size and
writes PNGs to `client/public/manual-img/` (the file names are referenced from
`Help.jsx`). It needs Playwright and a built client:

```bash
cd client && npm run build && cd ..
rm -rf server/public && cp -r client/dist server/public
node docs/make-screenshots.mjs        # run from a folder where `playwright` resolves
rm -rf server/public                  # build artifact, never commit it
```

If you add a new screen, add a shot to the script and a `<Fig>` to `Help.jsx`.
Screenshots only use demo data and the fake `host@example.com` login (the
`TEST_AUTH_BYPASS` route that exists only when that env var is set).

## Testing

- `server/test_admin.mjs` expects a server on port 3995, `server/test_multisession.mjs`
  on 3996. Both start from an empty `DATA_DIR` with `TEST_AUTH_BYPASS=1`.
- `TEST_AUTH_BYPASS=1` must never be set in production.
