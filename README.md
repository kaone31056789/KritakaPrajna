# KritakaPrajna

AI coding assistant desktop app powered by [OpenRouter](https://openrouter.ai/).

Built with Electron, React, and Tailwind CSS.

**Made by Parikshit**

---

## Features

- Multi-model AI chat (GPT-4o, Claude, Gemini, DeepSeek, and more)
- Streaming responses with Server-Sent Events
- File & image upload with multimodal support
- Project folder context for code-aware conversations
- Slash commands (`/fix`, `/explain`, `/refactor`, and custom commands)
- Diff viewer for code fixes with one-click accept
- Smart model selection based on task type
- Cost tracking per message
- System prompt editor
- Multi-chat history with localStorage
- Secure API key storage (encrypted via electron-store)
- Auto-updates via GitHub Releases
- Custom frameless window with lotus logo

---

## Getting Started

### 1. Get an OpenRouter API Key

1. Go to [https://openrouter.ai/](https://openrouter.ai/)
2. Sign up or log in
3. Navigate to **Keys** → [https://openrouter.ai/keys](https://openrouter.ai/keys)
4. Click **Create Key**
5. Give it a name (e.g., "KritakaPrajna") and click **Create**
6. Copy the key — it starts with `sk-or-v1-...`

> **Tip:** OpenRouter gives free credits to new accounts. You can also add credits via the dashboard to use premium models.

### 2. Install the App

Download the latest installer from [GitHub Releases](https://github.com/kaone31056789/KritakaPrajna/releases).

Run `KritakaPrajna Setup x.x.x.exe` and follow the installer prompts.

### 3. Enter Your API Key

On first launch, the app will prompt you to paste your OpenRouter API key. It is stored securely on your machine (encrypted, never sent anywhere except OpenRouter).

---

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
git clone https://github.com/kaone31056789/KritakaPrajna.git
cd KritakaPrajna
npm install
```

### Run in Development

```bash
npm start
```

This starts the React dev server and Electron concurrently.

### Build Installer

```bash
npm run dist
```

Outputs the NSIS installer to `dist/KritakaPrajna Setup x.x.x.exe`.

---

## Auto-Updates

The app checks for updates automatically on launch via GitHub Releases.

When a new version is available:
1. A dialog appears asking to download
2. The update downloads in the background (progress shown in-app)
3. Once downloaded, a dialog prompts to restart
4. The app restarts and installs the update

### Releasing a New Version

1. Bump the version in `package.json`
2. Build: `npm run dist`
3. Create a new GitHub Release with tag `vX.X.X`
4. Upload these files from `dist/`:
   - `KritakaPrajna Setup X.X.X.exe`
   - `latest.yml`
5. Publish the release

---

## Tech Stack

| Layer       | Technology                    |
| ----------- | ----------------------------- |
| Desktop     | Electron 28                   |
| Frontend    | React 18, Tailwind CSS 3      |
| Animations  | Framer Motion 11              |
| AI Backend  | OpenRouter API (100+ models)  |
| Key Storage | electron-store (encrypted)    |
| Updates     | electron-updater + GitHub     |
| Installer   | electron-builder (NSIS)       |

---

## License

MIT

---

**Made with ❤️ by Parikshit**
