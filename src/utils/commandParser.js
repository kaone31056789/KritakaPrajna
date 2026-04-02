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
    arg: "<file>",
  }));
}
