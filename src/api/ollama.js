const CLOUD_OLLAMA_BASE_URL = "https://ollama.com";
const LEGACY_LOCAL_BASE_URL = "http://127.0.0.1:11434";

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return LEGACY_LOCAL_BASE_URL;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

function resolveConnection(value) {
  const raw = String(value || "").trim();

  if (!raw) {
    return { baseUrl: CLOUD_OLLAMA_BASE_URL, apiKey: "" };
  }

  const looksLikeUrl =
    /^https?:\/\//i.test(raw) ||
    raw.includes("localhost") ||
    raw.includes("127.0.0.1");

  if (looksLikeUrl) {
    return { baseUrl: normalizeBaseUrl(raw), apiKey: "" };
  }

  return { baseUrl: CLOUD_OLLAMA_BASE_URL, apiKey: raw };
}

function withAuthHeaders(headers, apiKey) {
  if (!apiKey) return headers;
  return {
    ...headers,
    Authorization: `Bearer ${apiKey}`,
  };
}

function getElectronApi() {
  try {
    if (typeof window !== "undefined") return window.electronAPI || null;
  } catch {}
  return null;
}

async function requestText(baseUrl, path, { method = "GET", headers = {}, body = "" } = {}) {
  const electronApi = getElectronApi();

  if (electronApi?.ollamaApiRequest) {
    const result = await electronApi.ollamaApiRequest({
      baseUrl,
      path,
      method,
      headers,
      body,
    });

    if (!result?.ok) {
      throw new Error(`Ollama ${result?.status || 0}: ${result?.error || result?.text || "Request failed"}`);
    }

    return String(result?.text || "");
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body || undefined,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Ollama ${res.status}: ${text || "Request failed"}`);
  }

  return text;
}

function prettyName(id) {
  const raw = String(id || "").trim();
  const colon = raw.indexOf(":");
  const base = colon === -1 ? raw : raw.slice(0, colon);
  const tag = colon === -1 ? "" : raw.slice(colon + 1);
  const slash = base.lastIndexOf("/");
  const short = slash >= 0 ? base.slice(slash + 1) : base;
  const suffix = tag && tag.toLowerCase() !== "latest" ? ` ${tag}` : "";

  return `${short}${suffix}`
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim() || raw;
}

function canonicalModelKey(name) {
  const raw = String(name || "").trim().toLowerCase();
  if (!raw) return "";

  const colon = raw.indexOf(":");
  if (colon === -1) return raw;

  const base = raw.slice(0, colon);
  const tag = raw.slice(colon + 1);

  if (!tag || tag === "latest") return base;
  return `${base}:${tag}`;
}

function modelSpecificityScore(model) {
  let score = 0;
  if (model?.details) score += 3;
  if (!model?._fromCloudCatalog) score += 2;
  if (model?.context_length) score += 1;
  return score;
}

function pickModelName(rawModel) {
  return String(
    rawModel?.name ||
    rawModel?.model ||
    rawModel?.id ||
    ""
  ).trim();
}

function isCloudHost(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "ollama.com" || host.endsWith(".ollama.com");
  } catch {
    return false;
  }
}

function isObjectLike(value) {
  return !!value && typeof value === "object";
}

function normalizeUsageKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function valueToFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return NaN;

  const cleaned = value.replace(/[,%$]/g, "").trim();
  if (!cleaned) return NaN;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function valueToPercent(value) {
  const numeric = valueToFiniteNumber(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (numeric <= 1) return numeric * 100;
  if (numeric <= 1000) return numeric;
  return null;
}

function humanizeDurationSeconds(totalSeconds) {
  const sec = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (!sec) return "";
  if (sec >= 86400) {
    const days = Math.round(sec / 86400);
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (sec >= 3600) {
    const hours = Math.round(sec / 3600);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  if (sec >= 60) {
    const mins = Math.round(sec / 60);
    return `${mins} minute${mins === 1 ? "" : "s"}`;
  }
  return `${sec} second${sec === 1 ? "" : "s"}`;
}

function normalizeResetHint(value) {
  if (value == null) return "";

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e12) {
      const deltaSeconds = Math.round((value - Date.now()) / 1000);
      return deltaSeconds > 0 ? humanizeDurationSeconds(deltaSeconds) : "";
    }
    if (value > 1e9) {
      const deltaSeconds = Math.round(value - Date.now() / 1000);
      return deltaSeconds > 0 ? humanizeDurationSeconds(deltaSeconds) : "";
    }
    return humanizeDurationSeconds(value);
  }

  if (typeof value !== "string") return "";

  const text = value.trim();
  if (!text) return "";

  const parsedDate = Date.parse(text);
  if (Number.isFinite(parsedDate)) {
    const deltaSeconds = Math.round((parsedDate - Date.now()) / 1000);
    if (deltaSeconds > 0) return humanizeDurationSeconds(deltaSeconds);
  }

  return text
    .replace(/^resets?\s+in\s+/i, "")
    .replace(/^in\s+/i, "")
    .trim();
}

function collectPrimitivesFromMatchedValue(value) {
  if (typeof value === "string" || typeof value === "number") {
    return [value];
  }

  if (!isObjectLike(value)) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === "string" || typeof item === "number");
  }

  const fromObject = [];
  for (const [key, inner] of Object.entries(value)) {
    if (typeof inner !== "string" && typeof inner !== "number") continue;
    const normalized = normalizeUsageKey(key);
    if (["name", "label", "plan", "tier", "type", "value"].includes(normalized) || fromObject.length < 4) {
      fromObject.push(inner);
    }
  }

  return fromObject;
}

function collectValuesByKeyHints(root, keyHints = []) {
  const hints = (keyHints || []).map(normalizeUsageKey).filter(Boolean);
  if (!isObjectLike(root) || hints.length === 0) return [];

  const values = [];
  const seen = new Set();
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    if (!isObjectLike(current) || seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      for (const entry of current) {
        if (isObjectLike(entry)) stack.push(entry);
      }
      continue;
    }

    for (const [rawKey, rawValue] of Object.entries(current)) {
      const key = normalizeUsageKey(rawKey);
      if (key && hints.some((hint) => key.includes(hint) || hint.includes(key))) {
        values.push(...collectPrimitivesFromMatchedValue(rawValue));
      }

      if (isObjectLike(rawValue)) stack.push(rawValue);
    }
  }

  return values;
}

function findSectionObject(root, keyHint) {
  const hint = normalizeUsageKey(keyHint);
  if (!isObjectLike(root) || !hint) return null;

  const seen = new Set();
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    if (!isObjectLike(current) || seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      for (const entry of current) {
        if (isObjectLike(entry)) stack.push(entry);
      }
      continue;
    }

    for (const [rawKey, rawValue] of Object.entries(current)) {
      if (isObjectLike(rawValue)) {
        if (normalizeUsageKey(rawKey).includes(hint)) {
          return rawValue;
        }
        stack.push(rawValue);
      }
    }
  }

  return null;
}

function pickFirstFiniteNumber(values = []) {
  for (const value of values) {
    const numeric = valueToFiniteNumber(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function pickFirstPercent(values = []) {
  for (const value of values) {
    const percent = valueToPercent(value);
    if (percent != null) return percent;
  }
  return null;
}

function pickFirstReset(values = []) {
  for (const value of values) {
    const text = normalizeResetHint(value);
    if (text) return text;
  }
  return "";
}

function extractUsageWindow(payload, windowName) {
  const normalizedWindow = normalizeUsageKey(windowName);
  const section = findSectionObject(payload, normalizedWindow) || payload;

  const percent = pickFirstPercent([
    ...collectValuesByKeyHints(section, [
      `${normalizedWindow}usagepercent`,
      `${normalizedWindow}percentused`,
      `${normalizedWindow}percentageused`,
      `${normalizedWindow}percent`,
      "usagepercent",
      "usedpercent",
      "percentageused",
      "percent",
      "percentage",
      "ratio",
    ]),
    ...collectValuesByKeyHints(payload, [
      `${normalizedWindow}usagepercent`,
      `${normalizedWindow}percentused`,
      `${normalizedWindow}percent`,
      `${normalizedWindow}ratio`,
    ]),
  ]);

  const used = pickFirstFiniteNumber([
    ...collectValuesByKeyHints(section, [
      `${normalizedWindow}used`,
      `${normalizedWindow}usage`,
      `${normalizedWindow}consumed`,
      "used",
      "usage",
      "consumed",
      "current",
      "count",
      "value",
    ]),
    ...collectValuesByKeyHints(payload, [
      `${normalizedWindow}used`,
      `${normalizedWindow}usage`,
      `${normalizedWindow}count`,
    ]),
  ]);

  const limit = pickFirstFiniteNumber([
    ...collectValuesByKeyHints(section, [
      `${normalizedWindow}limit`,
      `${normalizedWindow}quota`,
      `${normalizedWindow}max`,
      `${normalizedWindow}total`,
      "limit",
      "quota",
      "max",
      "total",
      "capacity",
    ]),
    ...collectValuesByKeyHints(payload, [
      `${normalizedWindow}limit`,
      `${normalizedWindow}quota`,
      `${normalizedWindow}max`,
      `${normalizedWindow}total`,
    ]),
  ]);

  const resetsIn = pickFirstReset([
    ...collectValuesByKeyHints(section, [
      `${normalizedWindow}resetsin`,
      `${normalizedWindow}resetin`,
      `${normalizedWindow}resetat`,
      `${normalizedWindow}nextreset`,
      "resetsin",
      "resetin",
      "resetat",
      "nextreset",
      "resetsat",
      "reset",
    ]),
    ...collectValuesByKeyHints(payload, [
      `${normalizedWindow}resetsin`,
      `${normalizedWindow}resetin`,
      `${normalizedWindow}resetat`,
      `${normalizedWindow}nextreset`,
    ]),
  ]);

  let percentUsed = percent;
  if (percentUsed == null && used != null && limit != null && limit > 0) {
    percentUsed = (used / limit) * 100;
  }

  return {
    percentUsed,
    used,
    limit,
    resetsIn,
  };
}

function extractPlanLabel(payload) {
  const values = collectValuesByKeyHints(payload, ["plan", "tier", "subscription", "accounttype"]);
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    if (!/[a-z]/i.test(text)) continue;
    if (text.length > 40) continue;
    const normalized = normalizeUsageKey(text);
    if (!normalized || normalized.includes("session") || normalized.includes("weekly")) continue;
    return text;
  }
  return "";
}

export async function fetchCloudUsage(baseUrlConfig) {
  const { baseUrl, apiKey } = resolveConnection(baseUrlConfig);

  if (!isCloudHost(baseUrl)) {
    return {
      available: false,
      reason: "not_cloud_host",
      plan: "",
      session: { percentUsed: null, used: null, limit: null, resetsIn: "" },
      weekly: { percentUsed: null, used: null, limit: null, resetsIn: "" },
      raw: null,
    };
  }

  if (!apiKey) {
    return {
      available: false,
      reason: "missing_api_key",
      plan: "",
      session: { percentUsed: null, used: null, limit: null, resetsIn: "" },
      weekly: { percentUsed: null, used: null, limit: null, resetsIn: "" },
      raw: null,
    };
  }

  const raw = await requestText(baseUrl, "/api/me", {
    method: "POST",
    headers: withAuthHeaders(
      {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      apiKey
    ),
    body: "{}",
  });

  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    throw new Error("Ollama: invalid cloud usage response");
  }

  const session = extractUsageWindow(payload, "session");
  const weekly = extractUsageWindow(payload, "weekly");
  const plan = extractPlanLabel(payload);

  const available =
    session.percentUsed != null ||
    weekly.percentUsed != null ||
    (session.used != null && session.limit != null) ||
    (weekly.used != null && weekly.limit != null);

  return {
    available,
    reason: available ? "" : "usage_fields_missing",
    plan,
    session,
    weekly,
    raw: payload,
  };
}

function parseCloudCatalogModelNames(html) {
  const names = [];
  const seen = new Set();

  const add = (value) => {
    const name = String(value || "").trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    names.push(name);
  };

  const titleRe = /x-test-search-response-title>([^<]+)<\/span>/gi;
  for (const match of html.matchAll(titleRe)) {
    add(match[1]);
  }

  if (names.length === 0) {
    const hrefRe = /href="\/library\/([^"?#\/]+)"/gi;
    for (const match of html.matchAll(hrefRe)) {
      try {
        add(decodeURIComponent(match[1]));
      } catch {
        add(match[1]);
      }
    }
  }

  return names;
}

function inferVisionSupport(modelName = "", details = {}) {
  const families = Array.isArray(details?.families) ? details.families.join(" ") : "";
  const sample = `${modelName} ${details?.family || ""} ${families}`.toLowerCase();
  return /(llava|vision|\bvl\b|bakllava|moondream|minicpm-v|gemma3|qwen2\.5-vl|qwen-vl|llama3\.2-vision)/.test(sample);
}

function toOllamaMessage(message) {
  const role = ["system", "user", "assistant"].includes(message?.role) ? message.role : "user";

  if (typeof message?.content === "string") {
    return { role, content: message.content };
  }

  if (!Array.isArray(message?.content)) {
    return { role, content: "" };
  }

  const textParts = [];
  const images = [];

  for (const part of message.content) {
    if (part?.type === "text" && typeof part.text === "string") {
      textParts.push(part.text);
      continue;
    }

    if (part?.type === "image_url") {
      const url = String(part?.image_url?.url || "");
      if (url.startsWith("data:")) {
        const comma = url.indexOf(",");
        if (comma !== -1) {
          images.push(url.slice(comma + 1));
        }
      }
    }
  }

  const converted = { role, content: textParts.join("\n").trim() };
  if (images.length > 0) converted.images = images;
  return converted;
}

async function fetchTags(baseUrl, apiKey) {
  const raw = await requestText(baseUrl, "/api/tags", {
    method: "GET",
    headers: withAuthHeaders({}, apiKey),
  });

  let json;
  try {
    json = JSON.parse(raw || "{}");
  } catch {
    throw new Error("Ollama: invalid model tags response");
  }

  return Array.isArray(json?.models) ? json.models : [];
}

async function fetchOpenAICompatModels(baseUrl, apiKey) {
  const raw = await requestText(baseUrl, "/v1/models", {
    method: "GET",
    headers: withAuthHeaders({}, apiKey),
  });

  let json;
  try {
    json = JSON.parse(raw || "{}");
  } catch {
    throw new Error("Ollama: invalid v1/models response");
  }

  return Array.isArray(json?.data)
    ? json.data.map((m) => ({ name: m.id || m.name || "" }))
    : [];
}

async function fetchCloudCatalogModels(baseUrl, apiKey) {
  if (!isCloudHost(baseUrl)) return [];

  const raw = await requestText(baseUrl, "/search?c=cloud", {
    method: "GET",
    headers: withAuthHeaders({}, apiKey),
  });

  const names = parseCloudCatalogModelNames(raw || "");
  return names.map((name) => ({ name, _fromCloudCatalog: true }));
}

export async function fetchModels(baseUrlConfig) {
  const { baseUrl, apiKey } = resolveConnection(baseUrlConfig);

  let tagModels = [];
  let v1Models = [];
  let catalogModels = [];

  try { tagModels = await fetchTags(baseUrl, apiKey); } catch {}
  try { v1Models = await fetchOpenAICompatModels(baseUrl, apiKey); } catch {}
  try { catalogModels = await fetchCloudCatalogModels(baseUrl, apiKey); } catch {}

  const rawModels = [
    ...(Array.isArray(tagModels) ? tagModels : []),
    ...(Array.isArray(v1Models) ? v1Models : []),
    ...(Array.isArray(catalogModels) ? catalogModels : []),
  ];

  const unique = new Map();
  for (const model of rawModels) {
    const resolved = pickModelName(model);
    if (!resolved) continue;

    const key = canonicalModelKey(resolved);
    if (!key) continue;

    const candidate = { ...model, _resolvedName: resolved };
    const existing = unique.get(key);

    if (!existing) {
      unique.set(key, candidate);
      continue;
    }

    if (modelSpecificityScore(candidate) > modelSpecificityScore(existing)) {
      unique.set(key, candidate);
    }
  }

  return Array.from(unique.values())
    .filter((m) => !!m._resolvedName)
    .map((m) => {
      const modelName = m._resolvedName;
      const isVision = inferVisionSupport(modelName, m.details || {});

      return {
        id: modelName,
        name: prettyName(modelName),
        pricing: { prompt: "0", completion: "0" },
        context_length: Number(m?.details?.context_length) || 32768,
        _provider: "ollama",
        architecture: isVision ? { modality: "text+image->text" } : { modality: "text->text" },
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function streamMessage(
  baseUrlConfig,
  modelId,
  messages,
  { onChunk, signal, maxTokens, temperature, topP } = {}
) {
  const { baseUrl, apiKey } = resolveConnection(baseUrlConfig);

  const requestPayload = {
    model: modelId,
    messages: (messages || []).map(toOllamaMessage),
    stream: true,
    // TOKEN OPTIMIZATION: keep local/cloud generation bounded.
    options: {
      num_predict: maxTokens ?? 512,
      temperature: temperature ?? 0.7,
      top_p: topP ?? 0.9,
    },
  };

  const electronApi = getElectronApi();
  if (electronApi?.ollamaApiRequest) {
    // Main-process proxy currently returns buffered payload; use non-stream mode and emit once.
    const raw = await requestText(baseUrl, "/api/chat", {
      method: "POST",
      headers: withAuthHeaders({ "Content-Type": "application/json" }, apiKey),
      body: JSON.stringify({ ...requestPayload, stream: false }),
    });

    let json;
    try {
      json = JSON.parse(raw || "{}");
    } catch {
      throw new Error("Ollama: invalid chat response");
    }

    const text = String(json?.message?.content || json?.response || "").trim() || "(No response)";
    onChunk?.(text);
    return {
      text,
      usage: {
        prompt_tokens: Number(json?.prompt_eval_count) || 0,
        completion_tokens: Number(json?.eval_count) || 0,
        cost: 0,
      },
    };
  }

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: withAuthHeaders({
      "Content-Type": "application/json",
    }, apiKey),
    body: JSON.stringify(requestPayload),
    signal,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama ${res.status}: ${body || "Request failed"}`);
  }

  if (!res.body) {
    const json = await res.json();
    const text = String(json?.message?.content || json?.response || "").trim();
    return {
      text: text || "(No response)",
      usage: {
        prompt_tokens: Number(json?.prompt_eval_count) || 0,
        completion_tokens: Number(json?.eval_count) || 0,
        cost: 0,
      },
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";
  let usage = null;

  const processJsonLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let json;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return;
    }

    if (json?.error) {
      throw new Error(String(json.error));
    }

    const token = json?.message?.content;
    if (token) {
      full += token;
      onChunk?.(full);
    }

    if (json?.done) {
      usage = {
        prompt_tokens: Number(json?.prompt_eval_count) || 0,
        completion_tokens: Number(json?.eval_count) || 0,
        cost: 0,
      };
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      processJsonLine(line);
    }
  }

  if (buffer.trim()) processJsonLine(buffer);

  return { text: full || "(No response)", usage };
}
