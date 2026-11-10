# Cloudflare Worker link shortener

This Worker stores immutable viewer URLs in D1. The app sends `POST /api/links` with JSON `{ "url": "https://kotatsu-map.1lop.ru/?view=1#z=..." }`; the API returns `{ "shortUrl": "https://<worker-host>/<id>" }`. Opening the short URL redirects to the stored viewer. Anyone holding it can view the event and download its JSON.

## Deploy

Use Node.js 18+ and Wrangler 4.36+ (`npx wrangler@latest`). From this directory:

```sh
npx wrangler login
npx wrangler d1 create kotatsu-map-links
```

Put the returned database ID into `database_id` in `wrangler.toml`, then apply the schema and deploy:

```sh
npx wrangler d1 migrations apply kotatsu-map-links --remote
npx wrangler deploy
```

Copy the deployed Worker URL and set it as `window.KOTATSU_SHARE_API` in `../data/share-config.js`, ending in `/api/links`. Push that file to publish the Worker integration. The app currently retains clck.ru as fallback when the Worker is not configured or unavailable.

The Worker accepts only viewer URLs for `https://kotatsu-map.1lop.ru`, only browser requests from that origin, and request bodies up to 64 KiB. It applies a 20-create-per-minute rate limit by client IP (Cloudflare enforces the counter per data-center location). D1 does not expire links automatically; remove rows from the `links` table to revoke them. Do not put confidential information in a shared event.
