# KritakaPrajna — Improvement Plans

Two plans: (A) making the Agent a "real agent" + Agent UI upgrades, (B) memory management system.
Grounded in the current code: `src/core/agent.js`, `src/utils/agentLoop.js` (tools: `read_file`,
`write_file`, `edit_file`, `list_directory`, `run_command`, `search_files`, `search_web`),
`src/screens/Agent/*`, `src/utils/userMemory.js`, `src/utils/tokenOptimizer.js`.

---

## Plan A — "Real Agent"

### Phase 1: Native tool calling (highest impact)
Today the loop parses tool calls out of raw text (`parseAgentResponse` handles XML / fenced JSON /
bare-JSON dialects per model). That works, but is lossy and blocks parallel calls.
1. **Use provider-native `tools` / `tool_calls`** (OpenRouter supports OpenAI-style function calling
   for most models). Send `AGENT_TOOL_DEFINITIONS` as real schemas; keep the text parser as fallback
   for models without tool support (reuse the existing per-model dialect detection).
2. **Parallel tool execution** — when the model returns multiple `tool_calls`, run read-only tools
   (`read_file`, `list_directory`, `search_files`, `search_web`) concurrently with `Promise.all`;
   serialize mutating ones (`write_file`, `edit_file`, `run_command`).
3. **Structured tool results** — return `{ role: "tool", tool_call_id, content }` messages instead of
   splicing text, so follow-up turns stay well-formed.

### Phase 2: Better tools
4. `apply_patch` — multi-hunk search/replace across files (extends `edit_file`), with a unified-diff
   preview returned to the UI before write.
5. `grep` upgrade for `search_files` — regex + glob filters + context lines (currently substring).
6. Git tools: `git_status`, `git_diff`, `git_commit` (behind the existing permission gate — add a
   `VCS` category to `HIGH_RISK_PERMISSION_CATEGORIES`).
7. `run_tests` — wraps `run_command` with structured pass/fail parsing so the loop can self-verify.
8. Workspace map tool — cached file tree + exports index generated once per run, injected as a
   compact context block instead of repeated `list_directory` calls.

### Phase 3: Loop intelligence
9. **Self-verification pass**: after the model says "done", force one cheap reflection turn
   ("re-read changed files, run syntax check / tests, confirm or fix"). Reuse the free-model routing
   from the token optimizer to keep it cheap.
10. **Error recovery**: on tool failure, inject a structured error + one retry hint instead of raw
    stderr dump; cap retries per tool per iteration (guards `DEFAULT_MAX_ITERATIONS` burn).
11. **Checkpoint & rollback**: since the workspace is a git repo, snapshot (`git stash create` or a
    temp commit) before the first mutating tool call; expose "Revert run" in the UI.
12. **Context compaction in-loop**: pipe agent history through `estimateUsageFromMessages` +
    `buildSlidingWindowHistory` so long runs compress old tool results (already truncated via
    `MAX_TOOL_RESULT_CHARS`, but not summarized).
13. **Sub-tasks**: let the plan executor spawn a scoped child loop per plan step with only the files
    that step needs — keeps token use flat on big plans.

### Phase 4: Agent UI
14. **Diff review cards** — every `write_file`/`edit_file`/`apply_patch` renders an inline diff with
    per-file Accept / Reject (wire into the existing approval flow and Changes tab).
15. **Plan editing** — make PLAN.md steps editable/reorderable in the plan card before Approve
    (currently approve/deny only).
16. **Run timeline** — checkpoint markers on the ActivityStream; click to view state / revert.
17. **Live token/cost budget** — show remaining budget per run (data already in cost tracker HUD);
    warn before starting an iteration that would exceed it.
18. **Notifications** — OS notification when a run finishes or blocks on a permission request while
    the window is unfocused.
19. **Terminal streaming** — stream `run_command` output incrementally into the Terminal tab instead
    of on-completion.

**Order of attack:** 1 → 3 → 14 → 4 → 9 → 11 → rest. Phase 1 unlocks everything else.

---

## Plan B — Memory Management

Current state (`src/utils/userMemory.js`): regex-based `detectMemoryFromExchange`, category defs
(`MEMORY_CATEGORY_DEFS`), explicit remember/forget commands, `memoryPromptSection` injects top
entries into every system prompt, Memory tab in Settings, electron-store persistence.

### Phase 1: Smarter capture
1. **LLM extraction instead of regex** — after an exchange, send (debounced, batched every N turns)
   a tiny prompt to a free model: "extract durable user facts/preferences as JSON". Keep regex as
   offline fallback. Confidence score per entry.
2. **Review queue** — auto-captured items land in a "pending" state; a small chip in Settings →
   Memory ("3 new memories — review") lets the user approve/edit/discard. Explicit `remember:`
   commands skip the queue.
3. **Dedupe & merge** — before insert, compare against existing entries (normalized text similarity);
   update-in-place instead of appending near-duplicates.

### Phase 2: Smarter retrieval
4. **Relevance-scored injection** — instead of always injecting top entries per category, score
   entries against the outgoing user message (keyword overlap now; embeddings later) and inject only
   top-k within a token budget (integrates with `enforceInputTokenBudget` so memory shrinks first
   under pressure, before chat history).
5. **Metadata per entry** — `createdAt`, `lastUsedAt`, `useCount`, `source` (auto/explicit/agent),
   `confidence`. Decay: entries unused for 90 days get down-ranked, never silently deleted.
6. **Per-chat episodic memory** — store a rolling chat summary on the chat object (reuse
   `buildHistorySummaryPrompt`); global memory stays for cross-chat facts only.

### Phase 3: Agency + transparency
7. **Memory tools for the model** — expose `memory_save` / `memory_search` as agent tools so the
   model can deliberately persist/retrieve facts (gated by the same review queue).
8. **"Memory used" indicator** — chip on assistant messages listing which entries were injected for
   that reply; click to open them in Settings → Memory.
9. **Import/export** — JSON export/import of memory (pairs with the existing encrypted backup flow).

**Order of attack:** 1 → 3 → 4 → 2 → 5 → rest.
