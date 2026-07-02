# snp-crcli

Crawl a website — or a published Google Slides deck — and save what you find as PNG, JPEG, PPTX, or DOCX. No flags needed; running `snp` on its own launches an interactive wizard.

## Install

```bash
npm install -g snp-crcli
```

Requires Node 18+. A headless Chromium build installs automatically on first setup.

## Usage

**Interactive wizard** (recommended for first-time use):

```bash
snp
```

**Direct CLI mode:**

```bash
snp -u https://example.com -o ./shots -f pptx -m 25
```

**Google Slides** (use the published link: File > Share > Publish to web):

```bash
snp -u "https://docs.google.com/presentation/d/e/2PACX-.../pub" -f docx -m 30
```

**Shorten a link:**

```bash
snp --sl "https://example.com/some/very/long/path"
```

**Uninstall:**

```bash
snp uninstall
```

**Full command list:**

```bash
snp --help
```

## How it decides a page is "ready"

Instead of waiting on network events — which never quiet down on sites like Google Slides that keep background connections open — snp hashes the visible frame every ~200ms and waits until the picture stops changing before it screenshots. On Slides specifically, it also reads the on-screen page counter, so a slide with a multi-step build animation gets captured only once it's fully revealed, not mid-build.

## Flags

| Flag | Description | Default |
|---|---|---|
| `-u, --url <url>` | Starting URL or Slides link | — |
| `-o, --out <dir>` | Output directory | `./screenshots` |
| `-f, --format <format>` | `png`, `jpeg`, `pptx`, or `docx` | your saved default |
| `-m, --max <number>` | Max pages or slides | `50` |
| `-d, --depth <number>` | Max link depth (websites only) | `3` |
| `--all-domains` | Also follow links off the starting domain | off (same-domain only) |
| `--width <px>` / `--height <px>` | Viewport size | `1440` / `900` |
| `--sl <url>` | Shorten a URL and exit | — |

## Output

- `png` / `jpeg`: individual screenshots plus a `_manifest.json` mapping URL → file
- `pptx` / `docx`: a single compiled document; the intermediate screenshots are deleted after bundling

## License

MIT