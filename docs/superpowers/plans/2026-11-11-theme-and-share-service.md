# Theme and Share Service Implementation Plan

> **For agentic workers:** Execute inline in this session; do not dispatch agents.

**Goal:** Improve typography and add a persistent dark theme, then support short viewer links through Cloudflare D1 or a local Node server.

**Architecture:** The static app uses one configurable `POST /api/links` contract. A Cloudflare Worker stores links in D1 and redirects short IDs; `server/` implements the same contract with a JSON file and Node built-ins.

**Tech Stack:** Vanilla JS/CSS/HTML, Cloudflare Workers + D1 + Wrangler, Node.js built-in HTTP and filesystem APIs.

**Spec:** `docs/superpowers/specs/2026-11-11-theme-and-share-service.md`

## Global Constraints

- No runtime dependencies in the static client or local Node server.
- Preserve old `#layout=` and compressed `#z=` viewer links.
- Keep public app deployment separate from Cloudflare Worker provisioning.
- Never stage local generated link data or secrets.

---

### Task 1: Readable typography and theme

**Files:** Modify `index.html`, `app.js`, `styles.css`.

- [x] Replace remote Google font import with a system stack and raise small text/control sizes.
- [x] Add an accessible light/dark toggle, follow system preference initially, and persist manual choice in localStorage.
- [x] Add dark palette overrides for controls, labels, selections, and viewer mode.

### Task 2: Cloudflare D1 Worker

**Files:** Create `cloudflare/worker.js`, `cloudflare/wrangler.toml`, `cloudflare/migrations/0001_links.sql`, `cloudflare/README.md`.

- [x] Implement CORS preflight and JSON creation API with strict origin/host/size validation and per-IP request limit.
- [x] Generate collision-checked random short IDs, insert them into D1, return a short URL, and redirect `GET /<id>` to the stored viewer URL.
- [x] Document database creation, migration, deployment, custom origin, and limits.

### Task 3: Local Node server

**Files:** Create `server/server.mjs`, `server/package.json`, `server/.gitignore`, `server/README.md`.

- [x] Implement the same create and redirect routes using Node built-ins and atomic JSON persistence.
- [x] Restrict URLs to the app host, cap request size, and return consistent JSON errors.
- [x] Document `node server/server.mjs` (no package install required) and local app configuration.

### Task 4: Client integration and docs

**Files:** Modify `app.js`, `index.html`, `README.md`.

- [x] Add optional `data/share-config.js` before `app.js` and prefer the configured Worker API; retain clck.ru as fallback.
- [x] Validate the shortener response, cache IDs by immutable viewer URL and provider, and keep the existing full-link fallback.
- [x] Update cache versions and explain public vs local setup.

### Task 5: Verification and publish

- [x] Run `node --check` for the app, Worker, and server; run `git diff --check`.
- [ ] Publish the static app to GitHub Pages. Report that Worker deployment still needs a Cloudflare account/database unless configured in this environment.
