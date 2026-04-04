<div align="center">

<img src="assets/logo.png" width="80" />

# ✨ KritakaPrajna

### *Artificial Intelligence, Refined*

> Your personal AI coding companion — one app, 100+ models, zero friction.

[![Release](https://img.shields.io/github/v/release/kaone31056789/KritakaPrajna?style=for-the-badge&color=d4a017)](https://github.com/kaone31056789/KritakaPrajna/releases)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![Made by](https://img.shields.io/badge/made%20by-Parikshit-ff6b6b?style=for-the-badge)](#)

---

<img src="Screenshots/splash.png" width="700" />

*The splash screen that greets you every launch*

<br/>

<img src="Screenshots/chat.png" width="700" />

*Clean, dark interface — sidebar, model picker, and chat*

</div>

---

## 🚀 What is this?

**KritakaPrajna** (कृतक प्रज्ञा — "Artificial Intelligence" in Sanskrit) is a sleek desktop app that lets you chat with **100+ AI models** across multiple providers — OpenRouter, OpenAI, Anthropic, and Hugging Face — all from one place.

No subscriptions. No browser tabs. Just **one app** to rule them all.

---

## 🎯 Features

| Feature | What it does |
|---------|-------------|
| 🧠 **100+ AI Models** | Switch between GPT-4o, Claude, Gemini, DeepSeek & more in one click |
| 🔌 **Multi-Provider** | Connect OpenRouter, OpenAI, Anthropic, and Hugging Face simultaneously |
| ⚡ **Streaming Responses** | Watch AI think in real-time, token by token |
| 🖼️ **Image Upload** | Drop images for multimodal models to analyze |
| ⌨️ **Slash Commands** | `/fix`, `/explain`, `/refactor` + create your own custom commands |
| 🔀 **Diff Viewer** | See code changes side-by-side with one-click accept |
| 🧭 **Smart Model Advisor** | AI-powered panel that recommends the best model for your task |
| 💰 **Cost Tracking** | Session cost, per-provider breakdown, monthly estimates — live |
| 📊 **Monthly Budget** | Set a limit — models show ✓/✗ indicators so you never overspend |
| 🧠 **User Memory** | Persistent preferences, coding style, and context across sessions |
| 🔐 **Encrypted Key Storage** | All API keys stored with OS-level encryption — never leave your machine |
| 🔄 **Auto-Updates** | App updates itself from GitHub Releases |
| 🪷 **Beautiful UI** | Custom frameless window, dark theme, smooth animations |

---

## 🆕 What's New in v2.0.0

### Multi-Provider Support
Connect to **4 providers at once**. OpenRouter for the widest model selection, direct OpenAI and Anthropic APIs for latest frontier models, and Hugging Face for open-source models. Switch between them without re-entering keys.

### Intelligent Model Advisor
A side panel that watches what you're doing and recommends the right model. Shows best overall, best free, best value, cheapest paid, and a budget pick — all updated in real time as you chat.

### Monthly Budget System
Set a monthly spending limit in Settings. Every model in the selector shows a **✓** (fits budget) or **✗** (over budget) badge based on your actual token usage patterns. Click an over-budget model and you get a warning before it switches.

### User Memory
KritakaPrajna remembers you. Preferences, coding style, and context persist across sessions and shape the AI's responses. Import memories from another AI using the 2-step import flow (copy prompt → paste response).

### Usage Dashboard
The sidebar now shows a full billing view — session cost, model used, monthly estimate, per-provider breakdown, and remaining credits. No more guessing what you're spending.

### Security Hardening
- OS-level key encryption via `safeStorage` (no plaintext fallback)
- File system access scoped strictly to user-opened folders
- Markdown links sanitized to block `javascript:` / `file://` injection
- Legacy hardcoded encryption key removed

---

## 🔑 Getting Your API Key

1. Head to **[openrouter.ai](https://openrouter.ai/)**
2. Sign up (it's free — you even get free credits!)
3. Go to **[Keys](https://openrouter.ai/keys)** → Click **Create Key**
4. Name it whatever you want → **Copy the key** (starts with `sk-or-v1-...`)
5. Paste it into KritakaPrajna on first launch — done!

> 💡 **Pro tip:** Many models on OpenRouter are completely free. You can start chatting without spending a single penny.

---

## 📥 Installation

### The Easy Way (Recommended)

1. Go to [**Releases**](https://github.com/kaone31056789/KritakaPrajna/releases)
2. Download `KritakaPrajna-Setup-2.0.0.exe`
3. Run the installer → Choose your install location
4. Launch from Desktop or Start Menu
5. Paste your API key → **Start chatting!**

### The Dev Way

```bash
git clone https://github.com/kaone31056789/KritakaPrajna.git
cd KritakaPrajna
npm install
npm start
```

---

## 🛠️ Slash Commands

Type these in the chat input for quick actions:

| Command | What happens |
|---------|-------------|
| `/fix <code>` | Fixes bugs and shows a diff viewer |
| `/explain <code>` | Explains code in plain English |
| `/refactor <code>` | Suggests cleaner code structure |
| `/custom` | Create your own slash commands! |

---

## 🏗️ Built With

```
Electron 28      →  Desktop wrapper
React 18         →  UI framework
Tailwind CSS 3   →  Styling
Framer Motion    →  Smooth animations
OpenRouter API   →  100+ AI models
OpenAI API       →  GPT-4o, o1, o3
Anthropic API    →  Claude 3.5 / 4
Hugging Face     →  Open-source models
electron-store   →  Encrypted local storage
electron-updater →  Auto-updates from GitHub
```

---

## 🔄 Auto-Updates

KritakaPrajna updates itself! When a new version drops:

1. App detects the update on launch
2. Asks you to download
3. Downloads in the background (progress bar shown)
4. Prompts to restart
5. Installs and you're on the latest version ✅

---

## 📂 Project Structure

```
KritakaPrajna/
├── electron/          # Main process + preload
├── src/
│   ├── components/    # React components (ChatApp, ModelSelector, Advisor, etc.)
│   ├── api/           # OpenRouter, OpenAI, Anthropic, Hugging Face integrations
│   └── utils/         # Commands, cost tracking, memory, model advisor
├── assets/            # Logo & icons
├── Screenshots/       # App screenshots
└── package.json       # Config & build settings
```

---

<div align="center">

### 🪷 Made with ❤️ by **Parikshit**

*KritakaPrajna — because you deserve better than a browser tab.*

</div>
