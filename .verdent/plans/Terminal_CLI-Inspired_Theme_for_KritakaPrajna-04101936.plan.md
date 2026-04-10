## Plan Comparison

| Aspect | Plan 1 (Claude) | Plan 2 (Gemini) | Final Choice |
|--------|-----------------|-----------------|--------------|
| Background | `#0a0a0a` (pure black) | `#0a0f1a` (existing dark blue) | **Plan 1**: Purer terminal feel |
| Logo | SVG `>_` prompt with blinking cursor | Plain `<span>` `[KP]` text | **Plan 1**: SVG scales better across sizes 16-512px |
| Title bar text | `>_ KritakaPrajna` | `tty1 - KritakaPrajna` | **Plan 1**: Cleaner, less gimmicky |
| Splash | ASCII box art | systemd boot `[ OK ]` lines | **Plan 2**: More authentic terminal boot |
| Messages | Flat boxes with terminal prefixes | No backgrounds, raw text | **Hybrid**: Flat boxes (readability) + terminal prefixes (aesthetic) |
| Shadows | Simplified single-layer dark | Retro offset `4px 4px` | **Plan 1**: Offset shadows too gimmicky for daily-use app |
| Detail level | Line-by-line for all 19 files | High-level for several files | **Plan 1**: More actionable |

**Recommendation**: Plan 1's approach is more complete and practical. Plan 2's systemd boot splash and left-border active indicator are adopted.

---

## Objective

Transform the entire UI from polished glassmorphism dark theme to a terminal/CLI-inspired aesthetic: monospace fonts, terminal green (`#00ff41`) accent, sharp corners, flat opaque surfaces, CRT scanline effects, `>` prompt prefixes — while preserving all functionality.

---

## Step 1: Foundation — `tailwind.config.js`

### Colors — add `term` palette
```js
term: {
  green: "#00ff41",
  "green-dim": "#00cc33",
  cyan: "#00d4ff",
  amber: "#ffb000",
  red: "#ff3333",
  bg: "#0a0a0a",
  "bg-light": "#111111",
  "bg-panel": "#1a1a1a",
  border: "#1a1a1a",
  "border-bright": "#2a2a2a",
  text: "#b0b0b0",
  "text-bright": "#e0e0e0",
}
```

### Font family — override `sans` and add `mono`
```js
fontFamily: {
  sans: ['"JetBrains Mono"', '"Fira Code"', '"IBM Plex Mono"', "monospace"],
  mono: ['"JetBrains Mono"', '"Fira Code"', '"IBM Plex Mono"', "monospace"],
  serif: ['"JetBrains Mono"', "monospace"],  // override serif too
}
```

### Box shadows — flatten for terminal
```js
boxShadow: {
  "elevation-1": "0 1px 3px rgba(0,0,0,0.5)",
  "elevation-2": "0 2px 6px rgba(0,0,0,0.5)",
  "elevation-3": "0 4px 10px rgba(0,0,0,0.5)",
  "elevation-4": "0 6px 16px rgba(0,0,0,0.6)",
  "elevation-5": "0 8px 24px rgba(0,0,0,0.6)",
  "inner-glow": "inset 0 1px 0 rgba(0,255,65,0.04)",
  "inner-shadow": "inset 0 2px 4px rgba(0,0,0,0.4)",
  "glow-green": "0 0 8px rgba(0,255,65,0.15), 0 0 2px rgba(0,255,65,0.1)",
  "glow-cyan": "0 0 8px rgba(0,212,255,0.15), 0 0 2px rgba(0,212,255,0.1)",
  "3d-button": "0 1px 2px rgba(0,0,0,0.4), inset 0 1px 0 rgba(0,255,65,0.08)",
  "3d-button-active": "inset 0 2px 3px rgba(0,0,0,0.6)",
}
```

### Keyframes — add terminal animations
```js
"cursor-blink": { "0%,100%": { opacity: "1" }, "50%": { opacity: "0" } },
scanline: { "0%": { transform: "translateY(-100%)" }, "100%": { transform: "translateY(100%)" } },
```
```js
animation: { "cursor-blink": "cursor-blink 1s step-end infinite", scanline: "scanline 8s linear infinite" }
```

---

## Step 2: Foundation — `src/index.css`

- **Font import**: Replace Google Fonts URL with `JetBrains Mono` from Google Fonts
- **Body**: `background-color: #0a0a0a; color: #b0b0b0; font-family: "JetBrains Mono", monospace;`
- **Scrollbar**: `#1a1a1a` thumb on `#0a0a0a` track, no gradient
- **`.glass`**: Remove `backdrop-filter`, use `background: rgba(10,10,10,0.95); border: 1px solid #1a1a1a;`
- **`.glass-sidebar`**: Same flat treatment
- **`.card-3d`**: `background: #111111; border: 1px solid #1a1a1a; box-shadow: 0 2px 6px rgba(0,0,0,0.5);`
- **`.surface-0..3`**: Flat solid dark backgrounds (`#0a0a0a` → `#1a1a1a`)
- **`.inner-highlight`**: `box-shadow: inset 0 1px 0 rgba(0,255,65,0.04);`
- **`.noise-overlay::after`**: Convert to CRT scanline `background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,65,0.02) 2px, rgba(0,255,65,0.02) 4px);`
- **`.separator-fade`**: Terminal green tint: `rgba(0,255,65,0.08)` instead of white
- **Focus ring**: `box-shadow: 0 0 0 2px rgba(0,255,65,0.2), 0 0 0 4px rgba(0,255,65,0.08);`
- **New `.text-glow-green`**: `text-shadow: 0 0 8px rgba(0,255,65,0.3);`
- **New `.terminal-cursor`**: Blinking cursor via `animation: cursor-blink 1s step-end infinite`
- **Markdown list items**: `background: rgba(0,255,65,0.03); border-color: rgba(0,255,65,0.08);` Counter badge: green instead of saffron

---

## Step 3: `KPLogo.jsx`

Replace entire SVG lotus with terminal `>_` prompt symbol:
- Background: dark rect with `#1a1a1a` border
- `>_` text in `#00ff41` monospace
- Blinking cursor rect (size >= 24 only)
- Size < 24: minimal `>` only

---

## Step 4: `TitleBar.jsx`

- Background: flat `bg-[#0a0a0a]` with `border-b border-[#1a1a1a]`
- Remove gradient, borderImage, boxShadow
- Brand text: `>_ KritakaPrajna` in `text-[#00ff41] font-mono text-[11px]`
- Logo glow: `0 0 6px rgba(0,255,65,0.1)` instead of orange
- Window controls: `hover:bg-[#1a1a1a]` flat, close still `hover:bg-red-500`

---

## Step 5: `SplashScreen.jsx`

- Background: `bg-[#0a0a0a]`
- Replace MandalaIcon with ASCII art or CLI boot text:
  ```
  [ OK ] Loading modules...
  [ OK ] Initializing runtime...
  >_ KritakaPrajna v2.8.5
  ```
- Remove all radial glow rings
- Loading bar: `bg-[#00ff41]` flat, no gradient, on `bg-[#1a1a1a]` track
- Tagline: `"SYSTEM READY"` in `text-[#00ff41]/60` monospace uppercase

---

## Step 6: `ApiKeyScreen.jsx`

- Form card: `bg-[#111111] border-[#1a1a1a] rounded-sm` (remove rounded-2xl)
- MandalaSmall → terminal `>_` mark
- Provider cards: `rounded-sm`, selected = `border-[#00ff41]/40 bg-[#00ff41]/5`, inactive = `bg-[#0a0a0a] border-[#1a1a1a]`
- Checkmark: `bg-[#00ff41]` instead of saffron
- Inputs: `bg-[#0a0a0a] border-[#1a1a1a] rounded-sm font-mono`, focus: green ring
- Submit: `bg-[#00ff41] text-black rounded-sm font-mono font-bold`
- Provider badges: green/cyan instead of violet/emerald

---

## Step 7: `ChatApp.jsx`

- Main bg: `bg-[#0a0a0a]`
- Sidebar: `bg-[#0a0a0a] border-r border-[#1a1a1a]`, remove shadow divider
- Brand header: `>_ KritakaPrajna` green text, remove serif font
- Logo: `shadow-glow-green` instead of `shadow-glow-saffron`
- separator-fade: already updated via CSS
- New Chat button: `bg-[#111111] border-[#1a1a1a] rounded-sm`, saffron hover → green
- Chat items: `rounded-sm`, active: `border-l-2 border-[#00ff41]` left indicator, remove saffron
- Usage section: green text-shadow glow instead of amber

---

## Step 8: `MessageList.jsx`

- **User bubbles**: `bg-[#1a1a1a] border border-[#2a2a2a] rounded-sm` with `user@kp ~$` prefix in green
- **AI bubbles**: `bg-[#111111] border-[#1a1a1a] rounded-sm` with `kp_ai>` prefix in cyan
- **AiIcon**: `bg-[#111111] border-[#00ff41]/20` with `>` SVG text in green
- **Welcome MandalaLogo**: Replace with terminal `>_` icon
- **Welcome heading**: `font-mono` instead of `font-serif`, `text-[#00ff41]` text-glow
- **ThinkingBlock**: Green animated dots instead of saffron, `border-[#1a1a1a]`
- **Streaming cursor**: `bg-[#00ff41]` instead of saffron
- **Action buttons**: hover `text-[#00ff41]` instead of saffron
- **Attachment chips**: `bg-[#1a1a1a] text-[#00ff41] border border-[#00ff41]/20`
- **Deep analysis**: `border-[#00d4ff]/20` (cyan) instead of sky

---

## Step 9: `MessageInput.jsx`

- Input container: `rounded-sm` instead of `rounded-full`, `bg-[#111111] border-[#1a1a1a]`
- Add `>` prefix element before textarea: `text-[#00ff41] font-mono text-sm`
- Focus glow: green ring instead of saffron
- Textarea: `font-mono`, placeholder `"> enter command..."`
- Send button: `bg-[#00ff41] text-black rounded-sm`
- Stop button: `bg-red-500/80 rounded-sm`
- Control pills (Reasoning/Web/Reply): `border-[#1a1a1a]`, active: `text-[#00ff41] bg-[#00ff41]/10 border-[#00ff41]/25`
- Command hints: `card-3d rounded-sm` (already terminal-like via CSS update)

---

## Step 10: `ModelSelector.jsx`

- Dropdown: `rounded-sm bg-[#111111] border-[#1a1a1a] shadow-elevation-4`
- Search: `bg-[#0a0a0a] border-[#1a1a1a] rounded-sm font-mono`
- Highlight match: `bg-[#00ff41]/20 text-[#00ff41]` instead of saffron
- Free badge: keep emerald green
- Star/favorite: `text-[#00ff41]` instead of saffron
- Price filter pills: green active state
- Task dropdown: same terminal treatment

---

## Step 11: `SettingsPanel.jsx`

- Provider rows: `rounded-sm` (from rounded-xl), `bg-[#111111] border-[#1a1a1a]`
- Connected badge: keep emerald
- Tab bar active: `text-[#00ff41] bg-[#00ff41]/10 border-[#00ff41]/25` instead of saffron
- All inputs: `font-mono`, green focus
- Toggle track: `bg-[#1a1a1a]`, checked: `bg-[#00ff41]`
- System prompt editor: `font-mono rounded-sm`
- Import modal: `rounded-sm`, green buttons

---

## Step 12: Remaining Components

| Component | Changes |
|-----------|---------|
| **TerminalPanel** | `rounded-sm`, unify `amber-*` → `#00ff41` green (header, command text, buttons, "Suggested Command" label), output bg `#050505` |
| **SmartModelBanner** | `rounded-sm`, saffron accents → green, monospace text |
| **PromptBanners** | `rounded-sm`, saffron → green for all 3 banner variants |
| **UpdateBanner** | `bg-[#00ff41] text-black rounded-sm` solid bar |
| **DiffViewer** | `rounded-sm`, header `bg-[#111111]`, saffron accents → green |
| **WebResultCard** | `rounded-sm`, hover border green, source pills monospace |
| **ModelAdvisorCard** | `rounded-sm`, panel `bg-[#0a0a0a] border-[#1a1a1a]`, saffron → green for buttons/badges |
| **AgentIdeWorkspace** | Update `C` constants: `accent: "#00ff41"`, `accentText: "#00ff41"`, `accentSoft: "rgba(0,255,65,0.12)"`, `green: "#00ff41"`, `bg: "#0a0a0a"`, `editorBg: "#0d0d0d"`, `border: "#1a1a1a"`, etc. This propagates through ~1900 lines |

---

## Verification / DoD

| Check | Target | Method |
|-------|--------|--------|
| Build passes | All files | `npm run build` — zero errors |
| All text monospace | Every screen | Visual: no Inter/Playfair Display visible |
| Background pure black | Body, sidebar, panels | Visual: `#0a0a0a` everywhere |
| Green accent | All interactive elements | Visual: `#00ff41` replaces all saffron |
| Sharp corners | Cards, buttons, inputs | Visual: no rounded-2xl/xl visible |
| Glassmorphism gone | Glass panels | Visual: no blur/transparency |
| Splash terminal boot | Splash screen | Visual: CLI text, no mandala |
| Message prefixes | Chat messages | Visual: `user@kp ~$` and `kp_ai>` |
| Prompt input | Message input | Visual: `>` prefix, rectangular shape |
| CRT scanline | Noise overlay elements | Visual: horizontal scan lines |
| All features work | Chat, model select, settings, agent, file upload, terminal, web search | Interaction test |
| Contrast accessible | Green on black | `#00ff41` on `#0a0a0a` = ~12:1 ratio |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Readability with all-monospace | Use `text-[13px]`+ for body text, adequate line-height |
| Logo at 16px in TitleBar | Conditional render: `>` only at size < 24 |
| Markdown code blocks blending with UI | Keep distinct `bg-[#0d0d0d]` for code, `bg-[#111111]` for message bubbles |
| Saffron references missed | Global search for `saffron` after all edits — must return zero results in component files |
| `prefers-reduced-motion` | Keep existing media query, terminal cursor uses `step-end` (already minimal) |
