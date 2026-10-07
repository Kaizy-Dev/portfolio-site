import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, validateSiteUrl } from '../scripts/build.mjs';
import { createPreviewServer } from '../scripts/preview.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'src');
let tempRoot;
let tempDist;
let preview;
let baseUrl;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function response(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const requestHandle = request(url, { method }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    requestHandle.on('error', reject);
    requestHandle.end();
  });
}

async function responsePath(pathname, method = 'GET') {
  const parsed = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const requestHandle = request({ hostname: parsed.hostname, port: parsed.port, path: pathname, method }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    requestHandle.on('error', reject);
    requestHandle.end();
  });
}

before(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'kaizy-portfolio-tests-'));
  tempDist = path.join(tempRoot, 'dist');
  await build({ outputRoot: tempDist, siteUrl: 'https://portfolio.example', logger: { warn() {}, log() {} } });
  await writeFile(path.join(tempDist, 'sample.webp'), 'webp fixture');
  await writeFile(path.join(tempDist, 'sample.woff2'), 'woff2 fixture');
  preview = await createPreviewServer({ root: tempDist });
  await new Promise((resolve) => preview.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${preview.address().port}`;
});

after(async () => {
  preview?.close();
  await rm(tempRoot, { recursive: true, force: true });
});

test('portfolio contains the required entry points and supplied brand assets', async () => {
  for (const file of [
    'index.html', '404.html', 'styles.css', 'main.js', 'favicon.svg',
    'robots.txt', 'sitemap.xml', 'site.webmanifest',
    'assets/pulsepad-real.png', 'assets/receipt-game-real.png', 'assets/og-card.png'
  ]) assert.ok(existsSync(path.join(source, file)), `missing ${file}`);
});

test('home page has accessible structure, real links, and no missing local image paths', async () => {
  const html = await readFile(path.join(source, 'index.html'), 'utf8');
  for (const value of [
    'KAIZY', 'Gael Franco', 'Think and Make', 'PulsePad', 'The Receipt Game',
    'https://pulsepadlaunch.vercel.app/', 'https://thereceiptgame.vercel.app/',
    'https://github.com/Kaizy-Dev', 'https://guns.lol/kaizy_dude'
  ]) assert.match(html, new RegExp(escapeRegExp(value)));
  assert.match(html, /<html\s[^>]*lang=["']en["']/i);
  assert.match(html, /<main\b[^>]*id=["']main-content["']/i);
  assert.match(html, /<h1\b[^>]*id=["']hero-title["']/i);
  assert.match(html, /<nav\b[^>]*aria-label=["']Primary navigation["']/i);
  assert.match(html, /<a\b[^>]*class=["'][^"']*skip-link/);
  assert.match(html, /<img\b[^>]*alt=["'][^"']+['"][^>]*>/i);
  assert.doesNotMatch(html, /passionate developer|turning ideas into reality|innovative solutions/i);

  const ids = new Set([...html.matchAll(/\bid=["']([^"']+)["']/gi)].map((match) => match[1]));
  const anchors = [...html.matchAll(/\bhref=["']#([^"']+)["']/gi)].map((match) => match[1]);
  for (const id of anchors) assert.ok(ids.has(id), `anchor target #${id} is missing`);
  for (const image of [...html.matchAll(/\bsrc=["']([^"']+)["']/gi)].map((match) => match[1])) {
    if (!image.startsWith('/') || image.includes('://')) continue;
    assert.ok(existsSync(path.join(source, image.slice(1))), `missing local image ${image}`);
  }
  for (const image of [...html.matchAll(/(?:\bsrc|\bcontent)=["'](\/[^"']+\.(?:avif|gif|jpe?g|png|svg|webp)(?:\?[^"']*)?)["']/gi)].map((match) => match[1])) {
    assert.ok(existsSync(path.join(source, image.split(/[?#]/)[0].slice(1))), `missing local image ${image}`);
  }
  const css = await readFile(path.join(source, 'styles.css'), 'utf8');
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('deployment build emits absolute metadata without mutating source', async () => {
  const [sourceHtml, distHtml, robots, sitemap] = await Promise.all([
    readFile(path.join(source, 'index.html'), 'utf8'),
    readFile(path.join(tempDist, 'index.html'), 'utf8'),
    readFile(path.join(tempDist, 'robots.txt'), 'utf8'),
    readFile(path.join(tempDist, 'sitemap.xml'), 'utf8')
  ]);
  assert.equal(sourceHtml, await readFile(path.join(source, 'index.html'), 'utf8'));
  assert.match(distHtml, /<link rel="canonical" href="https:\/\/portfolio\.example\/">/);
  assert.match(distHtml, /<meta property="og:url" content="https:\/\/portfolio\.example\/">/);
  assert.match(distHtml, /<meta property="og:image" content="https:\/\/portfolio\.example\/assets\/og-card\.png">/);
  assert.match(distHtml, /<meta name="twitter:image" content="https:\/\/portfolio\.example\/assets\/og-card\.png">/);
  assert.match(robots, /Sitemap:\s+https:\/\/portfolio\.example\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/portfolio\.example\/<\/loc>/);
  assert.doesNotMatch(sitemap, /404/);
});

test('SITE_URL accepts only a deployment origin', () => {
  assert.equal(validateSiteUrl(undefined), undefined);
  assert.equal(validateSiteUrl('https://portfolio.example'), 'https://portfolio.example/');
  assert.equal(validateSiteUrl('https://portfolio.example/'), 'https://portfolio.example/');
  for (const value of [
    'portfolio.example', 'ftp://portfolio.example', 'https://portfolio.example/path',
    'https://portfolio.example/?preview=1', 'https://user:pass@portfolio.example'
  ]) assert.throws(() => validateSiteUrl(value), /SITE_URL/);
});

test('a local build warns instead of inventing a deployment URL', async () => {
  const localDist = path.join(tempRoot, 'local-dist');
  let warning = '';
  await build({
    outputRoot: localDist,
    siteUrl: '',
    logger: { warn(message) { warning = message; }, log() {} }
  });
  assert.match(warning, /SITE_URL.*not set/i);
  assert.match(await readFile(path.join(localDist, 'index.html'), 'utf8'), /<link rel="canonical" href="\/">/);
  assert.match(await readFile(path.join(localDist, 'robots.txt'), 'utf8'), /Sitemap:\s+\/sitemap\.xml/);
  assert.match(await readFile(path.join(localDist, 'sitemap.xml'), 'utf8'), /<loc>\/<\/loc>/);
});

test('preview returns secure, typed responses and real 404/HEAD behavior', async () => {
  const home = await response(`${baseUrl}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers['content-type'], /text\/html/);
  assert.equal(home.headers['x-content-type-options'], 'nosniff');
  assert.equal(home.headers['x-frame-options'], 'DENY');
  assert.equal(home.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  const image = await response(`${baseUrl}/assets/og-card.png`, 'HEAD');
  assert.equal(image.status, 200);
  assert.match(image.headers['content-type'], /^image\/png/);
  assert.equal(image.body.length, 0);
  const webp = await response(`${baseUrl}/sample.webp`);
  assert.equal(webp.status, 200);
  assert.match(webp.headers['content-type'], /^image\/webp/);
  const font = await response(`${baseUrl}/sample.woff2`);
  assert.equal(font.status, 200);
  assert.match(font.headers['content-type'], /^font\/woff2/);
  const missing = await response(`${baseUrl}/does-not-exist`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers['content-type'], /text\/html/);
  const traversal = await responsePath('/%2e%2e/package.json');
  assert.equal(traversal.status, 403);
  const malformed = await response(`${baseUrl}/%E0%A4%A`);
  assert.equal(malformed.status, 400);
  const malformedQuery = await response(`${baseUrl}/?bad=%E0%A4%A`);
  assert.equal(malformedQuery.status, 400);
  const method = await response(`${baseUrl}/`, 'POST');
  assert.equal(method.status, 405);
  assert.match(method.headers.allow, /GET/);
});
