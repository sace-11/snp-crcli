#!/usr/bin/env node

const { chromium } = require('playwright');
const { Command } = require('commander');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const program = new Command();

program
  .name('snp')
  .description('Crawl a site and screenshot every page it finds')
  .version(require('../package.json').version)
  .requiredOption('-u, --url <url>', 'Starting URL to crawl')
  .option('-o, --out <dir>', 'Output directory', './screenshots')
  .option('-f, --format <format>', 'Image format: png or jpeg', 'png')
  .option('-m, --max <number>', 'Max pages to crawl', '50')
  .option('-d, --depth <number>', 'Max link depth', '3')
  .option('--full-page', 'Capture full scrollable page', true)
  .option('--width <px>', 'Viewport width', '1440')
  .option('--height <px>', 'Viewport height', '900')
  .option('--same-domain-only', 'Only follow links on the same domain', true)
  .option('--cookies <path>', 'Path to a JSON file of cookies to load before crawling')
  .parse(process.argv);

const opts = program.opts();

const startUrl = new URL(opts.url);
const outDir = path.resolve(opts.out);
const format = opts.format.toLowerCase() === 'jpeg' ? 'jpeg' : 'png';
const maxPages = parseInt(opts.max, 10);
const maxDepth = parseInt(opts.depth, 10);

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

function urlToFilename(url) {
  const u = new URL(url);
  let p = (u.pathname === '/' || u.pathname === '') ? 'home' : u.pathname;
  p = p.replace(/^\/|\/$/g, '').replace(/\//g, '_');
  if (!p) p = 'home';
  const query = u.search ? '_' + u.search.replace(/[?&=]/g, '-') : '';
  const safe = (p + query).replace(/[^a-zA-Z0-9-_]/g, '');
  return `${safe || 'page'}.${format}`;
}

async function crawl() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: parseInt(opts.width, 10), height: parseInt(opts.height, 10) }
  });

  if (opts.cookies) {
    try {
      const cookiesRaw = fs.readFileSync(path.resolve(opts.cookies), 'utf-8');
      const cookies = JSON.parse(cookiesRaw);
      await context.addCookies(cookies);
      console.log(`Loaded cookies from ${opts.cookies}`);
    } catch (err) {
      console.error(`Could not load cookies file: ${err.message}`);
    }
  }

  const visited = new Set();
  const queue = [{ url: startUrl.href, depth: 0 }];
  let count = 0;
  const log = [];

  while (queue.length > 0 && count < maxPages) {
    const { url, depth } = queue.shift();
    if (visited.has(url) || depth > maxDepth) continue;
    visited.add(url);

    const page = await context.newPage();
    try {
      console.log(`[${count + 1}/${maxPages}] Visiting: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

      const filename = urlToFilename(url);
      const filepath = path.join(outDir, filename);

      let finalPath = filepath;
      let dupeIndex = 1;
      while (fs.existsSync(finalPath)) {
        const base = path.basename(filename, `.${format}`);
        finalPath = path.join(outDir, `${base}_${dupeIndex}.${format}`);
        dupeIndex++;
      }

      await page.screenshot({
        path: finalPath,
        fullPage: opts.fullPage !== false,
        type: format
      });

      log.push({ url, file: path.basename(finalPath) });
      count++;

      if (depth < maxDepth) {
        const links = await page.$$eval('a[href]', as => as.map(a => a.href));
        for (const link of links) {
          try {
            const linkUrl = new URL(link);
            linkUrl.hash = '';
            const clean = linkUrl.href;
            const sameDomain = linkUrl.hostname === startUrl.hostname;
            if (
              !visited.has(clean) &&
              (!opts.sameDomainOnly || sameDomain) &&
              /^https?:$/.test(linkUrl.protocol)
            ) {
              queue.push({ url: clean, depth: depth + 1 });
            }
          } catch (_) {}
        }
      }
    } catch (err) {
      console.error(`  Failed: ${url} — ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();

  fs.writeFileSync(
    path.join(outDir, '_manifest.json'),
    JSON.stringify(log, null, 2)
  );

  console.log(`\nDone. ${count} pages saved to ${outDir}`);
}

crawl();
