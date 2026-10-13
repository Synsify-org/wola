# Wola web app

The Next.js (App Router) front end for Wola, a multi-tenant staff-loan system.
Each organisation ("tenant") is served on its own subdomain; almost every page
is behind a login.

```bash
npm run dev      # from this folder: http://<tenant>.localhost:3000
npm run build    # production build (webpack)
npm run test     # component and unit tests (vitest)
```

Environment is read from `apps/web/.env.local` (see the repo root README for the
database setup). Useful variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Runtime database role (`wola_app`, row-level-security bound). Never an admin credential. |
| `WOLA_BASE_DOMAIN` | The apex domain tenants are served under, e.g. `wola.africa`. |
| `SITE_URL` | Fallback public origin (canonical URLs, sitemap) when a request carries no host. |

How the app is put together, and why, is in the repo root: `README.md`,
`DECISIONS.md` and `TASKS.md`.

## Public pages and search engines

Only the sign-in page is indexable. Every other route is `noindex` (meta tag and
`X-Robots-Tag` header) because it shows loan, employee and salary data.
`/robots.txt`, `/sitemap.xml` and `/llms.txt` are generated from the host that
served the request, so a custom domain needs no code change.
