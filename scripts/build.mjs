// Zero-dependency static build: src/ + site.config.json -> dist/
// Pages use {{> partial}} includes and {{ config.path }} values, plus a small front matter block.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');
const config = JSON.parse(readFileSync(join(root, 'site.config.json'), 'utf8'));

// Derived values so templates never hard-code them.
const billingRaw = String(config.billing || 'one-time').trim();
const oneTime = /one[- ]?time/i.test(billingRaw);
config.billingLabel = billingRaw;
config.billingIsOneTime = oneTime;
config.priceNote = oneTime ? 'one-time payment' : billingRaw.replace(/^\//, 'per ').trim();
config.checkout = {};
for (const t of ['regular', 'premium']) {
  config.checkout[t] = config.tiers[t].checkoutUrl || '#checkout-not-connected';
}
if (config.freeBuildAvailable) {
  config.freeCta = { href: config.freeDownloadUrl, label: `Download free: ${config.tiers.free.importLimit} imports`, short: 'Download free' };
} else {
  const mail = `mailto:${config.contactEmail}?subject=${encodeURIComponent(config.name + ' early access')}`;
  config.freeCta = { href: config.waitlistUrl || mail, label: 'Get early access', short: 'Get early access' };
}
config.billingTrust = oneTime ? 'Pay once. No subscription' : `Billed ${billingRaw.replace(/^\//, 'per ').trim()}`;
config.siteHost = config.url.replace(/^https?:\/\//, '');

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function partial(name) {
  return readFileSync(join(src, 'partials', name + '.html'), 'utf8');
}

function render(tpl, ctx) {
  let out = tpl;
  for (let i = 0; i < 4 && /\{\{>/.test(out); i++) {
    out = out.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, n) => partial(n));
  }
  return out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, path) => {
    const v = get(ctx, path);
    if (v === undefined) throw new Error(`Unknown template value ${m} in ${ctx.page.src}`);
    return String(v);
  });
}

function frontMatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  const data = {};
  if (!m) return { data, body: raw };
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) data[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { data, body: raw.slice(m[0].length) };
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
for (const d of ['css', 'js', 'assets', 'static']) {
  if (existsSync(join(src, d))) cpSync(join(src, d), d === 'static' ? dist : join(dist, d), { recursive: true });
}

// Light CSS minification (comments and whitespace only) to keep the render-blocking file small.
const cssFile = join(dist, 'css', 'styles.css');
writeFileSync(cssFile, readFileSync(cssFile, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s*([{};,>])\s*/g, '$1')
  .replace(/:\s+/g, ':')
  .replace(/\s{2,}/g, ' ')
  .trim());

// Content hashes for cache busting (assets are cached by Vercel).
const hash = (f) => createHash('sha1').update(readFileSync(join(dist, f))).digest('hex').slice(0, 8);
const bust = { '/css/styles.css': hash('css/styles.css'), '/js/main.js': hash('js/main.js'), '/js/lenis.min.js': hash('js/lenis.min.js') };

const pages = [];
for (const file of walk(join(src, 'pages')).filter((f) => f.endsWith('.html'))) {
  const rel = relative(join(src, 'pages'), file).split(sep).join('/');
  const { data, body } = frontMatter(readFileSync(file, 'utf8'));
  const urlPath = rel === 'index.html' ? '/' : '/' + rel.replace(/index\.html$/, '');
  const page = {
    src: rel,
    title: esc(data.title || config.name),
    description: esc(data.description || config.tagline),
    path: urlPath,
    canonical: config.url + (urlPath === '/' ? '/' : urlPath),
    robots: data.robots || 'index,follow',
    bodyClass: data.bodyClass || '',
  };
  let html = render(body, { config, page });
  for (const [url, h] of Object.entries(bust)) html = html.split(`"${url}"`).join(`"${url}?v=${h}"`);
  const outFile = join(dist, rel);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, html);
  if (page.robots.startsWith('index')) pages.push(page);
}

const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  pages.map((p) => `  <url><loc>${p.canonical}</loc><lastmod>${config.lastUpdated}</lastmod></url>`).join('\n') +
  `\n</urlset>\n`;
writeFileSync(join(dist, 'sitemap.xml'), sitemap);
writeFileSync(join(dist, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${config.url}/sitemap.xml\n`);

console.log(`Built ${pages.length} pages -> dist/`);
