<div align="center">

# KritakaPrajna

### An AI desktop workspace that studies with you, not just chats with you

<a href="https://github.com/kaone31056789/KritakaPrajna/releases/latest"><img src="https://img.shields.io/badge/Release-v4.0.0-ff8a3d?style=for-the-badge&logo=github" alt="Release"></a>
<img src="https://img.shields.io/badge/Windows-Supported-2563eb?style=for-the-badge&logo=windows" alt="Windows">
<img src="https://img.shields.io/badge/Electron-35.x-0ea5e9?style=for-the-badge&logo=electron" alt="Electron">
<img src="https://img.shields.io/badge/React-18-0891b2?style=for-the-badge&logo=react" alt="React">
<img src="https://img.shields.io/badge/Auto--update-GitHub%20Releases-16a34a?style=for-the-badge" alt="Auto-update">

<br>

<img src="https://img.shields.io/badge/Providers-OpenRouter%20%7C%20HuggingFace%20%7C%20NVIDIA%20NIM%20%7C%20OpenAI%20%7C%20Anthropic%20%7C%20Ollama-7c3aed?style=flat-square" alt="Providers">
<img src="https://img.shields.io/badge/Themes-27%20design%20languages-ffb454?style=flat-square" alt="Themes">
<img src="https://img.shields.io/badge/Spaced%20repetition-FSRS--6-22c55e?style=flat-square" alt="FSRS-6">
<img src="https://img.shields.io/badge/Tests-157%20passing-16a34a?style=flat-square" alt="Tests">

<em>Made by Parikshit</em>

</div>

---

## What it is

A desktop app that puts every model you have access to behind one interface — and then does
something with them beyond a chat box. Drop in your lecture notes, a teacher's slide deck or a
past paper, and it reads the material with a model, writes flashcards, quizzes or a full timed
exam from it, marks your answers (typed, or photographed off a handwritten sheet), and schedules
the revision with a real spaced-repetition algorithm.

It runs on your own API keys. Nothing is proxied through a server of ours, because there isn't one.

---

## Contents

1. [The five workspaces](#the-five-workspaces)
2. [Education Hub](#education-hub)
3. [Model routing](#model-routing)
4. [Appearance](#appearance)
5. [Install](#install)
6. [Auto-update](#auto-update)
7. [Providers and keys](#providers-and-keys)
8. [Building from source](#building-from-source)
9. [Project layout](#project-layout)
10. [Privacy](#privacy)
11. [What's new in v4.0.0](#whats-new-in-v400)

---

## The five workspaces

| Workspace | What it does |
|---|---|
| **Chat** | Streaming chat across every connected provider, with web search, reasoning-depth control, personas, prompt library and per-chat cost tracking. |
| **Agent** | Tool-using agent with a file tree, permission prompts, execution checkpoints and revert. |
| **Education Hub** | Notes in, study material out. See below. |
| **Image Studio** | Image generation through the providers that support it. |
| **Model Advisor** | Scores every model you can reach for a described task, blending offline heuristics with live OpenRouter usage rankings. |

---

## Education Hub

The part that isn't a chat box.

**Ingest** — PDFs, Word, PowerPoint, Excel, images, plain text. Mark any file as a past paper and
its house style (section layout, mark split, phrasing) is used when writing your exam.

**Comprehend** — long documents are split and read *in parallel* across several models at once,
each with the rest of the chain behind it as fallback. A ten-file drop reads in roughly the time of
its slowest pass rather than the sum of all of them.

**Generate** — flashcards, MCQ quizzes, or a full exam paper with a mark scheme and your own time
limit.

**Answer** — type into the interface, or photograph a handwritten sheet and let a vision model
transcribe it and map answers back to question numbers.

**Mark** — free-recall answers are graded against the expected answer with feedback, not just
flipped over.

**Schedule** — reviews are scheduled by **FSRS-6** (difficulty / stability / retrievability), ported
from py-fsrs. You set the target recall probability; the interval preview on each grade button shows
what pressing it actually buys you.

**Dashboard** — forecast, retention curve, activity heatmap, streak, and which decks are weakest.

A **Stop** button cancels the in-flight requests, not just the progress bar — a long free-tier read
is minutes of billable calls to be able to walk away from.

### Front matter is filtered out

Study material generated from a real document will happily ask you what's on the cover page. Two
filters run over every generated set: one drops administrative *topics*, and one drops individual
*questions* about page counts, roll numbers, supervisors and title pages — whatever the topic was
called. Both are regression-tested against questions that actually shipped.

---

## Model routing

You pick a **tier**, not a model. Each job inside the hub is routed to whichever model suits it,
with a fallback chain behind it because free endpoints rate-limit constantly.

| Tier | Price band (blended $/M tokens) |
|---|---|
| **Free** | free only |
| **Paid** | above $0.0001, below $5 |
| **Paid+** | $5 and up — flagships only, nothing free |

Four jobs are routed separately, because the model you want reading a 200-page PDF is not the one
you want marking a two-line answer:

`Reading your notes` · `Writing your material` · `Marking` · `Reading handwriting` (vision)

**Settings → Study Routing** lets you overrule any of the twelve slots. Your picks lead; the auto
chain stays behind them as fallback. A pin you hold no key for is skipped rather than left as a dead
head, and a blind model pinned to the handwriting job is refused outright.

Models are scored on generation, live usage rank, context length, reasoning capability and
parameter count — never on a big context window alone.

---

## Appearance

**27 design languages**, each with its own colour, shape, typography and motion personality —
Neumorphism, Brutalism, Glassmorphism, Swiss, Bauhaus, Cyberpunk, Vaporwave, Terminal Amber,
Deep Ocean, OG (the shell this app started as) and more. Every one ships a dark and a light variant.

The Appearance editor is a two-column theme workshop with a **live preview built from the same
tokens as the app** — what you see there is what ships. Controls for:

- Display mode — System · Light · Dark · OLED true-black · Auto (by clock)
- Accent colour with presets, picker, HEX entry, recents and **live WCAG contrast grading**
- Surface and shape — radius, elevation, shadow, borders, glass blur, transparency, density
- Typography — three font slots, size, weight, line height, letter spacing, heading scale
- Motion — level, intensity, speed, page-transition style, hover strength
- Background — solid, gradient, mesh, image, noise, brightness, opacity
- Accessibility — high contrast, text scale, strong focus rings, reduced transparency, reduced
  motion, colour-vision-friendly palettes

Any theme's colours can be customised token by token, saved as your own theme, and exported or
imported as JSON. Imported files are validated before a value ever reaches a live CSS variable.

The OS `prefers-reduced-motion` setting always wins over the app's own motion settings.

---

## Install

Download **`KritakaPrajna-Setup-4.0.0.exe`** from the
[latest release](https://github.com/kaone31056789/KritakaPrajna/releases/latest) and run it.

Windows SmartScreen may warn on first run — the installer is not code-signed with a paid
certificate. Choose *More info → Run anyway*.

---

## Auto-update

The app checks GitHub Releases on launch and every six hours after that. When a newer version
exists it **downloads automatically** and installs the next time you quit, with an optional
"restart now" prompt.

The version in the sidebar footer is also the control: it shows `checking…`, the download
percentage, or `restart` when an update is staged and waiting.

> Updates only run in the installed app — not in a development build, and not for Microsoft Store
> installs, which the Store updates itself.

---

## Providers and keys

| Provider | Notes |
|---|---|
| **OpenRouter** | One key, 500+ models. Covers everything the app does, free tier included. |
| **HuggingFace** | Free and paid router options; catalogue is public so models show before a key is set. |
| **NVIDIA NIM** | Free tier; large Nemotron and Llama models. |
| **OpenAI** | GPT family. |
| **Anthropic** | Claude family. |
| **Ollama** | Local or Ollama Cloud. |
| **Bundled runtime** | A local Ollama runtime managed by the app, for fully offline models. |

Keys are stored in the OS-backed `electron-store` in the packaged app, `localStorage` in a browser
dev session. They are never sent anywhere except the provider they belong to.

**Settings → Backup** exports an encrypted `.kpbak` (AES-256 / PBKDF2). API keys are opt-in and
excluded by default.

---

## Building from source

```bash
npm ci
npm start            # CRA dev server + Electron
npm test             # 157 tests
npm run build        # lint guard + production bundle
npm run dist         # build a local installer
npm run release:dry  # installer + latest.yml, without publishing
```

Requires Node 22.12+ (`@electron/rebuild` and `node-abi` set that floor). CI builds on Node 24.

### Releasing

```bash
npm version 4.0.1 && git push --follow-tags
```

The tagged push runs `.github/workflows/release.yml`, which installs, runs the lint guard and the
test suite, checks the tag matches `package.json`, then builds and publishes to GitHub Releases.
A tag that disagrees with `package.json` fails the release on purpose — electron-updater compares
against `package.json`, and a mismatch ships an update clients either never see or reinstall in a
loop.

---

## Project layout

```
electron/          main process — windows, IPC, file extraction, updater, local runtime
src/api/           one client per provider + the router that dispatches to them
src/core/          stores: chats, models, education, appearance, theme, memory, backup, keys
src/design/        design tokens, 27 skins, motion, appearance CSS
src/screens/       Chat · Agent · Education · Images · Advisor · Settings
src/ui/            shared primitives, icons, markdown renderer
src/utils/         token optimiser, cost tracker, contrast, agent loop, web fetcher
```

Design tokens are CSS custom properties. Components reference variables and never hardcode a
colour, which is what lets 27 themes and a live preview share one implementation.

---

## Privacy

- No telemetry, no analytics, no accounts.
- No backend. Requests go straight from your machine to the provider whose key you supplied.
- Chats, notes, decks and settings are stored locally.
- Backups are encrypted and API keys are excluded unless you explicitly opt in.

---

## What's new in v4.0.0

**Education Hub** — the whole thing: ingest, parallel comprehension, flashcards / quizzes / exam
papers, handwriting OCR, AI marking, FSRS-6 scheduling and a study dashboard.

**Appearance** — rebuilt as a two-column theme editor with a live preview, 27 themes (7 new),
per-token customisation, import/export, undo/redo, and a full accessibility group.

**Study Routing** — per-tier, per-job model overrides with fallback preserved.

**Auto-update** — fully automatic download and install from GitHub Releases.

**Fixes worth naming**

- Reasoning tokens were billed and then discarded on all five providers.
- `openrouter/fusion` ships `pricing: -1` meaning "cost unknown"; read as a number that is
  *negative* money — it cleared every value cap, won the cheapest-model bonus by millions, and
  subtracted from the running spend total. Unstated prices are now unknown, not cheap.
- Cumulative streaming text was being concatenated instead of replaced.
- Guard and safety models could be routed real work.
- ~1,700 lines of unreachable code removed, and a `no-undef` build guard added so a
  deleted-but-still-called function fails the build instead of surfacing as a frozen screen.

---

<div align="center">

**Made by Parikshit**

</div>
