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

*Clean, dark interface — sidebar, model picker, file context, and chat*

</div>

---

## 🚀 What is this?

**KritakaPrajna** (कृतक प्रज्ञा — "Artificial Intelligence" in Sanskrit) is a sleek desktop app that lets you chat with **100+ AI models** through [OpenRouter](https://openrouter.ai/) — GPT-4o, Claude, Gemini, DeepSeek, Llama, and way more.

No subscriptions. No browser tabs. Just **one app** to rule them all.

---

## 🎯 Features That Slap

| Feature | What it does |
|---------|-------------|
| 🧠 **100+ AI Models** | Switch between GPT-4o, Claude, Gemini, DeepSeek & more in one click |
| ⚡ **Streaming Responses** | Watch AI think in real-time, token by token |
| 📁 **File Context** | Open a project folder and feed files directly into the conversation |
| 🖼️ **Image Upload** | Drop images for multimodal models to analyze |
| ⌨️ **Slash Commands** | `/fix`, `/explain`, `/refactor` + create your own custom commands |
| 🔀 **Diff Viewer** | See code changes side-by-side with one-click accept |
| 🧭 **Smart Model Select** | Auto-picks the best model for your task |
| 💰 **Cost Tracking** | Know exactly what you're spending per session & lifetime |
| 🔐 **Encrypted Key Storage** | API key stored locally with encryption — never leaves your machine |
| 🔄 **Auto-Updates** | App updates itself from GitHub Releases |
| 🪷 **Beautiful UI** | Custom frameless window with lotus logo, dark theme, smooth animations |

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
2. Download `KritakaPrajna-Setup-X.X.X.exe`
3. Run the installer → Choose your install location
4. Launch from Desktop or Start Menu
5. Paste your OpenRouter API key → **Start chatting!**

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
Electron 28     →  Desktop wrapper
React 18        →  UI framework
Tailwind CSS 3  →  Styling
Framer Motion   →  Buttery smooth animations
OpenRouter API  →  100+ AI models
electron-store  →  Encrypted local storage
electron-updater → Auto-updates from GitHub
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
│   ├── components/    # React components (ChatApp, ModelSelector, etc.)
│   ├── api/           # OpenRouter API integration
│   └── utils/         # Commands, cost tracking, diff engine
├── assets/            # Logo & icons
├── Screenshots/       # App screenshots
└── package.json       # Config & build settings
```

---

<div align="center">

### 🪷 Made with ❤️ by **Parikshit**

*KritakaPrajna — because you deserve better than a browser tab.*

</div>
