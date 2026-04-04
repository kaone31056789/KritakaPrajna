export const REASONING_MODES = [
  { id: "fast", label: "Fast" },
  { id: "balanced", label: "Balanced" },
  { id: "deep", label: "Deep" },
];

export function supportsReasoningModel(model) {
  const id = `${model?.id || ""} ${model?.name || ""}`.toLowerCase();
  const provider = model?._provider || "";

  if (/(reason|reasoning|think|thinking|r1\b|o1\b|o3\b|o4\b|gpt-5\b|deepseek-r1|kimi-k2-thinking)/.test(id)) {
    return true;
  }

  if (provider === "anthropic" && /(claude-sonnet-4|claude-opus-4|claude-3-7)/.test(id)) {
    return true;
  }

  if (provider === "openrouter" && /(qwen3|glm-4\.6|gemini.*thinking)/.test(id)) {
    return true;
  }

  return false;
}

export function mapReasoningEffort(mode = "balanced") {
  switch (mode) {
    case "fast": return "low";
    case "deep": return "high";
    default: return "medium";
  }
}

export function mapAnthropicThinking(mode = "balanced") {
  switch (mode) {
    case "fast": return 1024;
    case "deep": return 12000;
    default: return 4096;
  }
}
