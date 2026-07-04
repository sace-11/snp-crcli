# clearpass

Crawl a website — or a published presentation deck — and save what you find as PNG, JPEG, PPTX, DOCX, PDF, or interactive MHTML archives. Includes a TUI (Terminal UI) for ease of use.

## Install

```bash
npm install -g clearpass
```

## Features

- **TUI & CLI**: Drop into an interactive shell by running `clearpass`, or use it strictly as a CLI tool.
- **Universal Presentation Crawler**: Captures generic presentations (Canva, Pitch, SlideShare) using smart visual hashing to detect slide changes.
- **Google Slides Native Interactivity**: Intercepts Google Slides and downloads perfect PDFs with 100% interactivity (bypassing screenshot limitations).
- **Intelligent Naming System**: Never overwrite your files! The engine generates unique and intelligent bundle names for all your scraped websites and slides based on the domain and path.
- **Visual Stability Engine**: It doesn't blindly screenshot. It compares image hashes to ensure animations and lazy-loaded elements are finished rendering.
- **Smart Security Bypass**: Detects Cloudflare and reCAPTCHA to prevent useless screenshots of "Checking your browser..."
- **Bulk Mode**: Provide a list of URLs to capture in one go.
- **Safe Interrupts**: Press `Ctrl+Q` at any time to safely abort a crawl without losing the progress you've already made!

## Interactive Shell (TUI)

Run the tool with no arguments to enter the shell:
```bash
clearpass
```

### Commands
- `/snap <url>`: Capture a website as screenshots.
- `/scrape <url>`: Extract website text (outputs Markdown/DOCX/PDF).
- `/slides <url>`: Capture a Google Slides or Canva presentation.
- `/bulk`: Enter bulk-URL mode (paste multiple URLs, hit enter twice).
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