#!/usr/bin/env node

// Suppress warnings
process.env.NODE_NO_WARNINGS = '1';
process.emitWarning = (warning) => {
  if (warning && warning.toString().includes('localstorage-file')) return;
};

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { execSync } = require('child_process');
const { Command } = require('commander');

const PKG = require('../package.json');
const CONFIG_PATH = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.snp-config.json');

// Fast uninstall
if (process.argv[2] === 'uninstall') {
  console.log('Uninstalling snp-crcli globally...');
  try {
    execSync('npm uninstall -g snp-crcli', { stdio: 'inherit' });
    console.log('Done.');
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
const { PDFDocument } = require('pdf-lib');

// ---------- Stability Engine ----------
async function waitForStableFrame(page, { timeoutMs = 12000, quietMs = 800, pollMs = 300 } = {}) {
  const start = Date.now();
  let lastHash = null;
  let stableSince = null;

  while (Date.now() - start < timeoutMs) {
    try {
      const buf = await page.screenshot({ type: 'jpeg', quality: 35 });
      const hash = crypto.createHash('md5').update(buf).digest('hex');

      if (hash === lastHash) {
        if (!stableSince) stableSince = Date.now();
        if (Date.now() - stableSince >= quietMs) return hash;
      } else {
        stableSince = null;
      }
      lastHash = hash;
      await page.waitForTimeout(pollMs);
    } catch (_) { break; }
  }
  return lastHash;
}

async function readSlideIndicator(page) {
  return page.evaluate(() => {
    const selectors = [
      '.punch-viewer-navbar-page-number',
      '.punch-viewer-page-number-indicator',
      '[class*="page-number"]',
      '[aria-label*="Slide"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
    }
    const match = document.body.innerText.match(/\b(\d+)\s*\/\s*(\d+)\b/);
    return match ? match[0] : null;
  }).catch(() => null);
}

// ---------- Google Slides Smart Crawler ----------
async function crawlGoogleSlides(context, startUrl, { outDir, imgFormat, maxPages, progressBar }) {
  const page = await context.newPage();
  const trackingLog = [];
  let slideNum = 1;

  try {
    await page.goto(startUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForStableFrame(page);

    let lastIndicator = await readSlideIndicator(page);
    progressBar.start(maxPages, 0);

    while (slideNum <= maxPages) {
      // Wait for full content on this slide (handles multiple ArrowRight presses for builds)
      await waitForStableFrame(page);

      const filename = `slide_${String(slideNum).padStart(2, '0')}.${imgFormat}`;
      const finalPath = path.join(outDir, filename);

      await page.screenshot({ path: finalPath, fullPage: false, type: imgFormat });
      trackingLog.push({ slide: slideNum, filepath: finalPath, url: `${startUrl.href}#slide=${slideNum}` });

      progressBar.update(slideNum);

      // Move to next
      await page.keyboard.press('ArrowRight');
      const newHash = await waitForStableFrame(page);

      const currentIndicator = await readSlideIndicator(page);
      if (currentIndicator && lastIndicator && currentIndicator !== lastIndicator) {
        const prevNum = parseIndicatorNum(lastIndicator);
        const currNum = parseIndicatorNum(currentIndicator);
        if (currNum && prevNum && currNum <= prevNum) break; // looped or end
        lastIndicator = currentIndicator;
        slideNum++;
      } else if (newHash === await waitForStableFrame(page)) {
        break; // truly no change = end of deck
      } else {
        slideNum++;
      }
    }
    progressBar.update(Math.min(slideNum, maxPages));
  } finally {
    await page.close();
  }
  return trackingLog;
}

function parseIndicatorNum(text) {
  if (!text) return null;
  const m = text.match(/(\d+)\s*\/\s*(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

// ---------- Website Crawler ----------
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
      await waitForStableFrame(page);

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
    } catch (_) {} finally {
      await page.close();
    }
  }
  return trackingLog;
}

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

// ---------- Bundlers ----------
async function bundlePptx(trackingLog, outDir) {
  const pptx = new PptxGenJS();
  for (const item of trackingLog) {
    const slide = pptx.addSlide();
    slide.addImage({ path: item.filepath, x: 0, y: 0, w: '100%', h: '100%' });
  }
  const outPath = path.join(outDir, 'compiled_presentation.pptx');
  await pptx.writeFile({ fileName: outPath });
  trackingLog.forEach(i => fs.existsSync(i.filepath) && fs.unlinkSync(i.filepath));
  return outPath;
}

async function bundleDocx(trackingLog, outDir) {
  const children = [];
  for (const item of trackingLog) {
    children.push(new docx.Paragraph({
      children: [new docx.ImageRun({ data: fs.readFileSync(item.filepath), transformation: { width: 620, height: 380 } })]
    }));
    children.push(new docx.Paragraph({ text: item.url || '' }));
  }
  const doc = new docx.Document({ sections: [{ children }] });
  const buffer = await docx.Packer.toBuffer(doc);
  const outPath = path.join(outDir, 'compiled_document.docx');
  fs.writeFileSync(outPath, buffer);
  trackingLog.forEach(i => fs.existsSync(i.filepath) && fs.unlinkSync(i.filepath));
  return outPath;
}

async function bundlePdf(trackingLog, outDir) {
  const pdfDoc = await PDFDocument.create();
  for (const item of trackingLog) {
    const pngBytes = fs.readFileSync(item.filepath);
    const pngImage = await pdfDoc.embedPng(pngBytes);
    const page = pdfDoc.addPage([pngImage.width, pngImage.height]);
    page.drawImage(pngImage, { x: 0, y: 0, width: pngImage.width, height: pngImage.height });
  }
  const pdfBytes = await pdfDoc.save();
  const outPath = path.join(outDir, 'compiled_document.pdf');
  fs.writeFileSync(outPath, pdfBytes);
  trackingLog.forEach(i => fs.existsSync(i.filepath) && fs.unlinkSync(i.filepath));
  return outPath;
}

// ---------- Main ----------
async function main() {
  const program = new Command();
  program
    .name('snp')
    .version(PKG.version)
    .description('Smart crawler for websites & Google Slides → PNG/JPEG/PPTX/DOCX/PDF')
    .option('-u, --url <url>', 'Starting URL')
    .option('-o, --out <dir>', 'Output directory', './screenshots')
    .option('-f, --format <format>', 'png, jpeg, pptx, docx, pdf', 'png')
    .option('-m, --max <number>', 'Max slides/pages', '100')
    .option('-d, --depth <number>', 'Max link depth (websites)', '3')
    .option('--all-domains', 'Follow links to other domains')
    .option('--no-watermark', 'Skip watermark stripping prompt');

  program.parse();
  const opts = program.opts();

  let args;
  if (!opts.url && process.stdout.isTTY) {
    args = await inquirer.prompt([
      { type: 'input', name: 'url', message: 'URL to capture:' },
      { type: 'list', name: 'format', message: 'Output format:', choices: ['png', 'jpeg', 'pptx', 'docx', 'pdf'], default: 'png' },
      { type: 'input', name: 'out', message: 'Output folder:', default: './screenshots' },
      { type: 'input', name: 'max', message: 'Max slides/pages:', default: '100' },
      { type: 'confirm', name: 'stripWatermark', message: 'Strip watermarks/branding?', default: true }
    ]);
  } else {
    args = { ...opts, stripWatermark: !opts.noWatermark };
  }

  const startUrl = new URL(args.url);
  const outDir = path.resolve(args.out);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const format = args.format.toLowerCase();
  const imgFormat = ['pptx','docx','pdf'].includes(format) ? 'png' : format;
  const maxPages = Math.max(1, parseInt(args.max, 10) || 100);
  const maxDepth = Math.max(0, parseInt(args.depth, 10) || 3);
  const sameDomainOnly = !opts.allDomains;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

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

  if (format === 'pptx') {
    console.log('Building PPTX...');
    console.log(`Saved: ${await bundlePptx(trackingLog, outDir)}`);
  } else if (format === 'docx') {
    console.log('Building DOCX...');
    console.log(`Saved: ${await bundleDocx(trackingLog, outDir)}`);
  } else if (format === 'pdf') {
    console.log('Building PDF...');
    console.log(`Saved: ${await bundlePdf(trackingLog, outDir)}`);
  } else {
    console.log(`Saved ${trackingLog.length} screenshot(s) to ${outDir}`);
  }
}

main().catch(err => {
  console.error(`\nFatal error: ${err.message}`);
  process.exit(1);
});