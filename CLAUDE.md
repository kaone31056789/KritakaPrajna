# KritakaPrajna — project notes for Claude

## Standing preferences

- **Feature suggestions → Feature Lab sites.** Whenever proposing features, roadmaps,
  or design upgrades for ANY website/app in this project, do NOT deliver them as a
  plain chat list. Build an interactive "Feature Lab" survey page instead (dark
  neumorphic brand style, Need/Want/Skip tri-state per feature, budget selector,
  custom-idea input, sticky summary with a copy-answers-as-markdown button),
  publish it as an artifact, and let the user pick. Include premium/expensive
  tiers and a "UI Lab" section for interface upgrades every time.
- Brand: dark neumorphic, bg `#101114`/`#141519`, ink `#ECE7DC`, accent gradient
  `#ff8a3d → #ffc46b`, logo = two-tone "K" monogram (stem `#ECE7DC` + gradient
  chevron), fonts: Plus Jakarta Sans / Space Grotesk / JetBrains Mono.

## App facts

- CRA + Electron desktop app ("Soft Machine" shell), React 18, framer-motion,
  Tailwind utility classes mapped to CSS vars in `src/design/tokens.css`.
- Providers: OpenRouter, HuggingFace (`src/api/huggingface.js`), NVIDIA NIM
  (`src/api/nvidia.js`) — static catalogs are fallbacks; live `/models` wins.
- Verify changes with `npm run build` (ESLint has no standalone config; it runs
  inside react-scripts only).
