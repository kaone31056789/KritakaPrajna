# KritakaPrajna

<p align="left">
  <a href="https://github.com/kaone31056789/KritakaPrajna/releases"><img src="https://img.shields.io/badge/Release-v2.7.0-22c55e?style=for-the-badge" alt="Release"></a>
  <img src="https://img.shields.io/badge/Platform-Windows-2563eb?style=for-the-badge" alt="Platform">
  <img src="https://img.shields.io/badge/Electron-35.x-0ea5e9?style=for-the-badge" alt="Electron">
  <img src="https://img.shields.io/badge/React-18-0891b2?style=for-the-badge" alt="React">
  <img src="https://img.shields.io/badge/Status-Active-f59e0b?style=for-the-badge" alt="Status">
</p>

KritakaPrajna is a desktop AI assistant built with Electron + React that brings multiple model providers into one premium chat experience.

It is free to use, open-source, and optimized for power users who want fast model switching, live web context, cost visibility, and practical coding workflows.

## Highlights

- Multi-provider routing in one app: OpenRouter, Hugging Face, OpenAI, and Anthropic.
- Smart model advisor with cost/performance tradeoff recommendations.
- Live web-context mode with source-aware responses.
- Terminal-aware markdown blocks and command workflow support.
- Split-chat and advanced prompt workflows for deeper analysis.
- Local key storage and desktop-first UX.

## Screenshots

### Splash
![Splash Screen](Screenshots/splash.png)

### Main Chat
![Main Chat](Screenshots/chat.png)

## Core Features

### 1. Unified Provider Access

Switch providers without leaving the app.

- OpenRouter for broad model catalog and pricing flexibility.
- Hugging Face for free and OSS-heavy options.
- OpenAI and Anthropic support for premium model workflows.

### 2. Smart Model Advisor

Built-in advisor helps pick the best model based on real context.

- Task-aware suggestions (coding, vision, general, document).
- Cost-aware alternatives and value picks.
- Feature-aware scoring (web usage, reasoning depth, terminal intent).

### 3. Web-Aware Responses

The web layer fetches and injects live context before the model answers.

- Fast mode for speed-first browsing.
- Deep mode for broader context gathering.
- Source tracking and citation-friendly context formatting.

### 4. Developer Workflow UX

Designed for actual coding sessions.

- Markdown + syntax highlighting.
- Terminal-style command integration in assistant output.
- File context, diff workflows, and practical retry/regenerate controls.

### 5. Desktop Experience

Purpose-built Electron desktop app.

- Custom title bar and native window controls.
- Auto-update plumbing with release assets.
- Installer-based Windows delivery.

## Quick Start (Installer)

1. Open Releases: https://github.com/kaone31056789/KritakaPrajna/releases
2. Download `KritakaPrajna-Setup-2.7.0.exe`
3. Install and launch KritakaPrajna
4. Add provider API keys from Settings

## Run From Source

### Prerequisites

- Node.js 18+
- npm 9+
- Windows (recommended for installer workflow)

### Install Dependencies

```bash
npm install
```

### Start App (React + Electron)

```bash
npm start
```

### Build Web Bundle

```bash
npm run build
```

### Build Installer

```bash
npm run dist
```

## Configuration

Provider API keys are managed inside the app Settings panel.

- OpenRouter key
- Hugging Face token
- OpenAI key
- Anthropic key

Keys are stored locally on your machine for desktop usage.

## Tech Stack

- Electron
- React
- Tailwind CSS
- Framer Motion
- react-markdown + remark-gfm
- react-syntax-highlighter
- electron-builder

## Project Structure

```text
electron/         Main process + preload bridge
src/components/   UI components and chat experience
src/api/          Provider adapters and routing
src/utils/        Advisor, costs, memory, intents, helpers
assets/           Logos and build resources
Screenshots/      README visuals
```

## Security Notes

- API credentials are kept in local desktop storage.
- Electron IPC boundaries are enforced via preload bridge.
- Release flow includes dependency audit checks.

## v2.7.0 Release Focus

- Better web flow and fallback behavior
- Improved model advisor context scoring
- Refined UI interactions and desktop workflow polish
- Updated release metadata and installer packaging

## Contributing

Issues and pull requests are welcome.

If you submit changes, include:

- Clear problem statement
- Reproduction steps (if bug)
- Before/after behavior summary
- Screenshots for UI changes when applicable

## Support

Use GitHub Issues for:

- Bug reports
- Feature requests
- Release feedback

---

Built by Parikshit