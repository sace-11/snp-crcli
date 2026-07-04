# clearpass

Crawl a website — or a published presentation deck — and save what you find as PNG, JPEG, PPTX, DOCX, PDF, or interactive MHTML archives. Includes a beautiful TUI (Terminal UI) for ease of use.

## Install

```bash
npm install -g clearpass
```

## Features

- **Universal Auto-Detect**: Simply paste a URL. The engine will automatically detect if it's a website or a presentation (Google Slides, Canva, Pitch, SlideShare, etc.) and engage the correct crawler automatically!
- **TUI & CLI**: Drop into an interactive shell by running `clearpass`, or use it strictly as a CLI tool.
- **Universal Presentation Crawler**: Captures generic presentations using smart visual hashing to detect slide changes.
- **Google Slides Native Interactivity**: Intercepts Google Slides and downloads perfect PDFs with 100% interactivity, falling back to the visual crawler automatically if the native export fails or takes longer than 4 seconds.
- **Reconstructed Interactivity**: The visual crawler automatically extracts hyperlink coordinates from presentation slides and injects them as clickable links into your final PDFs and PPTXs.
- **Intelligent Naming System**: Your output files will be given extremely short, readable, and 100% unique names (e.g., `canva-4f8a.pdf`), completely preventing accidental overwriting.
- **Visual Stability Engine**: It doesn't blindly screenshot. It compares image hashes to ensure animations and lazy-loaded elements are finished rendering.
- **Smart Security Bypass**: Detects Cloudflare and reCAPTCHA. **New:** It now actively waits for Cloudflare's "Just a moment..." challenges to automatically resolve instead of blindly snapshotting the security clearance screen!
- **Safe Interrupts**: Press `Ctrl+Q` at any time to safely abort a crawl without losing the progress you've already made!

## Interactive Shell (TUI)

Run the tool with no arguments to enter the shell:
```bash
clearpass
```

### Commands & Auto-Detect

If you simply type or paste a URL (e.g., `https://example.com`), the engine will **auto-detect** the type of content and capture it appropriately.

The explicit commands are still there so you can override the auto-detection if it guesses wrong, or if you want to perform a specific action:

- `/snap <url>` (Force Screenshots): Use this if the engine accidentally detects a website as a presentation and you want to force it to just take raw screenshots of the page.
- `/scrape <url>` (Extract Text): Auto-detect never scrapes text by default. If you want to extract the raw markdown text from a webpage instead of taking images, you must explicitly use this command. **Note: Scraping strictly outputs to PDF, DOCX, or MHTML formats only. If another format is set, it will safely override to PDF.**
- `/slides <url>` (Force Presentation): Use this if you have a presentation link from a niche platform that the engine doesn't recognize (not Canva, Pitch, etc.). This forces the engine to use the Presentation Crawler logic.
- `/bulk`: Enter bulk-URL mode (paste multiple URLs, hit enter on an empty line to finish).
- `/format <fmt>`: Set default output format (`png`, `jpeg`, `pptx`, `docx`, `pdf`, `mhtml`).
- `/max <number>`: Set max pages/slides (default 300).
- `/out [dir]`: Set output folder. **Leave `[dir]` blank to open a native OS folder picker!**
- `?` or `/help`: Show all commands.
- `q` or `/quit`: Exit.

## CLI Usage

```bash
clearpass -u https://example.com -o ./out -f pdf
```

### CLI Options
- `-u, --url <url>`: The starting URL to crawl.
- `-o, --out <dir>`: The directory to save the output files.
- `-f, --format <format>`: Format for output (`png`, `jpeg`, `pptx`, `docx`, `pdf`, `mhtml`).
- `-m, --max <number>`: Max pages to crawl.
- `-d, --depth <number>`: Max link depth for website crawls.
- `--scrape`: Extract text instead of taking screenshots.
- `--slides`: Treat as a generic presentation (Canva, Pitch, etc.).
- `--all-domains`: Follow links to other domains (default: same-domain only).