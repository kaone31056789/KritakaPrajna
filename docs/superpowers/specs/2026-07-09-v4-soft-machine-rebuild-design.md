# KritakaPrajna v4 — "Soft Machine" Rebuild Design

Date: 2026-07-09 · Status: Approved by Parikshit ("do it", full creative freedom)

## Goal

Total rebuild of the Electron + React multi-provider AI app: dual-theme neumorphic design
system, world-class motion (Emil Kowalski standards), a *working* Agent workspace, a rebuilt
Model Advisor, four feature upgrades, dead-code removal, and performance optimization —
while preserving all user data (chats, personas, folders, keys) via legacy storage keys.

## Design System (`src/design/`)

- **Dark "Obsidian Clay"** (default): base `#16181d`, raised surfaces with dual shadow
  (near-black bottom-right + faint white sheen top-left).
- **Light "Porcelain"**: base `#e3e7ee`, white highlight + `#b9c0cc` shadow.
- **Accent**: saffron gradient `#ffb454 → #ff8a3d`. Semantic: sage (success), rose (error), sky (info).
- **Type**: Space Grotesk (display) · Plus Jakarta Sans (UI) · JetBrains Mono (code).
- **Grammar**: raised = cards/buttons; inset = inputs/wells/active states; pill toggles;
  16–24px squircle radii; double-bezel nesting for hero cards.
- **Motion** (Emil rules): custom cubic-beziers, UI 120–260ms, `scale(0.97)` press,
  30–50ms stagger, origin-aware popovers, **no animation on keyboard-triggered actions**,
  transform/opacity only, `prefers-reduced-motion` honored.

## Architecture

```
src/
  design/    tokens.css, motion.js
  core/      store factory + theme/chats/settings/models/agent stores,
             send pipeline, advisor engine, agent/ (loop, tools, permissions)
  api/       proven provider clients (openrouter, openai, anthropic, hf, ollama, nvidia)
             kept as the battle-tested data layer behind providerRouter
  utils/     retained proven utilities (costTracker, rateLimiter, userMemory, …)
  ui/        Neu primitives, Toaster, CommandPalette
  screens/   Splash, Onboarding, Shell, Chat, Agent, Advisor, Settings
```

- ChatApp monolith (4,631 lines, 66 useStates) is deleted; state moves to small
  `useSyncExternalStore`-based stores.
- Legacy localStorage/electron-store keys are read as-is → zero data loss.
- Electron main/preload kept; opencode engine handlers removed.

## Agents page (real)

Delete `AGENT_UI_ONLY_MODE` + opencode path + `opencode-ai` dep. Wire rebuilt Agent screen
directly to `AgentLoop`/`ToolExecutor`/`PermissionManager` (moved to `core/agent/`):
workspace picker, plan timeline, live tool calls, terminal stream, diff viewer,
permission modals with "always allow", abort, run-stats pill.

## Model Advisor (rebuilt)

Offline-first heuristic scoring (price, context, modality fit, latency class) that always
works; live signals optional with visible live/offline status. ~500 lines total, podium
stagger, one-click apply.

## Feature upgrades

Ctrl+K command palette (instant) · soft toast system (Sonner principles) · pinned chats +
chat search + animated folders · edit-and-resend / regenerate / copy / export-markdown.

## Experimental layer

View Transitions theme morph from toggle · dynamic-island status pill in titlebar ·
procedural gradient orbs as model avatars · subtle aurora ambient glow · emboss-pop
celebration on agent completion.

## Dead code & optimization

Delete: `agentUI.jsx`, `FileContext.jsx`, `build_log.txt`, `plan_scratch.json`,
`graphify-out/`, old monolith components after replacement.
Prune deps: `opencode-ai`, `graphify`, `web-vitals`, `prismjs`, `highlight.js`,
`react-simple-code-editor`, `react-file-icon` (keep react-syntax-highlighter as the single
highlighter). `React.lazy` per screen, memoized messages + `content-visibility` for long
chats.

## Implementation phases

1. Checkpoint commit (done: `9c9ba03`)
2. Design system (tokens.css, motion.js, fonts)
3. UI primitives + Toaster + CommandPalette
4. Core stores (legacy-compatible persistence)
5. Send pipeline over existing provider clients
6. Screens: Shell → Chat → Onboarding/Splash → Agent → Advisor → Settings
7. Swap entry point, delete dead code, prune deps
8. Verify: compile, run, test all flows, motion polish pass
9. ROADMAP.md with post-launch ideas

## Verification

`npm run build` compiles clean; `npm start` boots; manual QA of chat streaming, agent run
with permissions, advisor ranking, palette, theme morph, toasts, data migration.
