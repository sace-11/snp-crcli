```markdown
# snp-crcli 📸

An advanced terminal automation engine that crawls links or targets Google Slides presentations, captures snapshots, and bundles them into your choice of static formats—including images, PowerPoint presentations, or Word documents.

---

## Features

* **Interactive TUI Mode**: Launch the wizard by typing `snp` without arguments.
* **Smart Google Slides Automation**: Detects presentation structures and systematically hits navigational keys to save every slide layout.
* **Document Bundle Formats**: Supports direct compilations into `.pptx` and `.docx` out of the box.
* **First-Run Sync**: Remembers your preferred default format across operations.
* **Secure URL Shortener**: Directly integrated link management sub-system.

---

## Install

Install globally onto your system architecture via npm:

```bash
npm install -g snp-crcli

```

---

## Usage Syntax

### 1. Interactive Application UI Mode

Simple call the application without positional parameters to initiate the TUI wizard configuration setup:

```bash
snp

```

### 2. Standard CLI Automation Commands

```bash
snp --url "[https://example.com](https://example.com)" --out ./shots --format pptx --max 25

```

### 3. Google Slides Layout Capture Execution

*Always wrap highly parameterized URLs in strict quotation marks to avoid zsh terminal escaping evaluation bugs.*

```bash
snp --url "[https://docs.google.com/presentation/d/e/2PACX-1vQ1.../pub](https://docs.google.com/presentation/d/e/2PACX-1vQ1.../pub)" --format pptx --max 15

```

### 4. Link Shortener Routine

```bash
snp --sl "[https://my-long-deep-link-location-here.com/data/metrics](https://my-long-deep-link-location-here.com/data/metrics)"

```

---

## Technical Configuration Parameters

| Flag | Parameter Target | Default Value |
| --- | --- | --- |
| `-u, --url` | Target web destination or slide system | — |
| `-o, --out` | Absolute or relative asset directory path | `./screenshots` |
| `-f, --format` | Selection criteria: `png`, `jpeg`, `pptx`, `docx` | `png` *(or first-run pick)* |
| `-m, --max` | Cutoff ceiling capacity threshold limit | `50` |
| `-d, --depth` | Level tracking depth boundary index for crawls | `3` |
| `--sl` | Address link pipeline to pass through to shortener API | — |
| `--help` | Reflect operational specifications documentation | — |

---

## How to Uninstall

To smoothly purge the global package execution binary and its tracking context completely from your system registry infrastructure, run:

```bash
snp uninstall

```

## License

[MIT](https://www.google.com/search?q=LICENSE)

```

```