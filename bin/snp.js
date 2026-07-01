#!/usr/bin/env node

const { chromium } = require('playwright');
const { Command } = require('commander');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { execSync } = require('child_process');

// Handle uninstall subcommand instantly before initializing anything else
if (process.argv[2] === 'uninstall') {
  console.log('🛡️  Initiating automatic global uninstallation...');
  try {
    execSync('npm uninstall -g snp-crcli', { stdio: 'inherit' });
    console.log('✅ snp-crcli has been successfully removed from your system.');
  } catch (err) {
    console.error('❌ Self-uninstallation failed. Run manually: npm uninstall -g snp-crcli');
  }
  process.exit(0);
}

// Lazy loaded dependencies for fast initialization when running subcommands
const inquirer = require('inquirer');
const cliProgress = require('cli-progress');
const PptxGenJS = require('pptxgenjs');
const docx = require('docx');

const CONFIG_PATH = path.join(process.env.HOME || process.env.USERPROFILE, '.snp-config.json');

// Ensure Configuration Lifecycle
function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  }
  return null;
}

function saveConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

async function runFirstTimeSetup() {
  console.log('\n👋 Welcome to snp-crcli! Let\'s configure your system.');
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'defaultFormat',
      message: 'Select your default fallback file format:',
      choices: ['png', 'jpeg', 'pptx', 'docx']
    }
  ]);
  const newConfig = { defaultFormat: answers.defaultFormat };
  saveConfig(newConfig);
  console.log(`✅ Preference locked! Default format set to: ${newConfig.defaultFormat}\n`);
  return newConfig;
}

// Initialize Commander Core
const program = new Command();

program
  .name('snp')
  .description('High-performance site crawler, screenshot engine, and asset exporter')
  .option('-u, --url <url>', 'Starting target URL to crawl')
  .option('-o, --out <dir>', 'Output target folder path', './screenshots')
  .option('-f, --format <format>', 'Output file format target: png, jpeg, pptx, docx')
  .option('-m, --max <number>', 'Max pages/slides to crawl', '50')
  .option('-d, --depth <number>', 'Max hyperlink depth traversal', '3')
  .option('--sl <url>', 'Shorten a long URL via secure production API gateway')
  .option('--width <px>', 'Viewport window width', '1440')
  .option('--height <px>', 'Viewport window height', '900')
  .option('--same-domain-only', 'Bypass processing external linked anchors', true);

program.parse(process.argv);
const opts = program.opts();

// Execute Link Shortening Sub-System
if (opts.sl) {
  (async () => {
    try {
      console.log('⚡ Contacting shortening registry API...');
      const res = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(opts.sl)}`);
      if (!res.ok) throw new Error('API gateway returned an invalid signature response');
      const text = await res.text();
      console.log(`\n🔗 Shortened URL: ${text.trim()}`);
    } catch (err) {
      console.error(`❌ Error parsing shortener pipeline: ${err.message}`);
    }
    process.exit(0);
  })();
  return;
}

// Main Runtime Thread Execution
(async () => {
  let userConfig = loadConfig();
  if (!userConfig && process.stdout.isTTY) {
    userConfig = await runFirstTimeSetup();
  } else if (!userConfig) {
    userConfig = { defaultFormat: 'png' };
  }

  // Detect Interactive TUI Trigger Requirement
  let activeArgs = { ...opts };
  if (!process.argv[2] && process.stdout.isTTY) {
    console.log('🖥️  Launching interactive terminal setup wizard...');
    const flow = await inquirer.prompt([
      { type: 'input', name: 'url', message: 'Enter target destination URL:', validate: v => v ? true : 'URL target cannot be left blank.' },
      { type: 'list', name: 'format', message: 'Select compilation target format:', choices: ['png', 'jpeg', 'pptx', 'docx'], default: userConfig.defaultFormat },
      { type: 'input', name: 'out', message: 'Output directory destination:', default: './screenshots' },
      { type: 'input', name: 'max', message: 'Maximum processing page limit:', default: '50' },
      { type: 'input', name: 'depth', message: 'Depth-limit crawl traversal range:', default: '3' }
    ]);
    activeArgs = {
      url: flow.url,
      out: flow.out,
      format: flow.format,
      max: flow.max,
      depth: flow.depth,
      width: '1440',
      height: '900',
      sameDomainOnly: true
    };
  } else if (!opts.url) {
    program.help();
    return;
  }

  // Sanitize Inputs
  const startUrl = new URL(activeArgs.url);
  const outDir = path.resolve(activeArgs.out);
  const rawFormat = (activeArgs.format || userConfig.defaultFormat).toLowerCase();
  const format = ['png', 'jpeg', 'pptx', 'docx'].includes(rawFormat) ? rawFormat : 'png';
  const imgFormat = ['pptx', 'docx'].includes(format) ? 'png' : format;
  const maxPages = parseInt(activeArgs.max, 10);
  const maxDepth = parseInt(activeArgs.depth, 10);

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  function urlToFilename(targetUrl) {
    const u = new URL(targetUrl);
    let p = (u.pathname === '/' || u.pathname === '') ? 'home' : u.pathname;
    p = p.replace(/^\/|\/$/g, '').replace(/\//g, '_');
    const query = u.search ? '_' + u.search.replace(/[?&=]/g, '-') : '';
    return `${(p + query).replace(/[^a-zA-Z0-9-_]/g, '') || 'page'}.${imgFormat}`;
  }

  console.log(`\n🚀 Initializing engine profile. Output targeting: ${outDir}`);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: parseInt(activeArgs.width || '1440', 10), height: parseInt(activeArgs.height || '900', 10) }
  });

  const visited = new Set();
  const queue = [{ url: startUrl.href, depth: 0 }];
  const trackingLog = [];
  let count = 0;

  // Initialize Progress Visualizer
  const progressBar = new cliProgress.SingleBar({
    format: '🎯 Scraping Operational Progress |' + '{bar}' + '| {percentage}% || {value}/{total} Iterations processed',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  }, cliProgress.Presets.shades_classic);

  // Check if target is a Google Slides asset container
  const isGoogleSlides = startUrl.hostname.includes('docs.google.com') && startUrl.pathname.includes('/presentation');

  if (isGoogleSlides) {
    progressBar.start(maxPages, 0);
    const page = await context.newPage();
    try {
      await page.goto(startUrl.href, { waitUntil: 'networkidle', timeout: 45000 });
      let presentationEnded = false;
      let lastSlideIdentifier = '';

      while (count < maxPages && !presentationEnded) {
        // Wait for page rendering lifecycle stabilization
        await page.waitForTimeout(1500);
        
        // Extract uniqueness verification via internal vector elements
        const currentSlideId = await page.evaluate(() => {
          const svgG = document.querySelector('g.punch-viewer-svgpage-svgobj');
          return svgG ? svgG.innerHTML.substring(0, 100) : window.location.hash;
        });

        if (currentSlideId === lastSlideIdentifier) {
          presentationEnded = true;
          break;
        }
        lastSlideIdentifier = currentSlideId;

        const filename = `slide_${count + 1}.${imgFormat}`;
        const finalPath = path.join(outDir, filename);

        await page.screenshot({ path: finalPath, fullPage: false, type: imgFormat });
        trackingLog.push({ url: `${startUrl.href}#slide=${count + 1}`, file: filename, filepath: finalPath });
        
        count++;
        progressBar.update(count);

        // Dispatch native navigational arrow event directly down the stack channel
        await page.keyboard.press('ArrowRight');
      }
    } catch (err) {
      console.error(`\n❌ Fatal Error processing Google Slides Framework: ${err.message}`);
    } finally {
      await page.close();
    }
  } else {
    // Regular Website Crawler Mode Loop Execution
    progressBar.start(maxPages, 0);
    while (queue.length > 0 && count < maxPages) {
      const { url, depth } = queue.shift();
      if (visited.has(url) || depth > maxDepth) continue;
      visited.add(url);

      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        const filename = urlToFilename(url);
        let finalPath = path.join(outDir, filename);
        
        let dupeIndex = 1;
        while (fs.existsSync(finalPath)) {
          const base = path.basename(filename, `.${imgFormat}`);
          finalPath = path.join(outDir, `${base}_${dupeIndex}.${imgFormat}`);
          dupeIndex++;
        }

        await page.screenshot({ path: finalPath, fullPage: true, type: imgFormat });
        trackingLog.push({ url, file: path.basename(finalPath), filepath: finalPath });
        
        count++;
        progressBar.update(count);

        if (depth < maxDepth) {
          const links = await page.$$eval('a[href]', anchors => anchors.map(a => a.href));
          for (const link of links) {
            try {
              const linkUrl = new URL(link);
              linkUrl.hash = '';
              const cleanLink = linkUrl.href;
              const isSameDomain = linkUrl.hostname === startUrl.hostname;
              
              if (!visited.has(cleanLink) && (!activeArgs.sameDomainOnly || isSameDomain) && /^https?:$/.test(linkUrl.protocol)) {
                queue.push({ url: cleanLink, depth: depth + 1 });
              }
            } catch (_) {}
          }
        }
      } catch (err) {
        // Soft error resilience logging
      } finally {
        await page.close();
      }
    }
  }

  progressBar.stop();
  await browser.close();

  // Handle Document Packaging Targets (.pptx / .docx)
  if (count > 0) {
    if (format === 'pptx') {
      console.log('📦 Bundling target frames into PowerPoint presentation payload...');
      const pptx = new PptxGenJS();
      for (const item of trackingLog) {
        const slide = pptx.addSlide();
        slide.addImage({ path: item.filepath, x: 0, y: 0, w: '100%', h: '100%' });
      }
      const compilePath = path.join(outDir, `compiled_presentation.pptx`);
      await pptx.writeFile({ fileName: compilePath });
      
      // Clean up secondary image footprint artifacts
      for (const item of trackingLog) { if (fs.existsSync(item.filepath)) fs.unlinkSync(item.filepath); }
      console.log(`\n🎉 Success! Combined PowerPoint saved directly to: ${compilePath}`);
    } 
    else if (format === 'docx') {
      console.log('📦 Bundling target frames into Word Processing artifact...');
      const docChildren = trackingLog.map(item => {
        return new docx.Paragraph({
          children: [
            new docx.ImageRun({
              data: fs.readFileSync(item.filepath),
              transformation: { width: 650, height: 400 }
            }),
            new docx.Paragraph({ text: `Source URL reference: ${item.url}` })
          ]
        });
      });

      const doc = new docx.Document({ sections: [{ children: docChildren }] });
      const buffer = await docx.Packer.toBuffer(doc);
      const compilePath = path.join(outDir, `compiled_document.docx`);
      fs.writeFileSync(compilePath, buffer);

      // Clean up temporary files
      for (const item of trackingLog) { if (fs.existsSync(item.filepath)) fs.unlinkSync(item.filepath); }
      console.log(`\n🎉 Success! Document compilation saved directly to: ${compilePath}`);
    } 
    else {
      // Retain individual file manifests for default formats
      fs.writeFileSync(path.join(outDir, '_manifest.json'), JSON.stringify(trackingLog.map(i => ({ url: i.url, file: i.file })), null, 2));
      console.log(`\n🎉 Process wrapped up perfectly. ${count} target frames isolated and saved to ${outDir}`);
    }
  } else {
    console.log('\n⚠️  Zero valid operational layers were encountered during this processing run.');
  }
})();