import { cp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultSourceRoot = path.join(projectRoot, 'src');
const defaultOutputRoot = path.join(projectRoot, 'dist');

export function validateSiteUrl(value) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('SITE_URL must be an absolute http(s) origin, such as https://your-domain.tld.');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('SITE_URL must be an absolute http(s) origin, such as https://your-domain.tld.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash || value.trim() !== value) {
    throw new Error('SITE_URL must be an http(s) origin without credentials, a subpath, a query, or a fragment.');
  }
  return url.origin + '/';
}

const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)]
    .map((match) => [match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]]));
}

const escapeMarkup = (value) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function setAttribute(tag, name, value) {
  const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  const attribute = `${name}="${escapeMarkup(value)}"`;
  return pattern.test(tag) ? tag.replace(pattern, () => attribute) : tag.replace(/\s*\/?>$/, ` ${attribute}>`);
}

function pagePath(file, root) {
  const relative = path.relative(root, file).split(path.sep).join('/');
  return '/' + relative.replace(/(^|\/)index\.html$/, '$1');
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

// Leading-slash URLs belong to the built site's root, not the OS filesystem root.
async function localTarget(reference, fromFile, outputRoot, siteUrl) {
  if (!reference || reference.startsWith('#') || reference.startsWith('//')) return undefined;
  if (/^[a-z][a-z\d+.-]*:/i.test(reference)) {
    if (!siteUrl || !/^https?:/i.test(reference)) return undefined;
    const url = new URL(reference);
    if (url.origin !== new URL(siteUrl).origin) return undefined;
    reference = url.pathname;
  }
  const pathname = decodeURIComponent(reference.split(/[?#]/)[0]);
  if (!pathname) return undefined;
  if (/[\u0000-\u001f\u007f\\]/.test(pathname)) throw new Error('invalid local URL');
  const target = path.resolve(pathname.startsWith('/') ? outputRoot : path.dirname(fromFile),
    pathname.replace(/^\/+/, ''));
  if (!inside(outputRoot, target)) throw new Error('local URL escapes dist/');
  const info = await stat(target);
  const file = info.isDirectory() ? path.join(target, 'index.html') : target;
  if (!(await stat(file)).isFile() || !inside(outputRoot, await realpath(file))) {
    throw new Error('local URL is not a file inside dist/');
  }
  return file;
}

function htmlReferences(html) {
  const references = [];
  for (const match of html.matchAll(/<(?:[a-z][\w:-]*)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi)) {
    const attrs = attributes(match[0]);
    for (const name of ['href', 'src', 'poster']) if (attrs[name]) references.push(attrs[name]);
    if (attrs.srcset && !attrs.srcset.startsWith('data:')) {
      references.push(...attrs.srcset.split(',').map((item) => item.trim().split(/\s+/)[0]));
    }
    if (['og:image', 'twitter:image'].includes(attrs.property ?? attrs.name)) references.push(attrs.content);
  }
  return references;
}

function deploymentMetadata(html, file, outputRoot, siteUrl) {
  const pathname = pagePath(file, outputRoot);
  const url = new URL(pathname, siteUrl).href;
  let canonical = false;
  let ogUrl = false;
  html = html.replace(/<(?:meta|link)\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi, (tag) => {
    const attrs = attributes(tag);
    if (attrs.rel?.split(/\s+/).includes('canonical')) {
      canonical = true;
      return setAttribute(tag, 'href', url);
    }
    if (attrs.property === 'og:url') {
      ogUrl = true;
      return setAttribute(tag, 'content', url);
    }
    if (['og:image', 'twitter:image'].includes(attrs.property ?? attrs.name) && attrs.content) {
      return setAttribute(tag, 'content', new URL(attrs.content, url).href);
    }
    return tag;
  });
  // Error pages have no canonical destination and should not enter the sitemap.
  if (path.basename(file) !== '404.html') {
    const additions = [
      !canonical && `<link rel="canonical" href="${escapeMarkup(url)}">`,
      !ogUrl && `<meta property="og:url" content="${escapeMarkup(url)}">`
    ].filter(Boolean);
    html = html.replace(/<\/head>/i, additions.map((tag) => `    ${tag}\n`).join('') + '  </head>');
  }
  return html;
}

export async function build({
  sourceRoot = defaultSourceRoot,
  outputRoot = defaultOutputRoot,
  siteUrl = process.env.SITE_URL,
  logger = console
} = {}) {
  siteUrl = validateSiteUrl(siteUrl);
  sourceRoot = path.resolve(sourceRoot);
  outputRoot = path.resolve(outputRoot);
  if (inside(sourceRoot, outputRoot) || inside(outputRoot, sourceRoot)) {
    throw new Error('Source and output directories must be separate.');
  }
  if (!siteUrl) logger.warn('Warning: SITE_URL is not set. Canonical, social-image, robots, and sitemap URLs remain relative. Set SITE_URL to your deployment origin for production.');

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  await cp(sourceRoot, outputRoot, { recursive: true });

  const files = await walk(outputRoot);
  const htmlFiles = files.filter((file) => file.endsWith('.html'));
  if (siteUrl) {
    for (const file of htmlFiles) {
      await writeFile(file, deploymentMetadata(await readFile(file, 'utf8'), file, outputRoot, siteUrl));
    }
    const robotsFile = path.join(outputRoot, 'robots.txt');
    let robots;
    try {
      robots = await readFile(robotsFile, 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      robots = 'User-agent: *\nAllow: /\n';
    }
    const directive = `Sitemap: ${new URL('sitemap.xml', siteUrl).href}`;
    robots = /^Sitemap:.*$/im.test(robots) ? robots.replace(/^Sitemap:.*$/gim, directive) : robots.trimEnd() + '\n\n' + directive + '\n';
    await writeFile(robotsFile, robots);
    const locations = htmlFiles.filter((file) => path.basename(file) !== '404.html')
      .map((file) => `  <url><loc>${escapeMarkup(new URL(pagePath(file, outputRoot), siteUrl).href)}</loc></url>`);
    await writeFile(path.join(outputRoot, 'sitemap.xml'),
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      locations.join('\n') + '\n</urlset>\n');
  }

  const missing = new Set();
  for (const file of files) {
    let references = [];
    if (file.endsWith('.html')) references = htmlReferences(await readFile(file, 'utf8'));
    if (file.endsWith('.css')) {
      const css = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
      references = [...css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi)]
        .map((match) => match[1] ?? match[2] ?? match[3]);
      references.push(...[...css.matchAll(/@import\s+["']([^"']+)["']/gi)].map((match) => match[1]));
    }
    if (file.endsWith('.webmanifest')) {
      const manifest = JSON.parse(await readFile(file, 'utf8'));
      references = [manifest.start_url, ...(manifest.icons ?? []).map((icon) => icon.src)];
    }
    for (const reference of references) {
      try {
        await localTarget(reference, file, outputRoot, siteUrl);
      } catch (error) {
        missing.add(`${path.relative(outputRoot, file)} → ${reference} (${error.code === 'ENOENT' ? 'missing file' : error.message})`);
      }
    }
  }

  if (missing.size) throw new Error('Invalid local references:\n' + [...missing].join('\n'));
  logger.log(`Built ${htmlFiles.length} HTML pages to ${path.relative(projectRoot, outputRoot)}/`);
  return { htmlFiles: htmlFiles.length, siteUrl };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await build();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
