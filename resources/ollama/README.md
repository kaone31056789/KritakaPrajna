# Bundled Ollama runtime (Windows-first)

This folder is packaged into the app by electron-builder and is where the
local-model runtime looks for its binary.

## What to put here

Drop the standalone **`ollama.exe`** (Windows) into this folder before running
`npm run dist`:

```
resources/ollama/ollama.exe
```

Get it from https://ollama.com/download/windows (the installer's
`ollama.exe`, or the `ollama-windows-amd64.zip` binary).

## How it wires up

- **Package time** — `package.json` › `build.win.extraResources` maps
  `resources/ollama → <app>/resources/ollama`.
- **Runtime** — `electron/localRuntime.js` › `bundledBinaryPath()` resolves
  `path.join(process.resourcesPath, "ollama", "ollama.exe")`.
- **Fallback** — if the binary is absent (e.g. dev, or a build that skipped
  bundling), the runtime falls back to a system-installed `ollama` on `PATH`.
  So the app still works without a bundled binary; it just relies on the user
  having Ollama installed.

## Why it's not committed

The binary is large (100+ MB), so it is git-ignored (see `.gitignore`). Only
this README is tracked, which also guarantees the `from` directory exists at
build time (electron-builder errors on a missing `extraResources` source).

> Local **vision OCR** (Phase 3) reuses this same runtime: it points the OCR
> engine at `http://127.0.0.1:11434/v1` with an installed vision model
> (LLaVA / MiniCPM-V / moondream …). No separate binary is bundled for OCR.
