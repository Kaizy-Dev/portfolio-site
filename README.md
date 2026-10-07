# KAIZY / Gael Franco — portfolio

A static portfolio built with vanilla HTML, CSS, and JavaScript. Node.js 20 or newer runs the build, preview server, and tests; there are no runtime or package dependencies.

## Local development

```sh
npm run build
npm run preview
```

Open `http://127.0.0.1:4173`. Use `PORT=8080 npm run preview` to change the local port. The preview serves the last build, so rebuild after editing `src/` and reload the page. It sends `no-store` caching headers, supports `GET` and `HEAD`, and returns the custom `404.html` with an actual 404 status for missing routes.

```sh
npm run check
```

This builds the site and runs Node's test runner. `npm test` alone tests an existing `dist/` alongside the source, so run a build first. Checks cover local assets (including root-relative URLs), section anchors, accessibility structure, social metadata, build URL generation, and the preview's status codes, HTTP methods, MIME types, and path containment. Browser checks for keyboard interaction, mobile layout, reduced motion, and the command menu are still useful alongside these static checks.

## Deployment URL and social previews

Set **`SITE_URL` at build time** to the site's public origin, including `https://`. A root trailing slash is accepted. Subpaths, credentials, queries, fragments, and non-HTTP(S) URLs are rejected. The site uses root-relative assets and is intended to be hosted at a domain root.

```sh
SITE_URL=https://your-domain.tld npm run check
```

Replace the example origin with the actual domain. With `SITE_URL` set, the build generates absolute canonical and `og:url` page URLs, resolves OG/Twitter image URLs, writes an absolute sitemap directive in `robots.txt`, and generates `sitemap.xml` from the HTML pages, excluding `404.html`. All rewriting happens in `dist/`; `src/` stays unchanged.

Without `SITE_URL`, the build emits an explicit warning and keeps the source's relative metadata for local use. It does not guess a domain or use a Vercel preview URL automatically. Set the production domain before publishing and rebuild after changing domains. If previews need their own absolute metadata, give the Preview environment its own `SITE_URL`.

The social preview is `src/assets/og-card.png`, referenced by both `og:image` and `twitter:image`. Keep it as a real PNG rather than an SVG; social crawlers need an image they can render. Check the generated `dist/index.html`, `dist/robots.txt`, and `dist/sitemap.xml` against your domain, and confirm the deployed image returns `200` with `Content-Type: image/png`.

## Deploy on Vercel

1. Import the repository in Vercel. If this folder is inside a larger repository, set **Root Directory** to `portfolio-site`.
2. Use **Other** for Framework Preset and Node.js 20 or newer. The included `vercel.json` sets **Build Command** to `npm run build` and **Output Directory** to `dist`.
3. Add `SITE_URL` under Project Settings → Environment Variables for Production, using the final public domain. Configure Preview separately if needed.
4. Deploy, attach the custom domain if applicable, and redeploy after changing `SITE_URL`.
5. Verify `/`, `/assets/og-card.png`, `/robots.txt`, `/sitemap.xml`, and a deliberately missing URL. The missing URL should serve the custom page with status `404`.

The deployment uses static file routing and Vercel's custom `404.html` handling. Security headers are configured for every route: content-type sniffing protection, frame denial, a referrer policy, restricted camera/microphone/geolocation access, a self-hosted content security policy, and HTTPS transport security. Unhashed files require cache revalidation so subsequent releases can update the same URLs.

## Deploy elsewhere

Build with the actual `SITE_URL`, then upload the contents of `dist/` to any static host. Configure the host to serve `404.html` with a 404 status and apply the headers from `vercel.json` as appropriate. JavaScript, CSS, fonts, and images are self-hosted. Preserve correct MIME types, especially `image/png`, `image/webp`, and `font/woff2`. This site does not need an application server in production.

## Project layout

- `src/` — editable pages, styles, scripts, brand assets, and real project screenshots.
- `scripts/build.mjs` — dependency-free copy/build, deployment metadata, and local-reference validation.
- `scripts/preview.mjs` — loopback-only static preview of `dist/`.
- `tests/static.test.mjs` — source/output checks and isolated build/HTTP regression tests.
- `dist/` — generated output; rebuild instead of editing it.
- `vercel.json` — static deployment settings and response headers.
