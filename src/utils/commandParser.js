// ── Slash Command Parser ────────────────────────────────────────────────────

const CUSTOM_COMMANDS_KEY = "openrouter_custom_commands";

/** Built-in commands (always available). */
const BUILTIN_COMMANDS = {
  explain: {
    prefix: "/explain",
    description: "Explain a file in detail",
    promptTemplate:
      "Explain the following file in detail. Break down its purpose, key logic, and how different parts work together.\n\n📎 FILE: {{fileName}}\n```\n{{code}}\n```",
    builtin: true,
  },
  fix: {
    prefix: "/fix",
    description: "Find & fix bugs",
    promptTemplate:
      "Review the following file for bugs, issues, and improvements. Identify problems, explain what's wrong, and provide the corrected code.\n\n📎 FILE: {{fileName}}\n```\n{{code}}\n```",
    builtin: true,
  },
  summarize: {
    prefix: "/summarize",
    description: "Summarize a file",
    promptTemplate:
      "Provide a concise summary of this file: what it does, its exports/API, dependencies, and key implementation details.\n\n📎 FILE: {{fileName}}\n```\n{{code}}\n```",
    builtin: true,
  },

  // ── Feature test commands (noFile: true — no file argument required) ────────
  "test-terminal": {
    prefix: "/test-terminal",
    description: "Test the terminal execution feature",
    noFile: true,
    promptTemplate:
      "TERMINAL FEATURE TEST.\n\nYour ONLY job is to output this exact fenced code block — nothing else before it:\n\n```bash\nnode --version && npm --version\n```\n\nAfter the code block, in one sentence explain what it checks.",
    builtin: true,
  },
  "test-web": {
    prefix: "/test-web",
    description: "Test the web browsing feature",
    noFile: true,
    promptTemplate:
      "WEB BROWSING FEATURE TEST.\n\nThe system has fetched this URL for you: https://api.github.com/zen\n\nLook at the 🌐 WEB CONTEXT block above. Quote the exact text returned by that API, then in one sentence explain what the GitHub Zen API is.",
    builtin: true,
  },
  "test-features": {
    prefix: "/test-features",
    description: "Test both terminal and web browsing features together",
    noFile: true,
    promptTemplate:
      "FEATURES TEST — respond in exactly two parts:\n\n**Part 1 — Web:** The system fetched https://api.github.com/zen for you. Check the 🌐 WEB CONTEXT block above and quote what it says.\n\n**Part 2 — Terminal:** Output this exact fenced block:\n\n```bash\necho \"Both features work!\" && node --version\n```\n\nDo not skip either part.",
    builtin: true,
  },
};

// ── Custom commands persistence ─────────────────────────────────────────────

export function loadCustomCommands() {
  try {
    const raw = localStorage.getItem(CUSTOM_COMMANDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveCustomCommands(commands) {
  localStorage.setItem(CUSTOM_COMMANDS_KEY, JSON.stringify(commands));
}

/**
 * Merge built-in + custom into a single lookup map.
 * Custom commands use the shape { name, prefix, description, promptTemplate }.
 */
function allCommands(customList = []) {
  const map = { ...BUILTIN_COMMANDS };
  for (const c of customList) {
    if (c.name && c.promptTemplate) {
      map[c.name] = {
        prefix: "/" + c.name.toLowerCase().replace(/\s+/g, "-"),
        description: c.description || "",
        promptTemplate: c.promptTemplate,
        builtin: false,
      };
    }
  }
  return map;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Parse a slash command from user input.
 * @param {string} text - Raw input text
 * @param {Array} customCommands - User-defined custom commands
 * @returns {{ command: string, filePath: string, rest: string } | null}
 */
export function parseCommand(text, customCommands = []) {
  const trimmed = text.trim();
  const cmds = allCommands(customCommands);
  for (const [name, cmd] of Object.entries(cmds)) {
    if (trimmed.toLowerCase().startsWith(cmd.prefix)) {
      // noFile commands: no file argument needed — the rest is optional extra context
      if (cmd.noFile) {
        const extra = trimmed.slice(cmd.prefix.length).trim();
        return { command: name, filePath: null, rest: extra, noFile: true };
      }
      const after = trimmed.slice(cmd.prefix.length).trim();
      const spaceIdx = after.indexOf(" ");
      const filePath = spaceIdx > 0 ? after.slice(0, spaceIdx).trim() : after;
      const rest = spaceIdx > 0 ? after.slice(spaceIdx).trim() : "";
      if (filePath) {
        return { command: name, filePath, rest };
      }
    }
  }
  return null;
}

/**
 * Build the prompt text for a parsed command using template interpolation.
 * Supported placeholders: {{fileName}}, {{code}}
 */
export function buildCommandPrompt(command, fileName, code, extra = "", customCommands = []) {
  const cmds = allCommands(customCommands);
  const cmd = cmds[command];
  if (!cmd) return code;

  // noFile commands: promptTemplate is used as-is, no file substitution
  if (cmd.noFile) {
    let prompt = cmd.promptTemplate;
    if (extra) prompt += `\n\nAdditional context: ${extra}`;
    return prompt;
  }

  let prompt = cmd.promptTemplate
    .replace(/\{\{fileName\}\}/g, fileName)
    .replace(/\{\{code\}\}/g, code);

  if (extra) {
    prompt += `\n\nAdditional context: ${extra}`;
  }
  return prompt;
}

/**
 * Try to resolve a file path from attached files.
 */
export function resolveFromAttachments(filePath, attachedFiles = [], uploads = []) {
  const lower = filePath.toLowerCase();

  for (const f of attachedFiles) {
    const fName = f.name.toLowerCase();
    const fPath = (f.path || "").toLowerCase().replace(/\\/g, "/");
    if (fName === lower || fPath.endsWith(lower)) {
      return { name: f.name, content: f.content };
    }
  }

  for (const u of uploads) {
    if (u.type !== "image" && u.content) {
      if (u.name.toLowerCase() === lower) {
        return { name: u.name, content: u.content };
      }
    }
  }

  return null;
}

/**
 * Get all commands (built-in + custom) for display in the hint popover.
 * Returns [{ cmd: "/name", desc: "...", arg: "<file>" }].
 */
export function getAllCommandHints(customCommands = []) {
  const cmds = allCommands(customCommands);
  return Object.entries(cmds).map(([, c]) => ({
    cmd: c.prefix,
    desc: c.description || "",
    arg: c.noFile ? "" : "<file>",
  }));
}
