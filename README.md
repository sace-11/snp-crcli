# clearpass

Crawl a website — or a published Google Slides deck — and save what you find as PNG, JPEG, PPTX, DOCX, PDF, or interactive MHTML archives. Includes a beautiful TUI (Terminal UI) for ease of use.

## Install

```bash
npm install -g clearpass
```

Requires Node 18+. A headless Chromium build installs automatically on first setup.

## Usage

**Interactive TUI Shell** (recommended for first-time use):

```bash
clearpass
```
Once inside the TUI, use the following commands:
- `/snap <url>` or just `<url>`: Capture a single URL as screenshots.
- `/scrape <url>`: Extract website text as Markdown (great for PDF/DOCX).
- `/slides <url>`: Capture a Google Slides presentation.
- `/bulk`: Enter bulk-URL mode (paste multiple URLs, hit enter twice).
- `/format <fmt>`: Set default output format (`png`, `jpeg`, `pptx`, `docx`, `pdf`, `mhtml`).
### Crawl Settings
- `/m <number>` or `/max <number>`: Set the maximum number of pages to crawl (Default: 300)
- `/d <number>` or `/depth <number>`: Set the maximum crawl depth
- `/domain <all|same>`: Control domain crawling boundary

## Universal Presentation Crawler
Clearpass doesn't just capture websites; it can smartly traverse **published presentation decks**.

- **Google Slides Native Interactivity**: If Clearpass detects a Google Slides URL and you've selected `pdf` or `pptx` format, it seamlessly bypasses screenshotting and leverages a native API to download the deck. This completely preserves **all interactive hyperlinks**, vectors, and text selection natively.
- **Generic Crawler (Canva, Pitch, SlideShare)**: For other platforms, run `/slides <url>`. Clearpass uses a visual hashing algorithm alongside simulated keystrokes (`ArrowRight` / `Space`) to advance slides automatically until it detects the end of the presentation.

*Note: Generating raw images (`png` or `jpeg`) of presentations strips interactivity, as images cannot contain clickable hyperlinks. Ensure your format is set to `pdf` if interactivity is required!*
- `/out [dir]`: Set output folder. **Leave `[dir]` blank to open a native OS folder picker!**
- `?` or `/help`: Show all commands.
- `q` or `/quit`: Exit.

**Direct CLI mode:**

```bash
clearpass -u https://example.com -o ./shots -f mhtml -m 25
```

**Text Scraping to PDF:**

```bash
clearpass -u https://example.com --scrape -f pdf
```

**Uninstall:**

```bash
clearpass uninstall
```

## Features

### Smart Security & Captcha Detection
It can smartly detect when a site has blocked you with Cloudflare, Turnstile, or typical reCAPTCHA/hCaptcha prompts, and will gracefully abort the capture with a clear error message instead of hanging indefinitely.

### Native OS Folder Picker
When you type `/out` without a path, `clearpass` seamlessly opens the native file explorer on your OS (macOS, Windows, or Linux) so you can visually click and choose your save directory.

### Visual Stability Engine
Instead of waiting on network events, clearpass hashes the visible frame every ~200ms and waits until the picture stops changing before it screenshots or scrapes. On Slides, it reads the on-screen page counter, so a slide with a multi-step build animation gets captured only once it's fully revealed.

### Dynamic File Output & Progress Bars
- Output files are intelligently named sequentially (e.g. `snap_1.png`, `slide_1.png`, `scrape_1.md`).
- Progress bars adapt to the context. If it's a website with an unknown depth, it tracks what it discovers. If it's a slide deck with a known total, it shows you completion percentages natively.
- **Interruptible captures:** You can press `Ctrl+Q` at any time to gracefully abort a long capture without crashing the tool. It will save whatever it captured up to that point.

## Formats

- `png` / `jpeg`: Individual screenshots.
- `pptx` / `docx`: A single compiled document; screenshots/extracted text are embedded.
- `pdf`: A standard PDF file containing the screenshots or scraped markdown text.
- `mhtml`: A raw web archive format. **Use this if you want links and interactive content to remain clickable and functional when saved locally.**

## License

MIT