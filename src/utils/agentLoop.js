import { routeStream } from "../api/providerRouter";

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
After all steps complete, give a concise summary:
- What was changed
- What was created
- Any follow-up needed
- Include exact file paths created/edited
- Include key code snippets in fenced code blocks

## Available Tools

You have these tools. Use them by outputting the exact XML format shown:

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

## Permission Categories

Each tool call falls into a permission category. In "Ask" mode, approvals are only for major/high-risk actions. In "Auto" mode, all actions execute immediately.

| Category | Tools | Risk |
|----------|-------|------|
| READ | read_file, list_directory, search_files, search_web | Safe - no changes |
| CREATE | write_file (new files) | Medium - adds files |
| EDIT | edit_file, write_file (existing) | Medium - modifies files |
| TERMINAL | run_command | High - runs commands |
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

- Be concise. No filler phrases.
- Lead with action, not preamble.
- Use code blocks with language tags.
- Between tool calls, give one-line status updates.
`;

const DEFAULT_MAX_ITERATIONS = 20;
const DEFAULT_COMMAND_TIMEOUT_MS = 30000;
const MAX_TOOL_RESULT_CHARS = 24000;

const READ_TOOLS = new Set(["read_file", "list_directory", "search_files", "search_web"]);
const HIGH_RISK_PERMISSION_CATEGORIES = new Set(["TERMINAL", "DELETE"]);

const TOOL_CATEGORY_MAP = {
  read_file: "READ",
  list_directory: "READ",
  search_files: "READ",
  search_web: "READ",
  write_file: "CREATE",
  edit_file: "EDIT",
  run_command: "TERMINAL",
  delete_file: "DELETE",
};

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
  let remaining = String(rawText || "").trim();

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
  const category = explicitCategory || getPermissionCategory(toolCall);
  if (category === "READ") return false;
  if (autoExecute) return false;
  return HIGH_RISK_PERMISSION_CATEGORIES.has(String(category || "").toUpperCase());
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

          const isWindows = this.platform.includes("win");
          const command = isWindows
            ? `findstr /s /n /i /c:"${escapeWindowsFindstrQuery(query)}" *`
            : `grep -RIn '${escapeBashSingleQuoted(query)}' .`;

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
    requestPermission,
    onStatus,
    onPlan,
    onStep,
    onText,
    onToolExecution,
    onTerminalLine,
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
    this.requestPermission = requestPermission;
    this.onStatus = onStatus;
    this.onPlan = onPlan;
    this.onStep = onStep;
    this.onText = onText;
    this.onToolExecution = onToolExecution;
    this.onTerminalLine = onTerminalLine;
    this.signal = signal;

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

    const systemPrompt = await buildAgentSystemPrompt({
      workspacePath: this.workspacePath,
      electronAPI: this.electronAPI,
      osName: this.osName,
      shell: this.shell,
      executionMode: this.executionMode,
    });

    const conversation = normalizeMessagesForAgent(contextMessages);
    conversation.push({ role: "user", content: prompt });

    let iterations = 0;
    let sawPlan = false;
    let planApproved = this.executionMode === "direct";

    while (iterations < this.maxIterations) {
      this.assertNotAborted();
      iterations += 1;

      this.onStatus?.(`Agent iteration ${iterations}/${this.maxIterations}`);

      const response = await routeStream(
        this.providerKeys,
        this.model,
        [{ role: "system", content: systemPrompt }, ...conversation],
        {
          signal: this.signal,
          maxTokens: 1800,
          temperature: 0.2,
          topP: 0.9,
        }
      );

      const rawText = String(response?.text || "").trim();
      if (!rawText) {
        return { success: false, error: "Model returned an empty response." };
      }

      conversation.push({ role: "assistant", content: rawText });

      const blocks = parseAgentResponse(rawText);
      const parsedBlocks = blocks.length > 0 ? blocks : [{ type: "text", content: rawText }];

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
          }
          continue;
        }

        if (block.type === "text") {
          const text = String(block.content || "").trim();
          if (text) {
            finalTextParts.push(text);
            this.onText?.(text);
          }
          continue;
        }

        if (block.type !== "tool_call") continue;

        hasToolCalls = true;
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

        if (!planApproved && this.executionMode === "plan_first" && category !== "READ") {
          const gate = await this.requestPermissionIfNeeded({
            toolCall: { tool: "plan_execution", params: { target: "Execute generated plan" } },
            category: "PLAN",
            target: "Execute generated plan",
            stepLabel: "Approve plan execution",
          });

          if (!gate.allowed) {
            return {
              success: true,
              finalText: "Plan generated. Execution is waiting for approval.",
              iterations,
            };
          }

          planApproved = true;
        }

        const shouldAsk = this.executionMode === "plan_first"
          ? false
          : needsPermission(block, this.autoExecute, category);
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
            conversation.push({
              role: "user",
              content: `[Tool result for ${block.tool}]: ${denyResult}`,
            });
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

        const result = await this.toolExecutor.execute(effectiveCall);

        const resultText = result.success
          ? `[Tool result for ${effectiveCall.tool}]: Success.\n${truncateText(result.result || "")}`
          : `[Tool result for ${effectiveCall.tool}]: Error.\n${truncateText(result.error || "")}`;

        conversation.push({ role: "user", content: resultText });

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
        const finalText = firstNonEmpty([
          finalTextParts.join("\n\n").trim(),
          rawText,
        ]);

        return {
          success: true,
          finalText,
          iterations,
          hadPlan: sawPlan,
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
