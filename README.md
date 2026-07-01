
```markdown
# snp-crcli 📸

Give it a link. It crawls the site, screenshots every page it can find, and saves them directly to your computer in the format you specify.

`snp` (the command this package installs) performs a breadth-first crawl starting from a seed URL, following internal links on the same domain by default, and captures full-page screenshots of every page it visits.

---

## Install

Install the package globally via npm:

```bash
npm install -g snp-crcli

```

> **Note:** This will automatically install a headless Chromium build via Playwright (~300MB, one-time setup). Once installed, the global command available in your terminal is **`snp`**.

### Local / Development Setup

If you want to run it directly from the source code without installing it globally:

```bash
git clone [https://github.com/sace-11/snp-crcli.git](https://github.com/sace-11/snp-crcli.git)
cd snp-crcli
npm install
npx playwright install chromium
node bin/snp.js --url [https://example.com](https://example.com)

```

---

## Usage

```bash
snp --url [https://example.com](https://example.com) --out ./shots --format png --max 30 --depth 2

```

### Options

| Flag | Description | Default |
| --- | --- | --- |
| `-u, --url <url>` | Starting URL to crawl (**required**) | — |
| `-o, --out <dir>` | Output directory for images | `./screenshots` |
| `-f, --format <format>` | Image format: `png` or `jpeg` | `png` |
| `-m, --max <number>` | Max total pages to crawl | `50` |
| `-d, --depth <number>` | Max link-hops deep to follow | `3` |
| `--width <px>` | Viewport width | `1440` |
| `--height <px>` | Viewport height | `900` |
| `--same-domain-only` | Only follow links on the exact same domain | `true` |
| `--cookies <path>` | Path to a JSON file of session cookies to load | — |

### Example

```bash
snp -u [https://docs.example.com](https://docs.example.com) -o ./docs-shots -f jpeg -m 100 -d 4

```

---

## Output Structure

Screenshots are saved directly to your target directory and are dynamically named based on the URL path. A `_manifest.json` file is generated alongside the images, creating a clean map of your crawl data:

```json
[
  { 
    "url": "[https://example.com/](https://example.com/)", 
    "file": "home.png" 
  },
  { 
    "url": "[https://example.com/about](https://example.com/about)", 
    "file": "about.png" 
  }
]

```

### Authenticated Sites

To crawl dashboards or pages behind login walls, export your browser session cookies into a JSON file (matching Playwright's expected cookie structure) and pass them through:

```bash
snp --url [https://app.example.com/dashboard](https://app.example.com/dashboard) --cookies ./cookies.json

```

---

## How It Works

`snp` utilizes Playwright to orchestrate a headless instance of Chromium. It runs a synchronized breadth-first crawl sequence:

1. Navigates to the page and waits for `networkidle`.
2. Captures a full-page scrollable screenshot.
3. Parses the DOM for valid `<a href>` links.
4. Filters out external domains (by default) and queues new unique paths.
5. Continues cycle until `--max` limits or `--depth` thresholds are encountered.

### Limitations

* **Infinite Scroll:** Will only capture what is loaded during the initial page lifecycle render.
* **Complex JS Routing:** Dynamic Single Page Applications (SPAs) that handle page generation entirely through complex internal JS state transitions (without updating standard anchors) may result in reduced discovery rates.

---

## Contributing

Pull requests are welcome. For major feature changes or structural re-architecting, please open an issue first to discuss what you would like to change.

## License

[MIT](https://www.google.com/search?q=LICENSE)

```

```