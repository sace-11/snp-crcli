#!/usr/bin/env node
'use strict';

// Suppress annoying Playwright/Chromium warnings
process.env.NODE_NO_WARNINGS = '1';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { execSync } = require('child_process');
const { Command } = require('commander');

const PKG = require('../package.json');
const CONFIG_PATH = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.snp-config.json');

// --- Fast path: uninstall ---
if (process.argv[2] === 'uninstall') {
  console.log('Uninstalling snp-crcli globally...');
  try {
    execSync('npm uninstall -g snp-crcli', { stdio: 'inherit' });
    console.log('Done. snp-crcli has been removed from this machine.');
  } catch (err) {
    console.error('Could not auto-uninstall. Run manually: npm uninstall -g snp-crcli');
    process.exitCode = 1;
  }
  process.exit(0);
}

const { chromium } = require('playwright');
const inquirer = require('inquirer');
const cliProgress = require('cli-progress');
const PptxGenJS = require('pptxgenjs');
const docx = require('docx');

// ... rest of your existing code stays exactly the same ...

// ---------- config ----------
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (_) {}
  return null;
}
function saveConfig(cfg) {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch (_) {}
}

// ---------- content-stability engine ----------
// Instead of trusting 'networkidle' (which never fires on sites with persistent
// sockets, like Google Slides), this hashes the visible frame every ~200ms and
// only returns once the picture stops changing for a short quiet period.
async function waitForStableFrame(page, { timeoutMs = 8000, quietMs = 450, pollMs = 200 } = {}) {
  const start = Date.now();
  let lastHash = null;
  let stableSince = null;

  while (Date.now() - start < timeoutMs) {
    let hash;
    try {
      const buf = await page.screenshot({ type: 'jpeg', quality: 35 });
      hash = crypto.createHash('md5').update(buf).digest('hex');
    } catch (_) {
      break; // page mid-navigation or closed; bail out cleanly
    }

    if (hash === lastHash) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= quietMs) return hash;
    } else {
      stableSince = null;
    }
    lastHash = hash;
    await page.waitForTimeout(pollMs);
  }
  return lastHash;
}

async function settlePage(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  return waitForStableFrame(page);
}

function parseIndicatorNum(text) {
  if (!text) return null;
  const m = text.match(/(\d+)\s*\/\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

async function readSlideIndicator(page) {
  return page.evaluate(() => {
    const selectors = [
      '.punch-viewer-navbar-page-number',
      '.punch-viewer-page-number-indicator',
      '[class*="page-number"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
    }
    const match = document.body.innerText.match(/\b\d+\s*\/\s*\d+\b/);
    return match ? match[0] : null;
  }).catch(() => null);
}

// ---------- filename helpers ----------
function urlToFilename(targetUrl, ext) {
  const u = new URL(targetUrl);
  let p = (u.pathname === '/' || u.pathname === '') ? 'home' : u.pathname;
  p = p.replace(/^\/|\/$/g, '').replace(/\//g, '_');
  const query = u.search ? '_' + u.search.replace(/[?&=]/g, '-') : '';
  const safe = (p + query).replace(/[^a-zA-Z0-9-_]/g, '') || 'page';
  return `${safe}.${ext}`;
}

function uniquePath(dir, filename, ext) {
  let finalPath = path.join(dir, filename);
  let i = 1;
  const base = path.basename(filename, `.${ext}`);
  while (fs.existsSync(finalPath)) {
    finalPath = path.join(dir, `${base}_${i}.${ext}`);
    i++;
  }
  return finalPath;
}

// ---------- Google Slides capture ----------
// Presses ArrowRight repeatedly. If the on-screen page counter changes, we've
// moved to a new slide, so the last frame saved under the old slide number was
// its fully-built final state. If the counter DOESN'T change but the frame did,
// we're mid-build on the same slide — we overwrite that slide's file with the
// newer, more complete frame and keep going.
async function crawlGoogleSlides(context, startUrl, { outDir, imgFormat, maxPages, progressBar }) {
  const page = await context.newPage();
  const trackingLog = [];
  try {
    await page.goto(startUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settlePage(page);

    let slideNum = 1;
    let lastIndicator = await readSlideIndicator(page);
    const indicatorSupported = lastIndicator !== null;

    let totalHint = null;
    const m = lastIndicator ? lastIndicator.match(/(\d+)\s*\/\s*(\d+)/) : null;
    if (m) totalHint = parseInt(m[2], 10);
    const target = totalHint ? Math.min(maxPages, totalHint) : maxPages;
    progressBar.start(target, 0);

    const maxIterations = maxPages * 8; // safety net against pathological build sequences
    let iterations = 0;
    let lastFrameHash = await waitForStableFrame(page);

    while (slideNum <= maxPages && iterations < maxIterations) {
      iterations++;

      const filename = `slide_${String(slideNum).padStart(2, '0')}.${imgFormat}`;
      const finalPath = path.join(outDir, filename);
      await page.screenshot({ path: finalPath, fullPage: false, type: imgFormat });

      if (!trackingLog.find(t => t.slide === slideNum)) {
        trackingLog.push({ url: `${startUrl.href}#slide=${slideNum}`, file: filename, filepath: finalPath, slide: slideNum });
      }

      await page.keyboard.press('ArrowRight');
      const newHash = await waitForStableFrame(page);

      if (newHash === lastFrameHash) break; // nothing changed — end of deck
      lastFrameHash = newHash;

      if (indicatorSupported) {
        const indicator = await readSlideIndicator(page);
        if (indicator && indicator !== lastIndicator) {
          const prevNum = parseIndicatorNum(lastIndicator);
          const nextNum = parseIndicatorNum(indicator);
          if (prevNum !== null && nextNum !== null && nextNum < prevNum) break; // looped back to slide 1
          lastIndicator = indicator;
          slideNum++;
          progressBar.update(Math.min(slideNum - 1, target));
        }
        // else: still mid-build on the same slide — loop back and overwrite this file
      } else {
        // No page-counter found on this deck's markup; treat every distinct
        // frame as a new slide so nothing gets silently dropped.
        slideNum++;
        progressBar.update(Math.min(slideNum - 1, target));
      }
    }
    progressBar.update(Math.min(slideNum, target));
  } finally {
    await page.close();
  }
  return trackingLog;
}

// ---------- regular website crawl ----------
async function crawlWebsite(context, startUrl, { outDir, imgFormat, maxPages, maxDepth, sameDomainOnly, progressBar }) {
  const visited = new Set();
  const queue = [{ url: startUrl.href, depth: 0 }];
  const trackingLog = [];
  let count = 0;
  progressBar.start(maxPages, 0);

  while (queue.length > 0 && count < maxPages) {
    const { url, depth } = queue.shift();
    if (visited.has(url) || depth > maxDepth) continue;
    visited.add(url);

    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await settlePage(page);

      const filename = urlToFilename(url, imgFormat);
      const finalPath = uniquePath(outDir, filename, imgFormat);
      await page.screenshot({ path: finalPath, fullPage: true, type: imgFormat });
      trackingLog.push({ url, file: path.basename(finalPath), filepath: finalPath });

      count++;
      progressBar.update(count);

      if (depth < maxDepth) {
        const links = await page.$$eval('a[href]', as => as.map(a => a.href)).catch(() => []);
        for (const link of links) {
          try {
            const linkUrl = new URL(link);
            linkUrl.hash = '';
            const clean = linkUrl.href;
            const sameDomain = linkUrl.hostname === startUrl.hostname;
            if (!visited.has(clean) && (!sameDomainOnly || sameDomain) && /^https?:$/.test(linkUrl.protocol)) {
              queue.push({ url: clean, depth: depth + 1 });
            }
          } catch (_) {}
        }
      }
    } catch (_) {
      // one bad page shouldn't kill the whole crawl
    } finally {
      await page.close();
    }
  }
  return trackingLog;
}

// ---------- bundlers ----------
async function bundlePptx(trackingLog, outDir) {
  const pptx = new PptxGenJS();
  for (const item of trackingLog) {
    const slide = pptx.addSlide();
    slide.addImage({ path: item.filepath, x: 0, y: 0, w: '100%', h: '100%' });
  }
  const outPath = path.join(outDir, 'compiled_presentation.pptx');
  await pptx.writeFile({ fileName: outPath });
  for (const item of trackingLog) fs.existsSync(item.filepath) && fs.unlinkSync(item.filepath);
  return outPath;
}

async function bundleDocx(trackingLog, outDir) {
  const children = [];
  for (const item of trackingLog) {
    children.push(new docx.Paragraph({
      children: [new docx.ImageRun({ data: fs.readFileSync(item.filepath), transformation: { width: 620, height: 380 } })]
    }));
    children.push(new docx.Paragraph({ text: item.url }));
  }
  const doc = new docx.Document({ sections: [{ children }] });
  const buffer = await docx.Packer.toBuffer(doc);
  const outPath = path.join(outDir, 'compiled_document.docx');
  fs.writeFileSync(outPath, buffer);
  for (const item of trackingLog) fs.existsSync(item.filepath) && fs.unlinkSync(item.filepath);
  return outPath;
}

// ---------- link shortener ----------
async function shortenUrl(longUrl) {
  const res = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(longUrl)}`);
  if (!res.ok) throw new Error(`shortener API returned HTTP ${res.status}`);
  return (await res.text()).trim();
}

// ---------- interactive wizard ----------
async function runWizard(defaultFormat) {
  const { url } = await inquirer.prompt([
    { type: 'input', name: 'url', message: 'URL to capture:', validate: v => v.trim() ? true : 'A URL is required.' }
  ]);
  const isSlides = url.includes('docs.google.com') && url.includes('/presentation');

  const questions = [
    { type: 'list', name: 'format', message: 'Output format:', choices: ['png', 'jpeg', 'pptx', 'docx'], default: defaultFormat },
    { type: 'input', name: 'out', message: 'Output folder:', default: './screenshots' },
    { type: 'input', name: 'max', message: isSlides ? 'Max slides:' : 'Max pages:', default: '50' }
  ];
  if (!isSlides) {
    questions.push({ type: 'input', name: 'depth', message: 'Link depth:', default: '3' });
  }
  const rest = await inquirer.prompt(questions);
  return { url, ...rest, depth: rest.depth || '0' };
}

// ---------- main ----------
async function main() {
  const program = new Command();
  program
    .name('snp')
    .version(PKG.version)
    .description('Crawls a website or a Google Slides deck and saves screenshots as PNG, JPEG, PPTX, or DOCX.')
    .option('-u, --url <url>', 'starting URL to capture')
    .option('-o, --out <dir>', 'output directory', './screenshots')
    .option('-f, --format <format>', 'png, jpeg, pptx, or docx')
    .option('-m, --max <number>', 'max pages/slides to capture', '50')
    .option('-d, --depth <number>', 'max link depth for website crawls', '3')
    .option('--all-domains', 'also follow links to other domains (default: same-domain only)')
    .option('--width <px>', 'viewport width', '1440')
    .option('--height <px>', 'viewport height', '900')
    .option('--sl <url>', 'shorten a URL and exit');

  program.addHelpText('after', `
Examples:
  $ snp                                    Launch the interactive wizard
  $ snp -u https://example.com -f pptx     Crawl a site, bundle output to PPTX
  $ snp -u "<google slides link>" -f docx  Capture every slide of a published deck
  $ snp --sl "https://long-url.com/..."    Shorten a URL
  $ snp uninstall                          Remove snp-crcli from this machine
`);

  program.parse(process.argv);
  const opts = program.opts();

  if (opts.sl) {
    try {
      console.log(await shortenUrl(opts.sl));
    } catch (err) {
      console.error(`Could not shorten URL: ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  let config = loadConfig();
  if (!config) {
    if (process.stdout.isTTY) {
      console.log("First run — let's set a default format.");
      const { defaultFormat } = await inquirer.prompt([
        { type: 'list', name: 'defaultFormat', message: 'Default output format:', choices: ['png', 'jpeg', 'pptx', 'docx'] }
      ]);
      config = { defaultFormat };
      saveConfig(config);
    } else {
      config = { defaultFormat: 'png' };
    }
  }

  let args;
  if (!opts.url && process.stdout.isTTY) {
    args = await runWizard(config.defaultFormat);
  } else if (!opts.url) {
    program.help();
    return;
  } else {
    args = {
      url: opts.url,
      out: opts.out,
      format: opts.format || config.defaultFormat,
      max: opts.max,
      depth: opts.depth
    };
  }

  const startUrl = new URL(args.url);
  const outDir = path.resolve(args.out);
  const format = ['png', 'jpeg', 'pptx', 'docx'].includes((args.format || '').toLowerCase())
    ? args.format.toLowerCase()
    : 'png';
  const imgFormat = ['pptx', 'docx'].includes(format) ? 'png' : format;
  const maxPages = Math.max(1, parseInt(args.max, 10) || 50);
  const maxDepth = Math.max(0, parseInt(args.depth, 10) || 0);
  const sameDomainOnly = !opts.allDomains;

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log(`Target: ${startUrl.href}`);
  console.log(`Output: ${outDir}`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: parseInt(args.width || '1440', 10), height: parseInt(args.height || '900', 10) }
  });

  const progressBar = new cliProgress.SingleBar({
    format: 'Capturing |{bar}| {percentage}% | {value}/{total}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  }, cliProgress.Presets.shades_classic);

  const isGoogleSlides = startUrl.hostname.includes('docs.google.com') && startUrl.pathname.includes('/presentation');

  let trackingLog;
  try {
    trackingLog = isGoogleSlides
      ? await crawlGoogleSlides(context, startUrl, { outDir, imgFormat, maxPages, progressBar })
      : await crawlWebsite(context, startUrl, { outDir, imgFormat, maxPages, maxDepth, sameDomainOnly, progressBar });
  } finally {
    progressBar.stop();
    await browser.close();
  }

  if (!trackingLog.length) {
    console.log('Nothing was captured. Check the URL and try again.');
    return;
  }

  if (format === 'pptx') {
    console.log('Building .pptx...');
    console.log(`Saved: ${await bundlePptx(trackingLog, outDir)}`);
  } else if (format === 'docx') {
    console.log('Building .docx...');
    console.log(`Saved: ${await bundleDocx(trackingLog, outDir)}`);
  } else {
    fs.writeFileSync(
      path.join(outDir, '_manifest.json'),
      JSON.stringify(trackingLog.map(i => ({ url: i.url, file: i.file })), null, 2)
    );
    console.log(`Saved ${trackingLog.length} screenshot(s) to ${outDir}`);
  }
}

main().catch(err => {
  console.error(`\nFatal error: ${err.message}`);
  process.exit(1);
});