export const OPENCODE_EVENT_TYPES = {
  PLAN: "plan",
  STEP_START: "step_start",
  STEP_UPDATE: "step_update",
  TERMINAL: "terminal",
  RESULT: "result",
  ERROR: "error",
};

function looksLikeJsonBlob(value = "") {
  const text = String(value || "").trim();
  return (
    (text.startsWith("{") && text.endsWith("}")) ||
    (text.startsWith("[") && text.endsWith("]"))
  );
}

function parseJsonBlob(value = "") {
  const text = String(value || "").trim();
  if (!looksLikeJsonBlob(text)) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
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

function extractStructuredText(value, seen = new WeakSet()) {
  if (value == null) return "";
  if (typeof value === "string") {
    const parsed = parseJsonBlob(value);
    if (parsed != null) {
      const nested = extractStructuredText(parsed, seen);
      return String(nested || "").trim();
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    return value
      .map((item) => extractStructuredText(item, seen))
      .map((part) => String(part || ""))
      .filter((part) => part.trim().length > 0)
      .join("");
  }

  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  const candidates = [
    value.text,
    value.message,
    value.delta,
    value.output,
    value.content,
    value.result,
    value.answer,
    value.part,
    value.parts,
    value.items,
    value.data,
  ];

  for (const candidate of candidates) {
    const text = extractStructuredText(candidate, seen);
    if (String(text || "").trim().length > 0) return text;
  }

  return "";
}

function normalizeMappedText(value, fallback = "") {
  const extracted = String(extractStructuredText(value) || "").trim();
  if (extracted) return extracted;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return String(fallback || "").trim();

    const parsed = parseJsonBlob(trimmed);
    if (parsed != null) {
      const nested = String(extractStructuredText(parsed) || "").trim();
      return nested || String(fallback || "").trim();
    }

    return trimmed;
  }

  return String(fallback || "").trim();
}

function normalizePlan(data) {
  if (Array.isArray(data?.steps)) {
    return data.steps
      .map((s, idx) => normalizeMappedText(s?.title || s?.text || s, `Step ${idx + 1}`))
      .filter(Boolean);
  }
  if (Array.isArray(data)) {
    return data
      .map((s, idx) => normalizeMappedText(s?.title || s?.text || s, `Step ${idx + 1}`))
      .filter(Boolean);
  }
  const single = normalizeMappedText(data?.plan || data?.text || data);
  return single ? [single] : [];
}

function normalizeTerminalText(data) {
  if (typeof data === "string") return data;
  if (!data || typeof data !== "object") return normalizeMappedText(data);
  return normalizeMappedText(data.text || data.output || data.message || data.chunk || "");
}

function findSuggestedCommand(data) {
  if (!data || typeof data !== "object") return "";
  const candidate = safeString(
    data.suggestedCommand ||
    data.command ||
    data.cmd ||
    data.shellCommand ||
    ""
  ).trim();
  return candidate;
}

export function mapOpenCodeEvent(raw) {
  const type = String(raw?.type || "").toLowerCase().trim();
  const data = raw?.data && typeof raw.data === "object" ? raw.data : raw?.data ?? raw;

  switch (type) {
    case OPENCODE_EVENT_TYPES.PLAN:
      return {
        type,
        plan: normalizePlan(data),
      };

    case OPENCODE_EVENT_TYPES.STEP_START:
      return {
        type,
        step: normalizeMappedText(data?.title || data?.step || data?.name || data?.text || ""),
      };

    case OPENCODE_EVENT_TYPES.STEP_UPDATE:
      return {
        type,
        step: normalizeMappedText(data?.title || data?.step || data?.name || data?.text || ""),
        details: normalizeMappedText(data?.details || data?.message || ""),
      };

    case OPENCODE_EVENT_TYPES.TERMINAL:
      return {
        type,
        text: normalizeTerminalText(data),
        command: findSuggestedCommand(data),
      };

    case OPENCODE_EVENT_TYPES.RESULT:
      {
        const candidate = normalizeMappedText(data);
        return {
          type,
          text: normalizeMappedText(candidate || ""),
        };
      }

    case OPENCODE_EVENT_TYPES.ERROR:
      return {
        type,
        text: normalizeMappedText(data?.message || data?.error || data),
      };

    default:
      return {
        type: OPENCODE_EVENT_TYPES.STEP_UPDATE,
        step: normalizeMappedText(data?.title || data?.step || type || "Working"),
        details: normalizeMappedText(data?.message || data?.details || data || ""),
      };
  }
}
