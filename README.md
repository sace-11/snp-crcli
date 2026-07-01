# snp-crcli

Give it a link. It screenshots every page it can find on that site and saves them to disk, in the format you want.

`snp` (the command this package installs) crawls a site starting from a URL you give it, following links (breadth-first, same-domain by default), and takes a full-page screenshot of every page it visits.

## Install

```bash
npm install -g snp-crcli
```

This also installs a headless Chromium build via Playwright (~300MB, one-time). Once installed, the command available in your terminal is `snp`.

Or run it without installing globally:

```bash
git clone https://github.com/YOUR_USERNAME/snp-crcli.git
cd snp-crcli
npm install
npx playwright install chromium
node bin/snp.js --url https://example.com
```

## Usage

```bash
snp --url https://example.com --out ./shots --format png --max 30 --depth 2
```

### Options

| Flag | Description | Default |
|---|---|---|
| `-u, --url <url>` | Starting URL to crawl (required) | — |
| `-o, --out <dir>` | Output directory | `./screenshots` |
| `-f, --format <format>` | `png` or `jpeg` | `png` |
| `-m, --max <number>` | Max pages to crawl | `50` |
| `-d, --depth <number>` | Max link depth to follow | `3` |
| `--width <px>` | Viewport width | `1440` |
| `--height <px>` | Viewport height | `900` |
| `--same-domain-only` | Only follow links on the same domain | `true` |
| `--cookies <path>` | JSON file of cookies to load before crawling (for authenticated sites) | — |

### Example

```bash
snp -u https://docs.example.com -o ./docs-shots -f jpeg -m 100 -d 4
```

## Output

Screenshots are saved to the output directory, named after the page's URL path. A `_manifest.json` is written alongside them mapping each URL to its saved filename:

```json
[
  { "url": "https://example.com/", "file": "home.png" },
  { "url": "https://example.com/about", "file": "about.png" }
]
```

## Authenticated sites

Export your session cookies as JSON (matching [Playwright's cookie format](https://playwright.dev/docs/api/class-browsercontext#browser-context-add-cookies)) and pass them in:

```bash
snp --url https://app.example.com/dashboard --cookies ./cookies.json
```

## How it works

`snp` uses [Playwright](https://playwright.dev/) to drive headless Chromium. It does a breadth-first crawl: visit a page, screenshot it, collect its links, queue up the ones that haven't been visited yet, repeat until it hits `--max` pages or runs out of `--depth`.

## Limitations

- Infinite-scroll pages will only capture what's loaded on initial render.
- Pages gated behind login walls need a `--cookies` file.
- JS-heavy SPAs that route without full page loads may not be crawled reliably (links are read from `<a href>` tags in the DOM after `networkidle`).

## Contributing

PRs welcome. Open an issue first for anything bigger than a small fix.

## License

MIT
