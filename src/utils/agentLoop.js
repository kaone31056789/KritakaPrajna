import { routeStream } from "../api/providerRouter";
import { estimateUsageFromMessages } from "./costTracker";

export const AGENT_TOOL_DEFINITIONS = {
  tools: [
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Read the contents of a file in the workspace",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative path from workspace root" },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "write_file",
        description: "Create or overwrite a file with complete content",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative path from workspace root" },
            content: { type: "string", description: "Complete file content to write" },
          },
          required: ["path", "content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "edit_file",
        description: "Apply search-and-replace edit to a file. old_text must match exactly.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative path from workspace root" },
            old_text: { type: "string", description: "Exact text to find in the file" },
            new_text: { type: "string", description: "Text to replace with" },
          },
          required: ["path", "old_text", "new_text"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_directory",
        description: "List files and subdirectories in a directory",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative path, use '.' for workspace root" },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_files",
        description: "Search for text patterns across files in the workspace",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Text or regex pattern to search for" },
            path: { type: "string", description: "Optional subdirectory to limit search" },
            regex: { type: "boolean", description: "Treat query as a regular expression (default false = literal text)" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "run_command",
        description: "Execute a shell command in the workspace directory",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "Shell command to execute" },
          },
          required: ["command"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_web",
        description: "Search the internet for documentation, solutions, or current information",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query, keep it short and specific" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "apply_patch",
        description: "Apply multiple search-and-replace edits to one file in a single atomic operation. Preferred over repeated edit_file calls.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative path from workspace root" },
            edits: {
              type: "array",
              description: "Edits applied in order; each old_text must match the current file content exactly",
              items: {
                type: "object",
                properties: {
                  old_text: { type: "string", description: "Exact text to find in the file" },
                  new_text: { type: "string", description: "Text to replace it with" },
                },
                required: ["old_text", "new_text"],
              },
            },
          },
          required: ["path", "edits"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_file",
        description: "Delete a file from the workspace",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative path from workspace root" },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "git_status",
        description: "Show git working-tree status (branch, staged/modified/untracked files)",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "git_diff",
        description: "Show git diff of uncommitted changes, optionally limited to one file",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Optional file path to limit the diff" },
            staged: { type: "boolean", description: "Show staged changes instead of unstaged" },
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "git_commit",
        description: "Stage all changes and create a git commit with the given message",
        parameters: {
          type: "object",
          properties: {
            message: { type: "string", description: "Commit message (imperative, one line)" },
          },
          required: ["message"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "run_tests",
        description: "Run the project's test suite (auto-detected from package.json when no command is given) and report a summary",
        parameters: {
          type: "object",
          properties: {
            command: { type: "string", description: "Optional explicit test command; defaults to the package.json test script" },
          },
        },
      },
    },
  ],
};

export const AGENT_SYSTEM_PROMPT_TEMPLATE = `You are KritakaPrajna Agent, an autonomous coding assistant operating inside a VS Code-style workspace. You have direct access to the user's files, terminal, and web search.

## Environment
- OS: {{OS_NAME}}
- Shell: {{SHELL}}
- Workspace: {{WORKSPACE_PATH}}
- Current files: {{FILE_TREE}}

## How You Work

You follow a strict PLAN -> EXECUTE -> REPORT cycle:

### Step 1: PLAN
When given a task, ALWAYS output a plan first using this exact format:

<plan>
<step status="pending">Description of step 1</step>
<step status="pending">Description of step 2</step>
<step status="pending">Description of step 3</step>
</plan>

### Step 2: EXECUTE
Execute each step by calling the appropriate tool. After each tool call, update the step status. Between tool calls, briefly state what you found or did.

### Step 3: REPORT
After all steps complete, give a SHORT prose summary (2-4 lines max):
- Which files you created or edited (exact paths) and what each change does
- Anything the user should do next
Do NOT paste the file contents or code back. The user sees every change in the
Changes tab and can open any file in the Files tab. Echoing code is wasted output.

## Available Tools

You call tools by writing PLAIN XML directly in your reply — exactly the format shown below.
CRITICAL tool-call rules:
- Write the tool call as literal text: \`<tool name="...">\` ... \`</tool>\`. Nothing else wraps it.
- Do NOT use any special function-calling tokens, channels, or JSON envelopes. No \`function\`, no separator symbols, no \`\`\`json blocks around calls.
- Emit ONE tool call per reply, then STOP and wait for the tool result before continuing.
- Do NOT write your private reasoning in the reply. No <think> blocks. Output only: a plan (if needed), short status lines, tool calls, and the final report.
- To CREATE or CHANGE a file you MUST call write_file or edit_file. Code or file contents you TYPE in your reply are DISCARDED — never saved, just wasted output. A markdown \`\`\` code block is NOT a file write and changes nothing on disk.
- Put the real code INSIDE the \`<param name="content">\` of a write_file call (or in old_text / new_text of edit_file). Never paste code anywhere else.

Use them by outputting the exact XML format shown:

### read_file
Read a file's contents. ALWAYS read before editing.
<tool name="read_file">
<param name="path">relative/path/to/file</param>
</tool>

### write_file
Create a new file or overwrite an existing one. Write the COMPLETE file content.
<tool name="write_file">
<param name="path">relative/path/to/file</param>
<param name="content">
full file content here
</param>
</tool>

### edit_file
Apply a targeted edit. old_text must match exactly.
<tool name="edit_file">
<param name="path">relative/path/to/file</param>
<param name="old_text">exact text to find</param>
<param name="new_text">replacement text</param>
</tool>

### list_directory
List files and folders.
<tool name="list_directory">
<param name="path">.</param>
</tool>

### search_files
Search for text across the workspace.
<tool name="search_files">
<param name="query">search text</param>
<param name="path">optional/subdirectory</param>
</tool>

### run_command
Execute a shell command.
<tool name="run_command">
<param name="command">npm install axios</param>
</tool>

### search_web
Search the internet for docs, solutions, or info.
<tool name="search_web">
<param name="query">react context api tutorial</param>
</tool>

### apply_patch
Apply several search-and-replace edits to ONE file atomically. Prefer this over
multiple edit_file calls on the same file. edits is a JSON array.
<tool name="apply_patch">
<param name="path">src/App.jsx</param>
<param name="edits">[{"old_text":"exact old","new_text":"replacement"}]</param>
</tool>

### git_status / git_diff
Inspect the repo state before and after changes.
<tool name="git_status">
</tool>
<tool name="git_diff">
<param name="path">optional/file.js</param>
</tool>

### git_commit
Stage everything and commit with a message.
<tool name="git_commit">
<param name="message">Add dark mode toggle</param>
</tool>

### run_tests
Run the project's test suite (defaults to the package.json test script).
<tool name="run_tests">
<param name="command">npm test</param>
</tool>

## Permission Categories

Each tool call falls into a permission category. In "Ask" mode, approvals are only for major/high-risk actions. In "Auto" mode, all actions execute immediately.

| Category | Tools | Risk |
|----------|-------|------|
| READ | read_file, list_directory, search_files, search_web, git_status, git_diff | Safe - no changes |
| CREATE | write_file (new files) | Medium - adds files |
| EDIT | edit_file, apply_patch, write_file (existing) | Medium - modifies files |
| VCS | git_commit | Medium - records a commit |
| TERMINAL | run_command, run_tests | High - runs commands |
| DELETE | delete_file | High - removes files |

READ actions ALWAYS execute without asking, even in "Ask" mode.

Ask mode policy:
- READ always executes.
- In PLAN_FIRST mode, approval happens once at plan execution time.
- In DIRECT mode, only high-risk actions (TERMINAL, DELETE) require approval.

Tool usage policy:
- Prefer write_file/edit_file for creating or modifying source files.
- Do NOT use run_command to create/edit files when file tools can do it.
- Use run_command for running, testing, building, linting, git, or diagnostics.

When outputting a tool call that needs permission, wrap it like this:
<permission category="CREATE" target="src/utils/theme.js">
<tool name="write_file">
<param name="path">src/utils/theme.js</param>
<param name="content">...</param>
</tool>
</permission>

## Rules

1. ALWAYS read a file before editing it. Never guess at contents.
2. ALWAYS output a plan before executing multi-step tasks.
3. For trivial tasks (single read, quick answer), skip the plan - just act.
4. Preserve existing code style, indentation, and conventions.
5. Only modify files relevant to the current task.
6. Handle errors: if a command fails, read the error, diagnose, fix, retry. Escalate after 2 failed attempts.
7. Write complete file contents - no partial snippets.
8. After creating or editing files, verify by reading them back.
9. Never expose secrets, API keys, or passwords found in files.
10. Never run destructive commands without explicit user confirmation.

## Communication Style

- Be concise. No filler phrases. Lead with action, not preamble.
- NEVER paste file contents, code blocks, or diffs into your reply. Code belongs ONLY inside a write_file / edit_file tool call. The user sees changes in the Changes tab.
- Between tool calls, give a short one-line status of what you are doing and why (e.g. "Reading index.html to see the current markup.").
- When the whole task is done, end with a brief plain-language summary — no code.
`;

const DEFAULT_MAX_ITERATIONS = 20;
const DEFAULT_COMMAND_TIMEOUT_MS = 30000;
const MAX_TOOL_RESULT_CHARS = 24000;

const READ_TOOLS = new Set([
  "read_file",
  "list_directory",
  "search_files",
  "search_web",
  "git_status",
  "git_diff",
]);
const HIGH_RISK_PERMISSION_CATEGORIES = new Set(["TERMINAL", "DELETE"]);

const TOOL_CATEGORY_MAP = {
  read_file: "READ",
  list_directory: "READ",
  search_files: "READ",
  search_web: "READ",
  git_status: "READ",
  git_diff: "READ",
  write_file: "CREATE",
  edit_file: "EDIT",
  apply_patch: "EDIT",
  git_commit: "VCS",
  run_tests: "TERMINAL",
  run_command: "TERMINAL",
  delete_file: "DELETE",
};

// In-loop context compaction: older tool results get truncated hard — the
// model already acted on them, so a stub is enough. Keeps multi-iteration
// runs inside the context window without an extra summarization call.
const COMPACT_KEEP_RECENT = 8;
const COMPACT_TOOL_RESULT_CHARS = 600;

function compactConversation(conversation) {
  if (!Array.isArray(conversation) || conversation.length <= COMPACT_KEEP_RECENT) return;
  for (let i = 0; i < conversation.length - COMPACT_KEEP_RECENT; i++) {
    const msg = conversation[i];
    const text = typeof msg?.content === "string" ? msg.content : "";
    const isToolResult =
      msg?.role === "tool" || (msg?.role === "user" && text.startsWith("[Tool result"));
    if (isToolResult && text.length > COMPACT_TOOL_RESULT_CHARS) {
      msg.content = `${text.slice(0, COMPACT_TOOL_RESULT_CHARS)}\n…[compacted — re-read the file if you need the full content]`;
    }
  }
}

function safeString(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function truncateText(value, limit = MAX_TOOL_RESULT_CHARS) {
  const text = String(value || "");
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n... (truncated)`;
}

function normalizeEscapedMultiline(value) {
  const raw = String(value ?? "");
  if (!raw) return "";

  if (raw.includes("\n") || raw.includes("\r")) {
    return raw;
  }

  const escapedNewlines = (raw.match(/\\n/g) || []).length;
  if (escapedNewlines < 2) {
    return raw;
  }

  return raw
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
}

function lineList(value) {
  const text = String(value ?? "");
  if (text.length === 0) return [];
  return text.split(/\r?\n/);
}

function computeLineChangeStats(beforeValue, afterValue) {
  const beforeLines = lineList(beforeValue);
  const afterLines = lineList(afterValue);

  const counts = new Map();
  for (const line of beforeLines) {
    counts.set(line, (counts.get(line) || 0) + 1);
  }

  let shared = 0;
  for (const line of afterLines) {
    const available = counts.get(line) || 0;
    if (available > 0) {
      shared += 1;
      counts.set(line, available - 1);
    }
  }

  const removed = Math.max(0, beforeLines.length - shared);
  const added = Math.max(0, afterLines.length - shared);

  return {
    added,
    removed,
    beforeLines: beforeLines.length,
    afterLines: afterLines.length,
  };
}

function clampArray(value, max = 20) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max);
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text" && typeof part?.text === "string") return part.text;
      if (typeof part?.content === "string") return part.content;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeMessagesForAgent(messages) {
  return clampArray(messages || [], 24)
    .map((msg) => {
      const role = msg?.role === "assistant" ? "assistant" : "user";
      const content = contentToText(msg?.content || "").trim();
      if (!content) return null;
      return { role, content };
    })
    .filter(Boolean);
}

function normalizePath(pathValue) {
  const raw = String(pathValue || "").trim().replace(/\\/g, "/");
  if (!raw) return "";

  const driveMatch = raw.match(/^[A-Za-z]:/);
  const drive = driveMatch ? driveMatch[0].toLowerCase() : "";
  let rest = drive ? raw.slice(2) : raw;
  const absolute = rest.startsWith("/");
  rest = rest.replace(/^\/+/, "");

  const parts = rest.split("/").filter(Boolean);
  const stack = [];

  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") {
      if (stack.length > 0 && stack[stack.length - 1] !== "..") {
        stack.pop();
      } else if (!absolute) {
        stack.push("..");
      }
      continue;
    }
    stack.push(part);
  }

  let normalized = "";
  if (drive) normalized += drive;
  if (absolute) normalized += "/";
  normalized += stack.join("/");

  if (!normalized) {
    if (drive) return `${drive}/`;
    return absolute ? "/" : "";
  }

  return normalized;
}

function isAbsoluteLike(pathValue) {
  const value = String(pathValue || "").trim();
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\\\");
}

function joinNormalized(basePath, nextPath) {
  const base = normalizePath(basePath);
  const next = normalizePath(nextPath);
  if (!base) return next;
  if (!next) return base;

  const slash = base.endsWith("/") ? "" : "/";
  return normalizePath(`${base}${slash}${next}`);
}

function isWithinBasePath(basePath, targetPath) {
  const base = normalizePath(basePath);
  const target = normalizePath(targetPath);
  if (!base || !target) return false;

  const isWindows = /^[a-z]:/i.test(base);
  const left = isWindows ? base.toLowerCase() : base;
  const right = isWindows ? target.toLowerCase() : target;

  return right === left || right.startsWith(`${left}/`);
}

function toNativePath(pathValue, workspacePath) {
  const normalized = normalizePath(pathValue);
  const useBackslash = String(workspacePath || "").includes("\\");
  if (!useBackslash) return normalized;

  if (/^[a-z]:/i.test(normalized)) {
    const drive = normalized.slice(0, 2);
    const rest = normalized.slice(2).replace(/\//g, "\\");
    return `${drive}${rest}`;
  }

  return normalized.replace(/\//g, "\\");
}

function escapeWindowsFindstrQuery(value) {
  return String(value || "").replace(/"/g, '""');
}

function escapeBashSingleQuoted(value) {
  return String(value || "").replace(/'/g, `'"'"'`);
}

function firstNonEmpty(values) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

// Known tool names — used to recognise native/JSON tool calls regardless of wrapper format.
const KNOWN_TOOL_NAMES = new Set([
  "read_file",
  "write_file",
  "edit_file",
  "apply_patch",
  "list_directory",
  "search_files",
  "run_command",
  "run_tests",
  "search_web",
  "delete_file",
  "git_status",
  "git_diff",
  "git_commit",
]);

// Strip model protocol/control tokens (DeepSeek, Qwen, Llama, GPT-OSS, etc.) and
// hidden reasoning so they never execute or leak into the user-visible output.
// Examples removed: <｜tool▁sep｜>, <|tool_calls_begin|>, <|python_tag|>, <think>…</think>.
export function stripAgentNoise(value) {
  let out = String(value ?? "");

  // Remove closed reasoning blocks entirely (the user does not want to see them).
  out = out.replace(/<think>[\s\S]*?<\/think>/gi, "");
  out = out.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "");
  // Stray reasoning tags from truncated streams.
  out = out.replace(/<\/?think>/gi, "").replace(/<\/?reasoning>/gi, "");

  // Remove <｜…｜> / <|…|> style special tokens (fullwidth ｜ U+FF5C or ASCII |,
  // fullwidth ▁ U+2581 or underscores/spaces inside).
  out = out.replace(/<\s*[｜|][^<>]*?[｜|]\s*>/g, "");
  // Remove common bare control tokens that some models emit without <> wrappers.
  out = out.replace(/<\/?(?:tool_calls?|tool_call|tool_sep|python_tag|channel|message|eot_id|eom_id|end_of_turn|start_header_id|end_header_id|im_start|im_end|s)\b[^>]*>/gi, "");
  out = out.replace(/[｜▁]/g, "");

  return out;
}

// Strip any residual agent-protocol tags (<plan>, <permission>, <tool>, <step>,
// <param>) from prose before it's shown to the user. Well-formed blocks are
// parsed into structured actions upstream; this catches truncated or stray tags
// from cut-off streams so raw markup never leaks into the message bubble.
export function stripProtocolTags(value) {
  let out = String(value ?? "");
  // Whole closed blocks first (inner is non-greedy so adjacent blocks survive).
  out = out.replace(/<plan>[\s\S]*?<\/plan>/gi, "");
  out = out.replace(/<permission\b[^>]*>[\s\S]*?<\/permission>/gi, "");
  out = out.replace(/<tool\b[^>]*>[\s\S]*?<\/tool>/gi, "");
  out = out.replace(/<step\b[^>]*>[\s\S]*?<\/step>/gi, "");
  // Any leftover stray open/close tags from a truncated stream.
  out = out.replace(/<\/?(?:plan|permission|tool|step|param)\b[^>]*>/gi, "");
  return out.trim();
}

// Convert a params object into the app's canonical <param> XML.
function paramsObjectToXml(paramsObject) {
  if (!paramsObject || typeof paramsObject !== "object") return "";
  return Object.entries(paramsObject)
    .map(([key, val]) => {
      const value = typeof val === "string" ? val : safeString(val);
      return `<param name="${key}">${value}</param>`;
    })
    .join("\n");
}

// Some models return arguments as a JSON string/object. Normalise to <param> XML.
function jsonArgsToParamXml(jsonLike) {
  let obj = jsonLike;
  if (typeof jsonLike === "string") {
    const trimmed = jsonLike.trim();
    if (!trimmed) return "";
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return "";
    }
  }
  return paramsObjectToXml(obj);
}

// Pull a balanced {...} object out of `text` starting at/after `from`, respecting
// string literals and escapes so braces inside strings don't terminate it early.
function extractBalancedBraces(text, from = 0) {
  const s = String(text);
  const start = s.indexOf("{", from);
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let quote = "";
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = true; quote = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return { json: s.slice(start, i + 1), end: i + 1 };
  }
  return null;
}

// Harmony / Kimi / OpenAI "functions." namespace calls emitted as plain text, e.g.
//   functions.read_file:0{"path":"index.html"}
//   functions.write_file({"path":"a","content":"<html>{}</html>"})
//   to=functions.run_command <|message|>{"command":"ls"}
// The ":id", wrapping () and harmony <|…|> glue are optional; the JSON is
// brace-matched so nested braces / multi-line content survive intact.
function rewriteNamespacedCalls(text) {
  const nameRe = /\b(?:functions|tools|tool|multi_tool_use|namespace)[._]([A-Za-z0-9_]+)/g;
  let out = "";
  let last = 0;
  let m;
  while ((m = nameRe.exec(text)) !== null) {
    const name = m[1];
    if (!KNOWN_TOOL_NAMES.has(name)) continue;
    const after = m.index + m[0].length;
    const window = text.slice(after, after + 80);
    const braceOffset = window.indexOf("{");
    if (braceOffset === -1) continue;
    const glue = window.slice(0, braceOffset);
    // Only benign glue may sit between the name and its JSON args.
    if (!/^(?:[\s:=()|｜▁<>.\d]|json|to|constrain|commentary|channel|message)*$/i.test(glue)) continue;
    const extracted = extractBalancedBraces(text, after);
    if (!extracted) continue;
    out += text.slice(last, m.index);
    out += `\n<tool name="${name}">\n${jsonArgsToParamXml(extracted.json)}\n</tool>\n`;
    let end = extracted.end;
    if (text[end] === ")") end++;
    last = end;
    nameRe.lastIndex = end;
  }
  return out + text.slice(last);
}

// Last-resort: a bare, un-fenced OpenAI-style JSON tool object on its own, e.g.
//   {"name":"list_directory","arguments":{"path":"."}}
// Only used when no <tool> block was produced by the other normalizers, so it
// never touches JSON that legitimately lives inside write_file content.
function rewriteBareJsonCalls(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const brace = text.indexOf("{", i);
    if (brace === -1) { out += text.slice(i); break; }
    const extracted = extractBalancedBraces(text, brace);
    if (!extracted) { out += text.slice(i, brace + 1); i = brace + 1; continue; }
    let handled = false;
    try {
      const obj = JSON.parse(extracted.json);
      const toolName = String(obj.name || obj.tool || obj.tool_name || obj.function || "").trim();
      const args = obj.arguments ?? obj.parameters ?? obj.params ?? obj.args ?? obj.input;
      if (toolName && KNOWN_TOOL_NAMES.has(toolName) && args !== undefined) {
        out += text.slice(i, brace) + `\n<tool name="${toolName}">\n${jsonArgsToParamXml(args)}\n</tool>\n`;
        i = extracted.end;
        handled = true;
      }
    } catch { /* not a tool-call object — leave as-is */ }
    if (!handled) { out += text.slice(i, brace + 1); i = brace + 1; }
  }
  return out;
}

// Rewrite native/alternate tool-call encodings into the canonical
// <tool name="X"><param .../></tool> format so a single parser handles everything.
export function normalizeToolCallFormats(rawText) {
  let text = String(rawText || "");

  // 1) DeepSeek/Qwen native:  function<｜tool▁sep｜>NAME <args…>  (args = <param> tags or ```json or {json})
  const nativeCall = /function\s*<\s*[｜|][^<>]*[｜|]\s*>\s*([A-Za-z0-9_]+)([\s\S]*?)(?=<\s*[｜|][^<>]*[｜|]\s*>|function\s*<\s*[｜|]|$)/g;
  text = text.replace(nativeCall, (_whole, name, body) => {
    const toolName = String(name || "").trim();
    if (!toolName) return "";
    const bodyText = String(body || "");

    if (/<param\s+name=/i.test(bodyText)) {
      const cleanBody = bodyText.replace(/<\/?tool\b[^>]*>/gi, "").trim();
      return `\n<tool name="${toolName}">\n${cleanBody}\n</tool>\n`;
    }

    let jsonStr = "";
    const fence = bodyText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) jsonStr = fence[1];
    else {
      const brace = bodyText.match(/\{[\s\S]*\}/);
      if (brace) jsonStr = brace[0];
    }
    const paramXml = jsonArgsToParamXml(jsonStr);
    return `\n<tool name="${toolName}">\n${paramXml}\n</tool>\n`;
  });

  // 2) OpenAI-style JSON tool call in a fenced block:
  //    {"name":"write_file","arguments":{...}}  or  {"tool":"...","parameters":{...}}
  const jsonToolFence = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/gi;
  text = text.replace(jsonToolFence, (whole, jsonStr) => {
    try {
      const obj = JSON.parse(jsonStr);
      const toolName = String(obj.name || obj.tool || obj.tool_name || "").trim();
      if (!toolName || !KNOWN_TOOL_NAMES.has(toolName)) return whole;
      const args = obj.arguments || obj.parameters || obj.params || obj.args || {};
      const paramXml = paramsObjectToXml(typeof args === "string" ? (() => { try { return JSON.parse(args); } catch { return {}; } })() : args);
      return `\n<tool name="${toolName}">\n${paramXml}\n</tool>\n`;
    } catch {
      return whole;
    }
  });

  // 3) Harmony / Kimi / OpenAI "functions.NAME" namespace calls leaked as plain text.
  text = rewriteNamespacedCalls(text);

  // 4) Bare, un-fenced JSON tool object (GPT-style fallback) — only when nothing
  //    above already produced a <tool> block, so file content is never touched.
  if (!/<tool\s+name=/i.test(text)) {
    text = rewriteBareJsonCalls(text);
  }

  return text;
}

function parseToolCall(xmlText) {
  const text = String(xmlText || "");
  const nameMatch = text.match(/<tool\s+name="([^"]+)">/i);
  if (!nameMatch) return null;

  const params = {};
  const paramRegex = /<param\s+name="([^"]+)">([\s\S]*?)<\/param>/gi;
  let match;
  while ((match = paramRegex.exec(text)) !== null) {
    params[match[1]] = String(match[2] || "").trim();
  }

  return {
    type: "tool_call",
    tool: String(nameMatch[1] || "").trim(),
    params,
    permission: null,
  };
}

export function parseAgentResponse(rawText) {
  const blocks = [];
  // Normalise any native/JSON tool-call encodings, then strip control/reasoning noise
  // so the parser only sees clean plans, tool calls, and prose.
  let remaining = stripAgentNoise(normalizeToolCallFormats(rawText)).trim();

  while (remaining.length > 0) {
    const planMatch = remaining.match(/^<plan>([\s\S]*?)<\/plan>/i);
    if (planMatch) {
      const steps = [];
      const stepRegex = /<step\s+status="([^"]+)">([\s\S]*?)<\/step>/gi;
      let stepMatch;
      while ((stepMatch = stepRegex.exec(planMatch[1])) !== null) {
        steps.push({ text: String(stepMatch[2] || "").trim(), status: String(stepMatch[1] || "pending").trim() });
      }
      blocks.push({ type: "plan", steps });
      remaining = remaining.slice(planMatch[0].length).trim();
      continue;
    }

    const permissionMatch = remaining.match(/^<permission\s+category="([^"]+)"\s+target="([^"]+)">([\s\S]*?)<\/permission>/i);
    if (permissionMatch) {
      const toolBlock = parseToolCall(permissionMatch[3]);
      if (toolBlock) {
        toolBlock.permission = {
          category: String(permissionMatch[1] || "").trim(),
          target: String(permissionMatch[2] || "").trim(),
        };
        blocks.push(toolBlock);
      }
      remaining = remaining.slice(permissionMatch[0].length).trim();
      continue;
    }

    const toolMatch = remaining.match(/^<tool\s+name="([^"]+)">([\s\S]*?)<\/tool>/i);
    if (toolMatch) {
      const toolBlock = parseToolCall(toolMatch[0]);
      if (toolBlock) blocks.push(toolBlock);
      remaining = remaining.slice(toolMatch[0].length).trim();
      continue;
    }

    const nextTagIndex = remaining.search(/<(plan|permission|tool)\b/i);
    if (nextTagIndex > 0) {
      const text = remaining.slice(0, nextTagIndex).trim();
      if (text) blocks.push({ type: "text", content: text });
      remaining = remaining.slice(nextTagIndex).trim();
      continue;
    }

    const text = remaining.trim();
    if (text) blocks.push({ type: "text", content: text });
    break;
  }

  return blocks;
}

export function getPermissionCategory(toolCall) {
  return TOOL_CATEGORY_MAP[String(toolCall?.tool || "").trim()] || "UNKNOWN";
}

export function needsPermission(toolCall, autoExecute, explicitCategory = "") {
  const category = String(explicitCategory || getPermissionCategory(toolCall) || "").toUpperCase();
  if (category === "READ") return false; // reads never mutate — always safe, never prompt
  if (autoExecute) return false;         // auto-approve ON: execute everything without asking
  return true;                           // ask mode: confirm every mutating action (CREATE/EDIT/TERMINAL/DELETE/unknown)
}

export class PermissionManager {
  constructor() {
    this.mode = "ask";
    this.allowedTargets = new Set();
    this.allowedCategories = new Set();
    this.deniedTargets = new Set();
  }

  setMode(mode) {
    this.mode = mode === "auto" ? "auto" : "ask";
  }

  check({ category, target }) {
    const resolvedCategory = String(category || "").trim().toUpperCase();
    const resolvedTarget = String(target || "").trim();

    if (resolvedCategory === "READ") return "allow";
    if (this.mode === "auto") return "allow";

    if (resolvedCategory && this.allowedCategories.has(resolvedCategory)) return "allow";
    if (resolvedTarget && this.allowedTargets.has(resolvedTarget)) return "allow";
    if (resolvedTarget && this.deniedTargets.has(resolvedTarget)) return "deny";

    return "ask";
  }

  allow(target, category = "") {
    const key = String(target || "").trim();
    if (!key) return;
    this.allowedTargets.add(key);
    this.deniedTargets.delete(key);

    const resolvedCategory = String(category || "").trim().toUpperCase();
    if (resolvedCategory && HIGH_RISK_PERMISSION_CATEGORIES.has(resolvedCategory)) {
      this.allowedCategories.add(resolvedCategory);
    }
  }

  deny(target) {
    const key = String(target || "").trim();
    if (!key) return;
    this.deniedTargets.add(key);
    this.allowedTargets.delete(key);
  }

  reset() {
    this.allowedTargets.clear();
    this.allowedCategories.clear();
    this.deniedTargets.clear();
  }
}

async function collectWorkspaceTreePreview({ workspacePath, electronAPI, maxDepth = 2, maxEntries = 120 }) {
  const root = String(workspacePath || "").trim();
  if (!root || !electronAPI?.readDir) return "(workspace unavailable)";

  const rows = [];
  const queue = [{ path: root, depth: 0, label: "." }];

  while (queue.length > 0 && rows.length < maxEntries) {
    const current = queue.shift();
    let entries = [];
    try {
      const result = await electronAPI.readDir(current.path);
      entries = Array.isArray(result) ? result : [];
    } catch {
      entries = [];
    }

    const sorted = [...entries].sort((a, b) => {
      if (a?.isDir && !b?.isDir) return -1;
      if (!a?.isDir && b?.isDir) return 1;
      return String(a?.name || "").localeCompare(String(b?.name || ""));
    });

    for (const entry of sorted) {
      if (rows.length >= maxEntries) break;
      const indent = "  ".repeat(current.depth);
      const suffix = entry?.isDir ? "/" : "";
      rows.push(`${indent}${entry?.name || "unknown"}${suffix}`);
      if (entry?.isDir && current.depth + 1 < maxDepth) {
        queue.push({
          path: String(entry.path || ""),
          depth: current.depth + 1,
          label: String(entry.name || ""),
        });
      }
    }
  }

  if (rows.length === 0) return "(workspace empty)";
  return rows.join("\n");
}

function fillPromptTemplate(template, vars) {
  let output = String(template || "");
  for (const [key, value] of Object.entries(vars || {})) {
    output = output.replaceAll(`{{${key}}}`, String(value ?? ""));
  }
  return output;
}

export async function buildAgentSystemPrompt({
  workspacePath,
  electronAPI,
  osName,
  shell,
  executionMode,
}) {
  const fileTree = await collectWorkspaceTreePreview({ workspacePath, electronAPI });

  const base = fillPromptTemplate(AGENT_SYSTEM_PROMPT_TEMPLATE, {
    OS_NAME: String(osName || "Unknown OS"),
    SHELL: String(shell || "Unknown shell"),
    WORKSPACE_PATH: String(workspacePath || "(none)"),
    FILE_TREE: fileTree,
  });

  if (executionMode === "direct") {
    return `${base}\n\nExecution preference: DIRECT mode. After planning, continue executing without waiting.`;
  }

  return `${base}\n\nExecution preference: PLAN_FIRST mode. Provide the plan clearly before running non-read actions.`;
}

function describeToolTarget(toolCall) {
  const tool = String(toolCall?.tool || "").trim();
  const params = toolCall?.params || {};
  return firstNonEmpty([
    params.path,
    params.command,
    params.query,
    params.message,
    tool,
  ]);
}

async function waitForCommandResult({ electronAPI, id, timeoutMs, onOutput }) {
  return new Promise((resolve) => {
    let settled = false;
    let output = "";

    const cleanup = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      offOutput?.();
      offDone?.();
      resolve(result);
    };

    const append = (text) => {
      output += String(text || "");
      if (output.length > MAX_TOOL_RESULT_CHARS) {
        output = output.slice(-MAX_TOOL_RESULT_CHARS);
      }
    };

    const offOutput = electronAPI?.onTerminalOutput
      ? electronAPI.onTerminalOutput((evt) => {
          if (Number(evt?.id) !== Number(id)) return;
          const stream = String(evt?.type || "stdout").toLowerCase();
          const data = String(evt?.data || "");
          append(data);
          onOutput?.({ stream, text: data });
        })
      : () => {};

    const offDone = electronAPI?.onTerminalDone
      ? electronAPI.onTerminalDone((evt) => {
          if (Number(evt?.id) !== Number(id)) return;
          const code = Number.isFinite(Number(evt?.code)) ? Number(evt.code) : -1;
          const error = String(evt?.error || "").trim();
          if (error) append(`\n${error}`);

          if (code === 0) {
            cleanup({ success: true, result: output || "(no output)" });
            return;
          }

          cleanup({
            success: false,
            error: truncateText(error || output || `Command failed with exit code ${code}`),
          });
        })
      : () => {};

    const timer = setTimeout(() => {
      if (electronAPI?.killCommand) {
        electronAPI.killCommand(id).catch(() => {});
      }
      cleanup({ success: false, error: `Command timed out after ${Math.round(timeoutMs / 1000)}s.` });
    }, timeoutMs);
  });
}

export class ToolExecutor {
  constructor({ workspacePath, electronAPI, platform = "win32", commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, onTerminalLine }) {
    this.workspacePath = String(workspacePath || "").trim();
    this.electronAPI = electronAPI;
    this.platform = String(platform || "").toLowerCase();
    this.commandTimeoutMs = commandTimeoutMs;
    this.onTerminalLine = onTerminalLine;
  }

  resolvePath(relativeOrAbsolute) {
    const incoming = String(relativeOrAbsolute || "").trim();
    if (!incoming) throw new Error("Path is required.");

    const normalizedWorkspace = normalizePath(this.workspacePath);
    if (!normalizedWorkspace) throw new Error("Workspace path is not configured.");

    const normalizedTarget = isAbsoluteLike(incoming)
      ? normalizePath(incoming)
      : joinNormalized(normalizedWorkspace, incoming);

    if (!isWithinBasePath(normalizedWorkspace, normalizedTarget)) {
      throw new Error(`Path traversal blocked: ${incoming}`);
    }

    return toNativePath(normalizedTarget, this.workspacePath);
  }

  toWorkspaceRelative(pathValue) {
    const workspace = normalizePath(this.workspacePath);
    const target = normalizePath(pathValue);
    if (!workspace || !target) return String(pathValue || "");
    if (!isWithinBasePath(workspace, target)) return String(pathValue || "");
    if (target === workspace) return ".";
    const prefix = workspace.endsWith("/") ? workspace : `${workspace}/`;
    return target.startsWith(prefix) ? target.slice(prefix.length) : String(pathValue || "");
  }

  async findCandidateFilesByName(fileName, maxMatches = 4) {
    const needle = String(fileName || "").trim().toLowerCase();
    if (!needle || !this.electronAPI?.readDir) return [];

    const queue = [this.workspacePath];
    const visited = new Set();
    const matches = [];

    while (queue.length > 0 && matches.length < maxMatches) {
      const currentDir = String(queue.shift() || "").trim();
      if (!currentDir) continue;

      const normalizedDir = normalizePath(currentDir);
      if (visited.has(normalizedDir)) continue;
      visited.add(normalizedDir);

      let entries = [];
      try {
        const result = await this.electronAPI.readDir(currentDir);
        entries = Array.isArray(result) ? result : [];
      } catch {
        entries = [];
      }

      for (const entry of entries) {
        const entryName = String(entry?.name || "").trim();
        const entryPath = String(entry?.path || "").trim();
        if (!entryName || !entryPath) continue;

        if (entry?.isDir) {
          queue.push(entryPath);
          continue;
        }

        if (entryName.toLowerCase() === needle) {
          matches.push(entryPath);
          if (matches.length >= maxMatches) break;
        }
      }
    }

    return matches;
  }

  async resolveFilePathForRead(pathValue) {
    const raw = String(pathValue || "").trim();
    const resolved = this.resolvePath(raw);

    const directRead = await this.electronAPI?.readFile?.(resolved);
    if (directRead && !directRead.error) {
      return resolved;
    }

    const simpleRelative = raw && !isAbsoluteLike(raw) && !/[\\/]/.test(raw);
    if (!simpleRelative) {
      return resolved;
    }

    const candidates = await this.findCandidateFilesByName(raw);
    if (candidates.length === 1) {
      return candidates[0];
    }

    if (candidates.length > 1) {
      const options = candidates.map((candidate) => this.toWorkspaceRelative(candidate)).join(", ");
      throw new Error(`Ambiguous path '${raw}'. Matches: ${options}. Use a relative path.`);
    }

    return resolved;
  }

  async resolveFilePathForWrite(pathValue) {
    const raw = String(pathValue || "").trim();
    const resolved = this.resolvePath(raw);

    const directRead = await this.electronAPI?.readFile?.(resolved);
    if (directRead && !directRead.error) {
      return resolved;
    }

    const simpleRelative = raw && !isAbsoluteLike(raw) && !/[\\/]/.test(raw);
    if (!simpleRelative) {
      return resolved;
    }

    const candidates = await this.findCandidateFilesByName(raw);
    if (candidates.length === 1) {
      return candidates[0];
    }

    if (candidates.length > 1) {
      const options = candidates.map((candidate) => this.toWorkspaceRelative(candidate)).join(", ");
      throw new Error(`Ambiguous write target '${raw}'. Matches: ${options}. Use a relative path.`);
    }

    return resolved;
  }

  async pathExists(relativeOrAbsolute) {
    const pathValue = this.resolvePath(relativeOrAbsolute);
    if (!this.electronAPI?.readFile) return false;
    const result = await this.electronAPI.readFile(pathValue);
    return !result?.error;
  }

  describeTarget(toolCall) {
    return describeToolTarget(toolCall);
  }

  async runCommand(command, cwd) {
    const text = String(command || "").trim();
    if (!text) return { success: false, error: "Command is empty." };
    if (!this.electronAPI?.executeCommand) return { success: false, error: "Terminal execution is unavailable." };

    this.onTerminalLine?.(`$ ${text}`);

    const start = await this.electronAPI.executeCommand(text, cwd || this.workspacePath);
    if (!start?.ok) {
      return { success: false, error: String(start?.error || "Failed to start command.") };
    }

    const result = await waitForCommandResult({
      electronAPI: this.electronAPI,
      id: start.id,
      timeoutMs: this.commandTimeoutMs,
      onOutput: ({ stream, text: chunk }) => {
        const lines = String(chunk || "").split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
          this.onTerminalLine?.(`${stream === "stderr" ? "!" : ">"} ${line}`);
        }
      },
    });

    if (result.success) {
      this.onTerminalLine?.("> command finished (exit 0)");
    } else {
      this.onTerminalLine?.(`! ${String(result.error || "Command failed")}`);
    }

    return result;
  }

  async execute(toolCall) {
    const tool = String(toolCall?.tool || "").trim();
    const params = toolCall?.params || {};

    try {
      switch (tool) {
        case "read_file": {
          const filePath = await this.resolveFilePathForRead(params.path);
          const result = await this.electronAPI?.readFile?.(filePath);
          if (!result || result.error) {
            return { success: false, error: String(result?.error || "Failed to read file.") };
          }
          return { success: true, result: truncateText(String(result.content || "")) };
        }

        case "write_file": {
          const filePath = await this.resolveFilePathForWrite(params.path);
          const content = normalizeEscapedMultiline(params.content);

          const previousRead = await this.electronAPI?.readFile?.(filePath);
          const existed = !!previousRead && !previousRead.error;
          const beforeContent = existed ? String(previousRead.content || "") : "";

          const result = await this.electronAPI?.writeFile?.(filePath, content);
          if (!result || result.success !== true) {
            return { success: false, error: String(result?.error || "Failed to write file.") };
          }

          const relativePath = this.toWorkspaceRelative(filePath);
          const stats = computeLineChangeStats(beforeContent, content);

          return {
            success: true,
            result: `File written: ${relativePath}`,
            meta: {
              tool: "write_file",
              path: relativePath,
              created: !existed,
              ...stats,
            },
          };
        }

        case "edit_file": {
          const filePath = await this.resolveFilePathForRead(params.path);
          const readResult = await this.electronAPI?.readFile?.(filePath);
          if (!readResult || readResult.error) {
            return { success: false, error: String(readResult?.error || "Failed to read file before editing.") };
          }

          const oldText = String(params.old_text || "");
          const newText = normalizeEscapedMultiline(params.new_text);
          const existing = String(readResult.content || "");

          if (!oldText) {
            return { success: false, error: "edit_file requires old_text." };
          }

          if (!existing.includes(oldText)) {
            return {
              success: false,
              error: `Could not find the specified text in ${params.path}. Read the file first to get exact content.`,
            };
          }

          const updated = existing.replace(oldText, newText);
          const writeResult = await this.electronAPI?.writeFile?.(filePath, updated);
          if (!writeResult || writeResult.success !== true) {
            return { success: false, error: String(writeResult?.error || "Failed to write edited file.") };
          }

          const relativePath = this.toWorkspaceRelative(filePath);
          const stats = computeLineChangeStats(existing, updated);

          return {
            success: true,
            result: `File edited: ${relativePath}`,
            meta: {
              tool: "edit_file",
              path: relativePath,
              created: false,
              ...stats,
            },
          };
        }

        case "list_directory": {
          const relative = String(params.path || ".").trim();
          const dirPath = relative === "." ? this.workspacePath : this.resolvePath(relative);
          const entries = await this.electronAPI?.readDir?.(dirPath);
          const safeEntries = Array.isArray(entries) ? entries : [];
          const result = safeEntries.map((entry) => ({
            name: entry?.name || "",
            type: entry?.isDir ? "folder" : "file",
          }));
          return { success: true, result: JSON.stringify(result, null, 2) };
        }

        case "search_files": {
          const query = String(params.query || "").trim();
          if (!query) return { success: false, error: "search_files requires query." };

          const relative = String(params.path || "").trim();
          const cwd = relative ? this.resolvePath(relative) : this.workspacePath;

          const useRegex = params.regex === true || String(params.regex || "").toLowerCase() === "true";
          const isWindows = this.platform.includes("win");
          const command = isWindows
            ? (useRegex
                ? `findstr /s /n /r /c:"${escapeWindowsFindstrQuery(query)}" *`
                : `findstr /s /n /i /c:"${escapeWindowsFindstrQuery(query)}" *`)
            : (useRegex
                ? `grep -RInE '${escapeBashSingleQuoted(query)}' .`
                : `grep -RIn '${escapeBashSingleQuoted(query)}' .`);

          const run = await this.runCommand(command, cwd);
          if (!run.success) {
            return { success: false, error: run.error || "search_files command failed." };
          }

          return { success: true, result: truncateText(String(run.result || "(no matches)")) };
        }

        case "run_command": {
          const command = String(params.command || "").trim();
          if (!command) return { success: false, error: "run_command requires command." };
          return await this.runCommand(command, this.workspacePath);
        }

        case "search_web": {
          const query = String(params.query || "").trim();
          if (!query) return { success: false, error: "search_web requires query." };

          if (!this.electronAPI?.searchWeb) {
            return { success: false, error: "Web search is unavailable in this environment." };
          }

          const result = await this.electronAPI.searchWeb(query);
          if (!result?.ok) {
            return { success: false, error: String(result?.error || "Web search failed.") };
          }

          const sources = Array.isArray(result.sources) ? result.sources : [];
          const lines = sources.slice(0, 6).map((source, index) => {
            const title = firstNonEmpty([source?.title, source?.domain, "Untitled"]);
            const url = String(source?.url || source?.finalUrl || "").trim();
            const excerpt = String(source?.excerpt || "").trim();
            return `[${index + 1}] ${title}${url ? `\n${url}` : ""}${excerpt ? `\n${excerpt}` : ""}`;
          });

          return {
            success: true,
            result: lines.length > 0 ? lines.join("\n\n") : "No web results found.",
          };
        }

        case "apply_patch": {
          const filePath = await this.resolveFilePathForRead(params.path);
          const readResult = await this.electronAPI?.readFile?.(filePath);
          if (!readResult || readResult.error) {
            return { success: false, error: String(readResult?.error || "Failed to read file before patching.") };
          }

          let edits = params.edits;
          if (typeof edits === "string") {
            try { edits = JSON.parse(edits); } catch {
              return { success: false, error: "apply_patch edits must be a JSON array of {old_text,new_text} objects." };
            }
          }
          if (!Array.isArray(edits) || edits.length === 0) {
            return { success: false, error: "apply_patch requires a non-empty edits array." };
          }

          const original = String(readResult.content || "");
          let updated = original;
          for (let i = 0; i < edits.length; i++) {
            const oldText = String(edits[i]?.old_text || "");
            const newText = normalizeEscapedMultiline(edits[i]?.new_text ?? "");
            if (!oldText) {
              return { success: false, error: `apply_patch edit #${i + 1} is missing old_text.` };
            }
            if (!updated.includes(oldText)) {
              return {
                success: false,
                error: `apply_patch edit #${i + 1}: old_text not found in ${params.path} — no changes were applied. Read the file to get exact current content.`,
              };
            }
            updated = updated.replace(oldText, newText);
          }

          const writeResult = await this.electronAPI?.writeFile?.(filePath, updated);
          if (!writeResult || writeResult.success !== true) {
            return { success: false, error: String(writeResult?.error || "Failed to write patched file.") };
          }

          const relativePath = this.toWorkspaceRelative(filePath);
          const stats = computeLineChangeStats(original, updated);
          return {
            success: true,
            result: `File patched: ${relativePath} (${edits.length} edit${edits.length === 1 ? "" : "s"})`,
            meta: { tool: "apply_patch", path: relativePath, created: false, ...stats },
          };
        }

        case "delete_file": {
          const filePath = await this.resolveFilePathForRead(params.path);
          const relativePath = this.toWorkspaceRelative(filePath);
          if (this.electronAPI?.deleteFile) {
            const result = await this.electronAPI.deleteFile(filePath);
            if (!result || (result.success !== true && result.ok !== true)) {
              return { success: false, error: String(result?.error || "Failed to delete file.") };
            }
          } else {
            const isWindows = this.platform.includes("win");
            const command = isWindows
              ? `del /f /q "${filePath}"`
              : `rm -f '${escapeBashSingleQuoted(filePath)}'`;
            const run = await this.runCommand(command, this.workspacePath);
            if (!run.success) {
              return { success: false, error: run.error || "Failed to delete file." };
            }
          }
          return {
            success: true,
            result: `File deleted: ${relativePath}`,
            meta: { tool: "delete_file", path: relativePath, deleted: true },
          };
        }

        case "git_status": {
          const run = await this.runCommand("git status --porcelain=v1 -b", this.workspacePath);
          if (!run.success) {
            return { success: false, error: run.error || "git status failed (is this a git repository?)." };
          }
          return { success: true, result: truncateText(String(run.result || "(clean)")) };
        }

        case "git_diff": {
          const staged = params.staged === true || String(params.staged || "").toLowerCase() === "true";
          const target = String(params.path || "").trim();
          const command = `git diff${staged ? " --staged" : ""}${target ? ` -- "${target}"` : ""}`;
          const run = await this.runCommand(command, this.workspacePath);
          if (!run.success) {
            return { success: false, error: run.error || "git diff failed." };
          }
          return { success: true, result: truncateText(String(run.result || "(no changes)")) };
        }

        case "git_commit": {
          const message = String(params.message || "").trim().replace(/"/g, "'");
          if (!message) return { success: false, error: "git_commit requires message." };

          const add = await this.runCommand("git add -A", this.workspacePath);
          if (!add.success) {
            return { success: false, error: add.error || "git add failed." };
          }

          const commit = await this.runCommand(`git commit -m "${message}"`, this.workspacePath);
          if (!commit.success) {
            return { success: false, error: commit.error || "git commit failed (nothing to commit?)." };
          }
          return { success: true, result: truncateText(String(commit.result || "Commit created.")) };
        }

        case "run_tests": {
          let command = String(params.command || "").trim();
          if (!command) {
            const pkgRead = await this.electronAPI?.readFile?.(this.resolvePath("package.json"));
            if (pkgRead && !pkgRead.error) {
              try {
                const pkg = JSON.parse(String(pkgRead.content || "{}"));
                if (pkg?.scripts?.test) command = "npm test";
              } catch {}
            }
          }
          if (!command) {
            return {
              success: false,
              error: "No test command found — package.json has no test script. Pass command explicitly.",
            };
          }

          const run = await this.runCommand(command, this.workspacePath);
          const output = String((run.success ? run.result : run.error) || "");
          const summaryLines = output
            .split("\n")
            .filter((line) => /\b(pass(ed|ing)?|fail(ed|ing)?|tests?:|suites?:|snapshots?:|assertions?)\b|✓|✗/i.test(line))
            .slice(-12);
          const summary = summaryLines.join("\n").trim();

          if (!run.success) {
            return { success: false, error: truncateText(`Tests FAILED.\n${summary || output}`) };
          }
          return { success: true, result: truncateText(`Tests passed.\n${summary || output || "(no output)"}`) };
        }

        default:
          return { success: false, error: `Unknown tool: ${tool}` };
      }
    } catch (err) {
      return { success: false, error: String(err?.message || err || "Tool execution failed.") };
    }
  }
}

export class AgentLoop {
  constructor({
    model,
    providerKeys,
    workspacePath,
    electronAPI,
    osName,
    shell,
    executionMode = "plan_first",
    autoExecute = false,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
    useNativeTools = true,
    selfVerify = true,
    requestPermission,
    onStatus,
    onPlan,
    onStep,
    onText,
    onToolExecution,
    onTerminalLine,
    onUsage,
    onCheckpoint,
    signal,
  }) {
    this.model = model;
    this.providerKeys = providerKeys || {};
    this.workspacePath = String(workspacePath || "").trim();
    this.electronAPI = electronAPI;
    this.osName = osName || "Windows";
    this.shell = shell || "PowerShell";
    this.executionMode = executionMode === "direct" ? "direct" : "plan_first";
    this.autoExecute = !!autoExecute;
    this.maxIterations = Math.max(1, Number(maxIterations) || DEFAULT_MAX_ITERATIONS);
    this.useNativeTools = useNativeTools !== false;
    this.selfVerify = selfVerify !== false;
    this.requestPermission = requestPermission;
    this.onStatus = onStatus;
    this.onPlan = onPlan;
    this.onStep = onStep;
    this.onText = onText;
    this.onToolExecution = onToolExecution;
    this.onTerminalLine = onTerminalLine;
    this.onUsage = onUsage;
    this.onCheckpoint = onCheckpoint;
    this.signal = signal;

    // Per-run recovery state: consecutive failure counts per tool+target, and
    // the git checkpoint hash captured before the first mutation of a run.
    this._failCounts = new Map();
    this._checkpointDone = false;
    this.checkpoint = null;

    this.permissions = new PermissionManager();
    this.permissions.setMode(this.autoExecute ? "auto" : "ask");

    this.toolExecutor = new ToolExecutor({
      workspacePath: this.workspacePath,
      electronAPI: this.electronAPI,
      platform: this.osName,
      commandTimeoutMs,
      onTerminalLine: (line) => this.onTerminalLine?.(line),
    });
  }

  assertNotAborted() {
    if (this.signal?.aborted) {
      throw new Error("Agent run cancelled.");
    }
  }

  // Capture a git snapshot of the working tree (tracked + untracked via a
  // temporary stage) BEFORE the first mutating tool runs, so a bad run can be
  // rolled back with `git checkout <hash> -- .`. Returns the commit hash, or
  // null when the workspace is not a git repo / git is unavailable.
  async createCheckpoint() {
    try {
      const add = await this.toolExecutor.runCommand("git add -A", this.workspacePath);
      if (!add?.success) return null;

      const stash = await this.toolExecutor.runCommand('git stash create "agent checkpoint"', this.workspacePath);
      await this.toolExecutor.runCommand("git reset", this.workspacePath);

      const hash = String(stash?.result || "").trim().split(/\s+/)[0] || "";
      if (/^[0-9a-f]{7,40}$/i.test(hash)) return hash;

      // Clean tree — nothing to stash, HEAD itself is the checkpoint.
      const head = await this.toolExecutor.runCommand("git rev-parse HEAD", this.workspacePath);
      const headHash = String(head?.result || "").trim().split(/\s+/)[0] || "";
      return /^[0-9a-f]{7,40}$/i.test(headHash) ? headHash : null;
    } catch {
      return null;
    }
  }

  async requestPermissionIfNeeded({ toolCall, category, target, stepLabel }) {
    const decision = this.permissions.check({ category, target });
    if (decision === "allow") return { allowed: true, overrides: null };
    if (decision === "deny") return { allowed: false, overrides: null };

    if (!this.requestPermission) {
      return { allowed: false, overrides: null };
    }

    this.onStatus?.(`Awaiting permission: ${category} on ${target || toolCall.tool}`);

    const result = await this.requestPermission({
      toolCall,
      category,
      target,
      stepLabel,
    });

    const allowed = !!result?.allowed;
    if (allowed) {
      this.permissions.allow(target, category);
    } else {
      this.permissions.deny(target);
    }

    return {
      allowed,
      overrides: result?.overrides && typeof result.overrides === "object" ? result.overrides : null,
    };
  }

  async run({ userMessage, contextMessages = [] }) {
    const prompt = String(userMessage || "").trim();
    if (!prompt) {
      return { success: false, error: "Agent prompt is empty." };
    }

    if (!this.model?.id) {
      return { success: false, error: "No Agent model selected." };
    }

    if (!this.workspacePath) {
      return { success: false, error: "No workspace selected for Agent mode." };
    }

    const basePrompt = await buildAgentSystemPrompt({
      workspacePath: this.workspacePath,
      electronAPI: this.electronAPI,
      osName: this.osName,
      shell: this.shell,
      executionMode: this.executionMode,
    });

    // Native function calling: OpenAI-compatible providers accept a `tools`
    // array and stream structured tool_calls back — far more reliable than
    // parsing XML out of prose. Other providers keep the XML text protocol.
    const provider = String(this.model?._provider || "openrouter");
    const nativeToolsActive =
      this.useNativeTools && ["openrouter", "openai", "nvidia"].includes(provider);

    const systemPrompt = nativeToolsActive
      ? `${basePrompt}\n\n## Native Tool Calling Active\nThis session uses the platform's native function-calling interface. Do NOT write XML <tool> blocks — issue real function calls through the API instead. The XML examples above document each tool's purpose and parameters only. You may issue several READ tool calls (read_file, list_directory, search_files, search_web, git_status, git_diff) in one turn; they execute in parallel.`
      : basePrompt;

    const conversation = normalizeMessagesForAgent(contextMessages);
    conversation.push({ role: "user", content: prompt });

    let iterations = 0;
    let sawPlan = false;
    let codeNudges = 0;
    let mutationCount = 0;
    let verifyPassDone = false;
    const maxCodeNudges = 2;

    while (iterations < this.maxIterations) {
      this.assertNotAborted();
      iterations += 1;

      this.onStatus?.(`Agent iteration ${iterations}/${this.maxIterations}`);

      // Keep long sessions inside the context window before each model turn.
      compactConversation(conversation);

      const response = await routeStream(
        this.providerKeys,
        this.model,
        [{ role: "system", content: systemPrompt }, ...conversation],
        {
          signal: this.signal,
          maxTokens: 8192,
          temperature: 0.2,
          topP: 0.9,
          tools: nativeToolsActive ? AGENT_TOOL_DEFINITIONS.tools : undefined,
        }
      );

      const nativeCalls = Array.isArray(response?.tool_calls) ? response.tool_calls : [];
      const rawText = String(response?.text || "").trim();

      // Report token usage for this turn so the UI can show a running cost.
      // Providers that omit `usage` fall back to a length-based estimate.
      const turnUsage = response?.usage && (response.usage.prompt_tokens || response.usage.completion_tokens)
        ? response.usage
        : estimateUsageFromMessages(
            [{ role: "system", content: systemPrompt }, ...conversation],
            rawText
          );
      this.onUsage?.(turnUsage);

      if (!rawText && nativeCalls.length === 0) {
        return { success: false, error: "Model returned an empty response." };
      }

      // Clean version for display + context: no protocol tokens, no hidden reasoning.
      const cleanText = stripAgentNoise(normalizeToolCallFormats(rawText)).trim();

      if (nativeCalls.length > 0) {
        // Echo the structured tool_calls back so the provider accepts the
        // following role:"tool" result messages.
        conversation.push({
          role: "assistant",
          content: cleanText || rawText || "",
          tool_calls: nativeCalls,
        });
      } else {
        conversation.push({ role: "assistant", content: cleanText || rawText });
      }

      const blocks = parseAgentResponse(rawText);
      let parsedBlocks = blocks.length > 0
        ? blocks
        : (cleanText ? [{ type: "text", content: cleanText }] : []);

      if (nativeCalls.length > 0) {
        const nativeBlocks = nativeCalls.map((call, index) => {
          let params = {};
          let parseError = null;
          const rawArgs = String(call?.function?.arguments || "").trim();
          if (rawArgs) {
            try {
              const parsed = JSON.parse(rawArgs);
              if (parsed && typeof parsed === "object") params = parsed;
            } catch (err) {
              parseError = String(err?.message || err);
            }
          }
          return {
            type: "tool_call",
            tool: String(call?.function?.name || "").trim(),
            params,
            permission: null,
            nativeId: call?.id || `call_${iterations}_${index}`,
            parseError,
          };
        });
        // Keep text-derived narration/plan blocks, but native calls are the
        // source of truth for tools — drop any XML duplicates.
        parsedBlocks = [
          ...parsedBlocks.filter((b) => b.type !== "tool_call"),
          ...nativeBlocks,
        ];
      }

      // Every native call id must get a matching role:"tool" reply, otherwise
      // the provider rejects the next turn.
      const pushToolResult = (block, text) => {
        if (block?.nativeId) {
          conversation.push({ role: "tool", tool_call_id: block.nativeId, content: text });
        } else {
          conversation.push({ role: "user", content: text });
        }
      };

      // A batch of read-only calls (common in native mode) runs concurrently.
      const toolBlocks = parsedBlocks.filter((b) => b.type === "tool_call");
      const parallelResults = new Map();
      if (
        toolBlocks.length > 1 &&
        toolBlocks.every((b) => !b.parseError && getPermissionCategory(b) === "READ")
      ) {
        this.onStatus?.(`Running ${toolBlocks.length} read-only tools in parallel`);
        const settled = await Promise.all(
          toolBlocks.map((b) =>
            this.toolExecutor.execute(b).catch((err) => ({
              success: false,
              error: String(err?.message || err || "Tool execution failed."),
            }))
          )
        );
        toolBlocks.forEach((b, i) => parallelResults.set(b, settled[i]));
      }

      let hasToolCalls = false;
      let finalTextParts = [];

      for (const block of parsedBlocks) {
        this.assertNotAborted();

        if (block.type === "plan") {
          const steps = clampArray(block.steps || [], 10).map((step, index) => {
            const text = firstNonEmpty([step?.text, `Step ${index + 1}`]);
            const status = firstNonEmpty([step?.status, "pending"]).toLowerCase();
            return { text, status };
          });

          if (steps.length > 0) {
            sawPlan = true;
            this.onPlan?.(steps);

            // Plan-first: stop the run here and hand the plan back for review.
            // The user reviews (and can edit) the plan, then explicitly approves;
            // execution runs as a separate direct-mode pass. This replaces the
            // old "gate at first write" so the approval always happens up front,
            // with the plan clearly presented — never mid-execution.
            if (this.executionMode === "plan_first") {
              return {
                success: true,
                finalText: firstNonEmpty([
                  finalTextParts.join("\n\n").trim(),
                  "Plan ready for review.",
                ]),
                iterations,
                hadPlan: true,
                awaitingApproval: true,
                planSteps: steps,
              };
            }
          }
          continue;
        }

        if (block.type === "text") {
          const text = stripProtocolTags(block.content || "");
          if (text) {
            finalTextParts.push(text);
            this.onText?.(text);
          }
          continue;
        }

        if (block.type !== "tool_call") continue;

        hasToolCalls = true;

        // Native call arrived with malformed JSON arguments — bounce it back
        // instead of executing garbage.
        if (block.parseError) {
          pushToolResult(
            block,
            `[Tool result for ${block.tool || "unknown"}]: Error.\nInvalid JSON arguments: ${block.parseError}. Re-issue the call with valid JSON.`
          );
          continue;
        }

        const stepLabel = `${block.tool}(${describeToolTarget(block) || ""})`;
        this.onStep?.({ step: "Executing tool", details: stepLabel });

        const category = firstNonEmpty([
          block.permission?.category,
          getPermissionCategory(block),
          "UNKNOWN",
        ]).toUpperCase();
        const target = firstNonEmpty([
          block.permission?.target,
          describeToolTarget(block),
          block.tool,
        ]);

        // Plan-first safety net: never mutate on the first pass. If the model
        // jumped straight to a non-READ tool call without emitting a plan block,
        // hand the run back for review anyway (with whatever narration we have)
        // instead of executing or popping a mid-run "plan execution" gate. The
        // approved plan is executed later as a separate direct-mode pass.
        if (this.executionMode === "plan_first" && category !== "READ") {
          return {
            success: true,
            finalText: firstNonEmpty([
              finalTextParts.join("\n\n").trim(),
              "Plan ready for review.",
            ]),
            iterations,
            hadPlan: sawPlan,
            awaitingApproval: true,
            planSteps: [],
          };
        }

        // Auto-approve gates every mutating action regardless of plan_first/direct.
        // The plan approval only greenlights *starting* the run; the toggle governs
        // whether each individual write/edit/command still needs a yes.
        const shouldAsk = needsPermission(block, this.autoExecute, category);
        let effectiveCall = block;

        if (shouldAsk) {
          const permissionResult = await this.requestPermissionIfNeeded({
            toolCall: block,
            category,
            target,
            stepLabel,
          });

          if (!permissionResult.allowed) {
            const denyResult = `Action denied by user: ${block.tool} on ${target}`;
            pushToolResult(block, `[Tool result for ${block.tool}]: ${denyResult}`);
            this.onToolExecution?.({
              tool: block.tool,
              category,
              target,
              status: "denied",
              text: denyResult,
            });
            continue;
          }

          if (permissionResult.overrides) {
            effectiveCall = {
              ...block,
              params: {
                ...(block.params || {}),
                ...permissionResult.overrides,
              },
            };
          }
        }

        this.onToolExecution?.({
          tool: effectiveCall.tool,
          category,
          target,
          status: "running",
          text: `Executing ${effectiveCall.tool}`,
        });

        // First mutation of the run: snapshot the workspace for rollback.
        if (!this._checkpointDone && category !== "READ") {
          this._checkpointDone = true;
          this.onStatus?.("Creating git checkpoint before first change…");
          this.checkpoint = await this.createCheckpoint();
          if (this.checkpoint) this.onCheckpoint?.(this.checkpoint);
        }

        const result = parallelResults.has(block)
          ? parallelResults.get(block)
          : await this.toolExecutor.execute(effectiveCall);

        if (result.success && category !== "READ") mutationCount += 1;

        // Error-recovery memory: repeating an identical failing call is the
        // most common weak-model loop — force a strategy change instead.
        const failKey = `${effectiveCall.tool}:${target}`;
        let recoveryHint = "";
        if (!result.success) {
          const failures = (this._failCounts.get(failKey) || 0) + 1;
          this._failCounts.set(failKey, failures);
          if (failures >= 2) {
            recoveryHint = `\n[Recovery hint]: this exact call has failed ${failures} times. Do NOT repeat it verbatim — change approach: re-read the file for exact text, try a different tool (apply_patch/write_file), or adjust the command.`;
          }
        } else {
          this._failCounts.delete(failKey);
        }

        const resultText = result.success
          ? `[Tool result for ${effectiveCall.tool}]: Success.\n${truncateText(result.result || "")}`
          : `[Tool result for ${effectiveCall.tool}]: Error.\n${truncateText(result.error || "")}${recoveryHint}`;

        pushToolResult(block, resultText);

        this.onToolExecution?.({
          tool: effectiveCall.tool,
          category,
          target,
          status: result.success ? "success" : "error",
          text: result.success ? "Tool completed" : "Tool failed",
          meta: result?.meta || null,
        });
      }

      if (!hasToolCalls) {
        // Safety net for weaker models: if the reply pasted a fenced code block
        // but never called write_file/edit_file, nothing was saved to disk. Don't
        // end the run — nudge it (up to maxCodeNudges) to re-issue the code as a
        // real tool call. Only in an executing pass (plan_first review text is
        // allowed to be prose without tools).
        if (
          this.executionMode !== "plan_first" &&
          codeNudges < maxCodeNudges &&
          rawText.includes("```")
        ) {
          codeNudges += 1;
          this.onStatus?.("Model pasted code without a write_file call — asking it to use the tool.");
          conversation.push({
            role: "user",
            content:
              "You pasted code in your reply but did NOT call a tool, so NOTHING was written to disk. " +
              "Code typed in a message is discarded. Re-issue that code now as a single write_file tool " +
              'call, with the FULL file content inside <param name="content">. Do not paste code again. ' +
              "If the file was already written by an earlier tool call, reply DONE with a one-line summary (no code).",
          });
          continue;
        }

        const finalText = firstNonEmpty([
          finalTextParts.join("\n\n").trim(),
          cleanText,
          rawText,
        ]);

        // Self-verify: when an executing pass made changes, force one review
        // turn before accepting the model's "done".
        if (
          this.selfVerify &&
          !verifyPassDone &&
          mutationCount > 0 &&
          iterations < this.maxIterations
        ) {
          verifyPassDone = true;
          this.onStatus?.("Verification pass: reviewing changes before finishing.");
          conversation.push({
            role: "user",
            content:
              "Verification pass before finishing: re-read the file(s) you changed and confirm the edits are correct and complete. If a fast check exists (build/test/lint), run it. If everything is correct, reply with your final summary; otherwise fix the problems now.",
          });
          continue;
        }

        return {
          success: true,
          finalText,
          iterations,
          hadPlan: sawPlan,
          checkpoint: this.checkpoint,
        };
      }
    }

    return {
      success: false,
      error: "Reached maximum iteration limit. Stopping to prevent infinite loops.",
      iterations: this.maxIterations,
    };
  }
}
