#!/usr/bin/env node
'use strict';

// === AGGRESSIVE WARNING SUPPRESSION ===
process.env.NODE_NO_WARNINGS = '1';
process.env.NODE_OPTIONS = '--no-warnings';
process.emitWarning = (warning, ...args) => {
  if (warning && warning.toString().includes('localstorage-file')) return;
  console.warn(warning, ...args);
};

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');
const { execSync } = require('child_process');
const { Command } = require('commander');
const readline = require('readline');
const os = require('os');

function chooseFolderOS() {
  try {
    const platform = os.platform();
    if (platform === 'darwin') {
      return execSync('osascript -e \'POSIX path of (choose folder with prompt "Select Output Directory")\'', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } else if (platform === 'win32') {
      const psScript = `
        Add-Type -AssemblyName System.windows.forms;
        $f = New-Object System.Windows.Forms.FolderBrowserDialog;
        $f.Description = 'Select Output Directory';
        $f.ShowNewFolderButton = $true;
        if($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK){ $f.SelectedPath }
      `;
      return execSync(`powershell -Command "${psScript.replace(/\n/g, ' ')}"`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } else {
      return execSync('zenity --file-selection --directory --title="Select Output Directory"', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    }
  } catch (err) {
    return null;
  }
}

const PKG = require('../package.json');
const CONFIG_PATH = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.clearpass-config.json');

global.isCapturing = false;
global.abortCapture = false;

try {
  readline.emitKeypressEvents(process.stdin);
} catch (_) {}

process.stdin.on('keypress', (str, key) => {
  if (key && key.ctrl && key.name === 'q') {
    if (global.isCapturing) {
      global.abortCapture = true;
    } else {
      process.exit(0);
    }
  }
});

// --- Fast path: uninstall ---
if (process.argv[2] === 'uninstall') {
  console.log('Uninstalling clearpass globally...');
  try {
    execSync('npm uninstall -g clearpass', { stdio: 'inherit' });
    execSync('npm uninstall -g snp-crcli', { stdio: 'inherit' });
    console.log('Done. clearpass has been removed from this machine.');
  } catch (err) {
    console.error('Could not auto-uninstall. Run manually: npm uninstall -g clearpass');
    process.exitCode = 1;
  }
  process.exit(0);
}

const { chromium } = require('playwright');
const cliProgress = require('cli-progress');
const PptxGenJS = require('pptxgenjs');
const docx = require('docx');
const chalk = require('chalk');
const { PDFDocument, PDFName, PDFString, PDFArray, PDFDict } = require('pdf-lib');
const TurndownService = require('turndown');
const { NodeHtmlMarkdown } = require('node-html-markdown');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (_) {}
  return { defaultFormat: 'png', maxPages: 300, outDir: './screenshots' };
}

function saveConfig(cfg) {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2)); } catch (_) {}
}

let config = loadConfig();
if (config.maxPages === undefined) config.maxPages = 300;
if (config.outDir === undefined) config.outDir = './screenshots';

// ---------- content-stability engine ----------
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
      break; 
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

async function checkForCaptcha(page) {
  try {
    const isCaptcha = await page.evaluate(() => {
      const text = document.body.innerText.toLowerCase();
      if (text.includes('checking if the site connection is secure') || text.includes('verify you are human') || text.includes('just a moment...') || text.includes('verification successful')) return 'Cloudflare / Security check';
      if (document.querySelector('iframe[src*="recaptcha"]')) return 'reCAPTCHA';
      if (document.querySelector('iframe[src*="hcaptcha"]')) return 'hCaptcha';
      if (document.querySelector('#challenge-running')) return 'Cloudflare Turnstile';
      return null;
    });
    return isCaptcha;
  } catch (e) {
    return null;
  }
}

async function settlePage(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  
  // Wait up to 25 seconds for Cloudflare/Security checks to auto-resolve
  let wasBlocked = false;
  try {
    for (let i = 0; i < 25; i++) {
      const title = await page.title();
      const isCaptcha = await checkForCaptcha(page);
      if (title.toLowerCase().includes('just a moment') || isCaptcha) {
        wasBlocked = true;
        await page.waitForTimeout(1000);
      } else {
        break;
      }
    }
  } catch (e) {}

  if (wasBlocked) {
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(2000);
  }

  await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
  
  const captcha = await checkForCaptcha(page);
  if (captcha) {
    throw new Error(`Blocked by security check or CAPTCHA (${captcha}). Login needed or manual bypass required.`);
  }

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
function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') return '';
  const safe = name
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.]+|[.]+$/g, '')
    .trim()
    .slice(0, 120);
  return safe === '.' || safe === '..' ? '' : safe;
}

function urlToFilename(targetUrl, ext, title = null) {
  if (title) {
    const safe = sanitizeFilename(title);
    if (safe) return `${safe}.${ext}`;
  }
  const u = new URL(targetUrl);
  const host = u.hostname.replace(/^www\./, '');
  const hash = crypto.randomBytes(2).toString('hex');
  return `${host}-${hash}.${ext}`;
}

function uniquePath(dir, filename, ext) {
  let finalPath = path.join(dir, filename);
  if (!fs.existsSync(finalPath)) return finalPath;
  let i = 1;
  const base = path.basename(filename, `.${ext}`);
  while (true) {
    finalPath = path.join(dir, `${base}(${i}).${ext}`);
    if (!fs.existsSync(finalPath)) return finalPath;
    i++;
  }
}

// ---------- captures ----------
async function downloadNativeGoogleSlides(page, startUrl, format, outDir) {
  const match = startUrl.pathname.match(/\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) throw new Error('Could not extract Google Slides ID');
  const slideId = match[1];
  
  const exportUrl = `https://docs.google.com/presentation/d/${slideId}/export/${format}`;
  
  console.log(chalk.yellow(`\nDownloading native ${format.toUpperCase()} with full interactivity...`));

  // Capture presentation title before triggering export download
  await page.goto(startUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await settlePage(page);
  const pageTitle = await page.title().catch(() => '');
  
  const downloadPromise = page.waitForEvent('download', { timeout: 4000 });
  await page.goto(exportUrl);
  const download = await downloadPromise;
  
  const filename = urlToFilename(startUrl.href, format, pageTitle);
  const finalPath = uniquePath(outDir, filename, format);
  await download.saveAs(finalPath);
  console.log(chalk.green(`\u2714 Saved native export: ${finalPath}`));
  return true; 
}

async function crawlPresentation(context, startUrl, { outDir, imgFormat, maxPages, progressBar }) {
  const page = await context.newPage();
  let pageTitle = '';
  const trackingLog = [];
  try {
    await page.goto(startUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settlePage(page);
    pageTitle = await page.title().catch(() => '');

    let slideNum = 1;
    let lastIndicator = await readSlideIndicator(page);
    const indicatorSupported = lastIndicator !== null;

    let totalHint = null;
    const m = lastIndicator ? lastIndicator.match(/(\d+)\s*\/\s*(\d+)/) : null;
    if (m) totalHint = parseInt(m[2], 10);
    const target = totalHint ? Math.min(maxPages, totalHint) : maxPages;
    const isKnownTotal = !!totalHint;
    
    if (progressBar) {
      console.log(chalk.dim('Press Ctrl+Q to abort capture...'));
      progressBar.options.format = isKnownTotal 
        ? `${chalk.blue('{bar}')} {percentage}% | {value}/{total} pages`
        : `${chalk.blue('Capturing...')} {value} slides captured`;
      progressBar.start(target, 0);
    }

    const maxIterations = target * 8; 
    let iterations = 0;
    let sameFrameCount = 0;
    let lastFrameHash = await waitForStableFrame(page);

    while (slideNum <= target && iterations < maxIterations) {
      if (global.abortCapture) {
        console.log(chalk.red('\n[Interrupt] Capture aborted by user.'));
        // Clean up all files saved so far
        for (const item of trackingLog) {
          try { if (fs.existsSync(item.filepath)) fs.unlinkSync(item.filepath); } catch (_) {}
        }
        trackingLog.length = 0;
        break;
      }
      iterations++;

      const filename = urlToFilename(startUrl.href, imgFormat, pageTitle);
      const finalPath = uniquePath(outDir, filename, imgFormat);
      await page.screenshot({ path: finalPath, fullPage: false, type: imgFormat });

      const pageW = await page.evaluate(() => window.innerWidth);
      const pageH = await page.evaluate(() => window.innerHeight);
      const links = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]')).map(a => {
          const rect = a.getBoundingClientRect();
          return { href: a.href, x: rect.x, y: rect.y, w: rect.width, h: rect.height };
        }).filter(l => l.w > 0 && l.h > 0);
      });

      if (!trackingLog.find(t => t.slide === slideNum)) {
        trackingLog.push({ url: startUrl.href, file: filename, filepath: finalPath, slide: slideNum, links, pageW, pageH });
      }

      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(100);
      const newHash = await waitForStableFrame(page);

      if (newHash === lastFrameHash) {
        await page.keyboard.press('Space');
        const hash2 = await waitForStableFrame(page, { timeoutMs: 2000, quietMs: 200 });
        if (hash2 === lastFrameHash) {
          sameFrameCount++;
          if (sameFrameCount > 2) break;
        } else {
          lastFrameHash = hash2;
          sameFrameCount = 0;
        }
      } else {
        lastFrameHash = newHash;
        sameFrameCount = 0;
      }

      if (indicatorSupported) {
        const indicator = await readSlideIndicator(page);
        if (indicator && indicator !== lastIndicator) {
          const prevNum = parseIndicatorNum(lastIndicator);
          const nextNum = parseIndicatorNum(indicator);
          if (prevNum !== null && nextNum !== null && nextNum <= prevNum) break; 
          lastIndicator = indicator;
        }
      }
      
      if (sameFrameCount === 0) {
        slideNum++;
        if (progressBar) progressBar.update(Math.min(slideNum - 1, target));
      }
    }
    if (progressBar) progressBar.update(Math.min(slideNum, target));
  } finally {
    await page.close();
  }
  return { trackingLog, title: pageTitle };
}

async function crawlWebsite(context, startUrl, { outDir, imgFormat, maxPages, maxDepth, sameDomainOnly, progressBar }) {
  const visited = new Set();
  const queue = [{ url: startUrl.href, depth: 0 }];
  const trackingLog = [];
  let pageTitle = '';
  let count = 0;
  
  if (progressBar) {
      console.log(chalk.dim('Press Ctrl+Q to abort capture...'));
    progressBar.options.format = `${chalk.blue('Crawling...')} {value} pages processed`;
    progressBar.start(maxPages, 0);
  }

  while (queue.length > 0 && count < maxPages) {
    if (global.abortCapture) {
      console.log(chalk.red('\n[Interrupt] Capture aborted by user.'));
      // Clean up all files saved so far
      for (const item of trackingLog) {
        try { if (fs.existsSync(item.filepath)) fs.unlinkSync(item.filepath); } catch (_) {}
      }
      trackingLog.length = 0;
      break;
    }
    const { url, depth } = queue.shift();
    if (visited.has(url) || depth > maxDepth) continue;
    visited.add(url);

    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await settlePage(page);

      const urlTitle = await page.title().catch(() => '');
      if (count === 0) pageTitle = urlTitle;
      const filename = urlToFilename(url, imgFormat, urlTitle);
      const finalPath = uniquePath(outDir, filename, imgFormat);
      await page.screenshot({ path: finalPath, fullPage: true, type: imgFormat });
      trackingLog.push({ url, file: path.basename(finalPath), filepath: finalPath });

      count++;
      if (progressBar) progressBar.update(count);

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
    } finally {
      await page.close();
    }
  }
  if (progressBar) progressBar.update(count);
  return { trackingLog, title: pageTitle };
}

// ---------- scrape text ----------
async function scrapeWebsiteText(context, startUrl, { outDir, maxPages, maxDepth, sameDomainOnly, progressBar }) {
  const visited = new Set();
  const queue = [{ url: startUrl.href, depth: 0 }];
  const trackingLog = [];
  let pageTitle = '';
  let count = 0;

  if (progressBar) {
      console.log(chalk.dim('Press Ctrl+Q to abort capture...'));
    progressBar.options.format = `${chalk.blue('Scraping...')} {value} pages extracted`;
    progressBar.start(maxPages, 0);
  }

  while (queue.length > 0 && count < maxPages) {
    if (global.abortCapture) {
      console.log(chalk.red('\n[Interrupt] Capture aborted by user.'));
      // Clean up all files saved so far
      for (const item of trackingLog) {
        try { if (fs.existsSync(item.filepath)) fs.unlinkSync(item.filepath); } catch (_) {}
      }
      trackingLog.length = 0;
      break;
    }
    const { url, depth } = queue.shift();
    if (visited.has(url) || depth > maxDepth) continue;
    visited.add(url);

    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await settlePage(page);

      // Extract raw HTML and process it to markdown
      const htmlContent = await page.evaluate(() => document.body.innerHTML);
      const markdown = NodeHtmlMarkdown.translate(htmlContent);

      const urlTitle = await page.title().catch(() => '');
      if (count === 0) pageTitle = urlTitle;
      const filename = urlToFilename(url, 'md', urlTitle);
      const finalPath = uniquePath(outDir, filename, 'md');
      fs.writeFileSync(finalPath, markdown, 'utf8');
      trackingLog.push({ url, file: path.basename(finalPath), filepath: finalPath, markdown });

      count++;
      if (progressBar) progressBar.update(count);

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
    } finally {
      await page.close();
    }
  }
  if (progressBar) progressBar.update(count);
  return { trackingLog, title: pageTitle };
}

// ---------- bundlers ----------
async function bundlePptx(trackingLog, outDir, isText, startUrl, title) {
  const pptx = new PptxGenJS();
  if (isText) {
    for (const item of trackingLog) {
      const slide = pptx.addSlide();
      slide.addText(item.url, { x: 0.5, y: 0.5, w: 9, h: 0.5, fontSize: 14, color: '363636' });
      slide.addText(item.markdown.substring(0, 2000) + '...', { x: 0.5, y: 1.2, w: 9, h: 4, fontSize: 10 });
    }
  } else {
    for (const item of trackingLog) {
      const slide = pptx.addSlide();
      slide.addImage({ path: item.filepath, x: 0, y: 0, w: '100%', h: '100%' });
      if (item.links && item.pageW && item.pageH) {
        for (const link of item.links) {
          const xPct = (link.x / item.pageW) * 100 + '%';
          const yPct = (link.y / item.pageH) * 100 + '%';
          const wPct = (link.w / item.pageW) * 100 + '%';
          const hPct = (link.h / item.pageH) * 100 + '%';
          slide.addText('', {
            hyperlink: { url: link.href },
            x: xPct, y: yPct, w: wPct, h: hPct
          });
        }
      }
    }
  }
  const filename = urlToFilename(startUrl.href, 'pptx', title);
  const outPath = uniquePath(outDir, filename, 'pptx');
  await pptx.writeFile({ fileName: outPath });
  for (const item of trackingLog) fs.existsSync(item.filepath) && fs.unlinkSync(item.filepath);
  return outPath;
}

async function bundleDocx(trackingLog, outDir, isText, startUrl, title) {
  const children = [];
  for (const item of trackingLog) {
    children.push(new docx.Paragraph({
      children: [
        new docx.TextRun({ text: `Source: ${item.url}`, bold: true, size: 28 })
      ]
    }));
    if (isText) {
      const lines = item.markdown.split('\n').slice(0, 300); // limit per page
      for (const line of lines) {
        children.push(new docx.Paragraph({ text: line }));
      }
    } else {
      children.push(new docx.Paragraph({
        children: [new docx.ImageRun({ data: fs.readFileSync(item.filepath), transformation: { width: 620, height: 380 } })]
      }));
    }
    children.push(new docx.Paragraph({ text: " " }));
  }
  const doc = new docx.Document({ sections: [{ children }] });
  const buffer = await docx.Packer.toBuffer(doc);
  const filename = urlToFilename(startUrl.href, 'docx', title);
  const outPath = uniquePath(outDir, filename, 'docx');
  fs.writeFileSync(outPath, buffer);
  for (const item of trackingLog) fs.existsSync(item.filepath) && fs.unlinkSync(item.filepath);
  return outPath;
}

async function bundlePdf(trackingLog, outDir, isText, startUrl, title) {
  const filename = urlToFilename(startUrl.href, 'pdf', title);
  const outPath = uniquePath(outDir, filename, 'pdf');
  
  if (isText) {
    // Basic text to PDF
    const pdfDoc = await PDFDocument.create();
    for (const item of trackingLog) {
      const page = pdfDoc.addPage();
      const { height, width } = page.getSize();
      page.drawText(`Source: ${item.url}\n\n${item.markdown.substring(0, 3000)}`, {
        x: 50, y: height - 50, size: 12, maxWidth: width - 100, lineHeight: 16
      });
    }
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outPath, pdfBytes);
  } else {
    // Images to PDF
    const pdfDoc = await PDFDocument.create();
    for (const item of trackingLog) {
      const ext = path.extname(item.filepath).toLowerCase();
      let image;
      const imgBytes = fs.readFileSync(item.filepath);
      if (ext === '.png') image = await pdfDoc.embedPng(imgBytes);
      else if (ext === '.jpg' || ext === '.jpeg') image = await pdfDoc.embedJpg(imgBytes);
      
      if (image) {
        const page = pdfDoc.addPage([image.width, image.height]);
        page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });

        if (item.links && item.pageW && item.pageH) {
          const scaleX = image.width / item.pageW;
          const scaleY = image.height / item.pageH;
          for (const link of item.links) {
            const pdfX = link.x * scaleX;
            const pdfY = image.height - (link.y * scaleY) - (link.h * scaleY);
            const pdfW = link.w * scaleX;
            const pdfH = link.h * scaleY;

            const linkAnnot = pdfDoc.context.obj({
              Type: 'Annot',
              Subtype: 'Link',
              Rect: [pdfX, pdfY, pdfX + pdfW, pdfY + pdfH],
              Border: [0, 0, 0],
              A: {
                Type: 'Action',
                S: 'URI',
                URI: PDFString.of(link.href),
              },
            });

            const annotRef = pdfDoc.context.register(linkAnnot);
            let annots = page.node.lookup(PDFName.of('Annots'), PDFArray);
            if (!annots) {
              annots = pdfDoc.context.obj([]);
              page.node.set(PDFName.of('Annots'), annots);
            }
            annots.push(annotRef);
          }
        }
      }
    }
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outPath, pdfBytes);
  }

  for (const item of trackingLog) fs.existsSync(item.filepath) && fs.unlinkSync(item.filepath);
  return outPath;
}

async function captureMhtml(context, startUrl, outDir) {
  const page = await context.newPage();
  let pageTitle = '';
  try {
    await page.goto(startUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settlePage(page);
    pageTitle = await page.title().catch(() => '');

    const cdpSession = await context.newCDPSession(page);
    const { data } = await cdpSession.send('Page.captureSnapshot', { format: 'mhtml' });
    
    const filename = urlToFilename(startUrl.href, 'mhtml', pageTitle);
    const finalPath = uniquePath(outDir, filename, 'mhtml');
    fs.writeFileSync(finalPath, data);
    return { trackingLog: [{ url: startUrl.href, file: path.basename(finalPath), filepath: finalPath }], title: pageTitle };
  } finally {
    await page.close();
  }
}

// ---------- execution router ----------
async function runCapture(browser, args) {
  const startUrl = new URL(args.url);
  const outDir = path.resolve(args.outDir || config.outDir);
  let format = ['png', 'jpeg', 'pptx', 'docx', 'pdf', 'mhtml'].includes((args.format || config.defaultFormat).toLowerCase())
    ? (args.format || config.defaultFormat).toLowerCase() : 'png';
  
  if (args.scrapeText && format !== 'pdf' && format !== 'docx' && format !== 'mhtml') {
    console.log(chalk.yellow(`\n[Info] Scraping text strictly requires PDF, DOCX, or MHTML format. Forcing format to PDF.`));
    format = 'pdf';
  }
  
  const imgFormat = ['pptx', 'docx', 'pdf'].includes(format) ? 'png' : format;
  const maxPages = args.maxPages || config.maxPages;
  const maxDepth = args.depth || 0;
  const sameDomainOnly = args.sameDomainOnly !== false;

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 }
  });

  const progressBar = new cliProgress.SingleBar({
    format: `${chalk.blue('Running...')} {value} completed`,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  });

  const isGoogleSlides = startUrl.hostname.includes('docs.google.com') && startUrl.pathname.includes('/presentation');
  
  let isPresentation = args.isPresentation;
  if (isPresentation === undefined && !args.forceSnap) {
    const host = startUrl.hostname;
    isPresentation = isGoogleSlides || host.includes('canva.com') || host.includes('pitch.com') || host.includes('slideshare.net') || host.includes('gamma.app') || host.includes('tome.app');
  }
  if (isGoogleSlides) isPresentation = true;

  let trackingLog = [];
  let pageTitle = '';
  global.isCapturing = true;
  global.abortCapture = false;

  try {
    if (isGoogleSlides && (format === 'pdf' || format === 'pptx')) {
      // Try native API first, fall back to visual crawler
      const page = await context.newPage();
      let nativeOk = false;
      try {
        await downloadNativeGoogleSlides(page, startUrl, format, outDir);
        nativeOk = true;
      } catch (err) {
        console.error(chalk.red(`Native export failed (${err.message}). Falling back to visual capture...`));
      } finally {
        await page.close();
      }
      if (nativeOk) {
        // Native export succeeded — we're done
        global.isCapturing = false;
        global.abortCapture = false;
        if (progressBar.isActive) progressBar.stop();
        await context.close();
        return;
      }
      // Fallback: crawl it like a generic presentation
      console.log(chalk.yellow(`\nCapturing Google Slides via visual crawler fallback...`));
      const crawlResult = await crawlPresentation(context, startUrl, { outDir, imgFormat: ['pptx', 'docx', 'pdf'].includes(format) ? 'png' : format, maxPages, progressBar });
      trackingLog = crawlResult.trackingLog;
      pageTitle = crawlResult.title;
    } else if (format === 'mhtml') {
      console.log(chalk.yellow(`\nCreating interactive MHTML archive for ${startUrl.href}`));
      const mhtmlResult = await captureMhtml(context, startUrl, outDir);
      trackingLog = mhtmlResult.trackingLog;
      pageTitle = mhtmlResult.title;
    } else if (args.scrapeText) {
      console.log(chalk.yellow(`\nScraping text from ${startUrl.href}`));
      const scrapeResult = await scrapeWebsiteText(context, startUrl, { outDir, maxPages, maxDepth, sameDomainOnly, progressBar });
      trackingLog = scrapeResult.trackingLog;
      pageTitle = scrapeResult.title;
    } else if (isPresentation) {
      if (isGoogleSlides && ['png', 'jpeg'].includes(format)) {
        console.log(chalk.yellow('Note: Saving as images will strip interactive hyperlinks. Use format "pdf" or "pptx" to preserve them natively.'));
      }
      console.log(chalk.yellow(`\nCapturing presentation from ${startUrl.href}`));
      const crawlResult = await crawlPresentation(context, startUrl, { outDir, imgFormat, maxPages, progressBar });
      trackingLog = crawlResult.trackingLog;
      pageTitle = crawlResult.title;
    } else {
      console.log(chalk.yellow(`\nCrawling website ${startUrl.href}`));
      const crawlResult = await crawlWebsite(context, startUrl, { outDir, imgFormat, maxPages, maxDepth, sameDomainOnly, progressBar });
      trackingLog = crawlResult.trackingLog;
      pageTitle = crawlResult.title;
    }
  } catch (err) {
    if (progressBar.isActive) progressBar.stop();
    console.error(chalk.red(`\nError: ${err.message}`));
    return;
  } finally {
    global.isCapturing = false;
    global.abortCapture = false;
    if (progressBar.isActive) progressBar.stop();
    await context.close();
  }

  if (!trackingLog || !trackingLog.length) {
    console.log(chalk.red('Nothing was captured.'));
    return;
  }

  const isText = !!args.scrapeText;
  if (format === 'pptx') {
    console.log(chalk.cyan('\nBuilding .pptx...'));
    console.log(chalk.green(`\u2714 Saved: ${await bundlePptx(trackingLog, outDir, isText, startUrl, pageTitle)}`));
  } else if (format === 'docx') {
    console.log(chalk.cyan('\nBuilding .docx...'));
    console.log(chalk.green(`\u2714 Saved: ${await bundleDocx(trackingLog, outDir, isText, startUrl, pageTitle)}`));
  } else if (format === 'pdf') {
    console.log(chalk.cyan('\nBuilding .pdf...'));
    console.log(chalk.green(`\u2714 Saved: ${await bundlePdf(trackingLog, outDir, isText, startUrl, pageTitle)}`));
  } else {
    const manifestPath = uniquePath(outDir, urlToFilename(startUrl.href, 'json', pageTitle), 'json');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(trackingLog.map(i => ({ url: i.url, file: i.file })), null, 2)
    );
    console.log(chalk.green(`\u2714 Saved ${trackingLog.length} files and manifest to ${manifestPath}`));
  }
}

// ---------- TUI shell ----------
function printHelp() {
  console.log(chalk.blue.bold('\nCommands:'));
  console.log(`  ${chalk.cyan('/snap <url>')}     Capture a website as screenshots (or just type URL)`);
  console.log(`  ${chalk.cyan('/scrape <url>')}   Extract website text as Markdown (for PDF/DOCX)`);
  console.log(`  ${chalk.cyan('/slides <url>')}   Capture a Google Slides presentation`);
  console.log(`  ${chalk.cyan('/bulk')}           Enter bulk-URL input mode`);
  console.log(`  ${chalk.cyan('/format <fmt>')}   Change default format (png/jpeg/pptx/docx/pdf/mhtml)`);
  console.log(`  ${chalk.cyan('/max <num>')}      Change max pages/slides (current: ${config.maxPages})`);
  console.log(`  ${chalk.cyan('/out <dir>')}      Change output directory (current: ${config.outDir})`);
  console.log(`  ${chalk.cyan('/config')}         Show current settings`);
  console.log(`  ${chalk.cyan('clear')}           Clear terminal`);
  console.log(`  ${chalk.cyan('?')} or ${chalk.cyan('/help')}    Show this help`);
  console.log(`  ${chalk.cyan('q')} or ${chalk.cyan('/quit')}    Exit\n`);
}

async function runInteractiveShell() {
  console.log(chalk.blue.bold(`\n=== clearpass v${PKG.version} ===`));
  console.log(chalk.dim('Type ? for help or q to quit.'));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.green('clearpass> ')
  });

  const browser = await chromium.launch();
  let bulkMode = false;
  rl.prompt();

  rl.on('line', async (line) => {
    if (bulkMode) return; // bulk handler is active, skip main handler
    line = line.trim();
    if (!line) { rl.prompt(); return; }

    const parts = line.split(' ');
    const cmd = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ');

    if (cmd === 'q' || cmd === '/quit' || cmd === 'quit' || cmd === 'exit') {
      await browser.close();
      process.exit(0);
    } else if (cmd === '?' || cmd === '/help' || cmd === 'help') {
      printHelp();
    } else if (cmd === 'clear') {
      console.clear();
    } else if (cmd === '/config') {
      console.log(chalk.cyan(JSON.stringify(config, null, 2)));
    } else if (cmd === '/format') {
      if (!arg) console.log(chalk.red('Please specify a format (png, jpeg, pptx, docx, pdf, mhtml).'));
      else {
        config.defaultFormat = arg.toLowerCase();
        saveConfig(config);
        console.log(chalk.green(`Default format set to ${config.defaultFormat}`));
      }
    } else if (cmd === '/max') {
      if (!arg || isNaN(arg)) console.log(chalk.red('Please specify a valid number.'));
      else {
        config.maxPages = parseInt(arg, 10);
        saveConfig(config);
        console.log(chalk.green(`Max pages/slides set to ${config.maxPages}`));
      }
    } else if (cmd === '/out') {
      if (arg) {
        config.outDir = arg;
        saveConfig(config);
        console.log(chalk.green(`Output directory set to ${config.outDir}`));
      } else {
        console.log(chalk.cyan('Opening file explorer to choose directory...'));
        const folder = chooseFolderOS();
        if (folder && fs.existsSync(folder)) {
          config.outDir = folder;
          saveConfig(config);
          console.log(chalk.green(`Output directory set to ${config.outDir}`));
        } else {
          console.log(chalk.red('Directory selection cancelled or failed.'));
        }
      }
    } else if (cmd === '/bulk' || cmd === '/b') {
      console.log(chalk.yellow('\nEnter URLs (one per line). Press Enter on an empty line to finish:'));
      bulkMode = true;
      const urls = await new Promise((resolve) => {
        const collected = [];
        const bulkHandler = (bulkLine) => {
          const trimmed = bulkLine.trim();
          if (!trimmed) {
            rl.removeListener('line', bulkHandler);
            resolve(collected);
            return;
          }
          try {
            new URL(trimmed);
            collected.push(trimmed);
            console.log(chalk.green(`  + ${trimmed}`));
          } catch {
            console.log(chalk.red(`  \u2717 Invalid URL, ignored: ${trimmed}`));
          }
        };
        rl.on('line', bulkHandler);
      });
      bulkMode = false;
      if (urls.length > 0) {
        console.log(chalk.cyan(`\nProcessing ${urls.length} URL(s)...\n`));
        for (let i = 0; i < urls.length; i++) {
          console.log(chalk.blue(`[${i + 1}/${urls.length}] ${urls[i]}`));
          try {
            await runCapture(browser, { url: urls[i] });
          } catch (err) {
            console.error(chalk.red(`[-] Failed to process ${urls[i]}, skipping to next...`));
            if (err && err.message) console.error(chalk.dim(err.message));
          }
        }
      } else {
        console.log(chalk.dim('No valid URLs entered. Bulk cancelled.'));
      }
    } else if (cmd === '/snap' || cmd === '/slides' || cmd === '/s' || cmd.startsWith('http')) {
      let targetUrl = cmd.startsWith('http') ? cmd : arg;
      if (!targetUrl) {
        console.log(chalk.red('Please provide a URL.'));
      } else {
        try {
          new URL(targetUrl);
          const forceSnap = cmd === '/snap';
          const isPresentation = (cmd === '/slides' || cmd === '/s') ? true : undefined;
          await runCapture(browser, { url: targetUrl, isPresentation, forceSnap });
        } catch {
          console.log(chalk.red('Invalid URL provided.'));
        }
      }
    } else if (cmd === '/scrape' || cmd === '/sc') {
      if (!arg) console.log(chalk.red('Please provide a URL.'));
      else {
        try {
          new URL(arg);
          await runCapture(browser, { url: arg, scrapeText: true });
        } catch {
          console.log(chalk.red('Invalid URL provided.'));
        }
      }
    } else {
      console.log(chalk.red(`Unknown command: ${cmd}. Type ? for help.`));
    }
    rl.prompt();
  }).on('close', async () => {
    await browser.close();
    process.exit(0);
  });
}

// ---------- CLI mode ----------
async function runCliMode() {
  const program = new Command();
  program
    .name('clearpass')
    .version(PKG.version)
    .description('Crawls a website or Google Slides deck and saves it with visual stability checks.')
    .option('-u, --url <url>', 'starting URL to capture')
    .option('-o, --out <dir>', 'output directory', config.outDir)
    .option('-f, --format <format>', 'png, jpeg, pptx, docx, pdf, mhtml', config.defaultFormat)
    .option('-m, --max <number>', 'max pages/slides', String(config.maxPages))
    .option('-d, --depth <number>', 'max link depth for website crawls', '0')
    .option('--scrape', 'extract text instead of screenshots')
    .option('--slides', 'treat as a generic presentation (Canva, Pitch, etc.)')
    .option('--all-domains', 'also follow links to other domains (default: same-domain only)');

  program.parse(process.argv);
  const opts = program.opts();

  if (!opts.url) {
    if (process.stdout.isTTY) {
      await runInteractiveShell();
    } else {
      program.help();
    }
    return;
  }

  const browser = await chromium.launch();
  try {
    await runCapture(browser, {
      url: opts.url,
      outDir: opts.out,
      format: opts.format,
      maxPages: parseInt(opts.max, 10),
      depth: parseInt(opts.depth, 10),
      sameDomainOnly: !opts.allDomains,
      scrapeText: opts.scrape,
      isPresentation: opts.slides
    });
  } finally {
    await browser.close();
  }
}

runCliMode().catch(err => {
  console.error(chalk.red(`\nFatal error: ${err.message}`));
  process.exit(1);
});
