# Theme and Share Service

## Goal

Improve readability with a persistent light/dark theme and make shared event layouts use compact IDs backed by a public Cloudflare service or a local server.

## Design

- Use a local system font stack, a 14px readable base, and a persisted light/dark theme toggle. Keep the current light palette and orange/green accents; add a charcoal dark palette with accessible text and controls.
- The browser sends a viewer URL to `POST /api/links` as JSON `{ "url": "https://kotatsu-map.1lop.ru/?view=1#..." }`. Both backends return `{ "shortUrl": "https://<service>/<id>" }`.
- The Cloudflare Worker stores code-to-URL rows in D1. `GET /<id>` redirects to the immutable viewer URL. Restrict create requests to the app origin and viewer URLs for the app host; limit creates to 20 requests per minute per client IP.
- `server/` provides the same API with Node.js built-ins and a JSON file. It also serves short redirects. It is a standalone local alternative and is not deployed with GitHub Pages.
- A single optional app config supplies the Worker API URL. Without it, existing clck.ru shortening remains the fallback.
- Existing compressed `#z=` viewer links and legacy `#layout=` links continue to load and export JSON.

## Constraints

- Do not add runtime dependencies to the static client or local Node server.
- Do not commit secrets, production URLs, or generated local link data.
- A shared URL grants read-only access to its event snapshot to anyone holding the link.
- Cloudflare account-specific provisioning/deployment must be documented; do not claim it is live until credentials and bindings exist.
