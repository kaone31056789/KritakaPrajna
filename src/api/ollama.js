import { settingsStore } from "../core/settings";

const CLOUD_OLLAMA_BASE_URL = "https://ollama.com";
const LEGACY_LOCAL_BASE_URL = "http://127.0.0.1:11434";

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return LEGACY_LOCAL_BASE_URL;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

// Advanced runtime knobs (Settings → Local Models → Runtime). Applied only to
// the local runtime — cloud endpoints ignore/reject these, so we skip them.
function localRuntimeRequestOptions(baseUrl) {
  const empty = { options: {}, keep_alive: null };
  let host = "";
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return empty;
  }
  const isLocal = host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  if (!isLocal) return empty;

  let rt = null;
  try {
    rt = settingsStore.get().localRuntime;
  } catch {
    /* settings store unavailable (tests) — fall back to runtime defaults */
  }
  if (!rt) return empty;

  const options = {};
  if (Number(rt.contextLength) > 0) options.num_ctx = Math.floor(Number(rt.contextLength));
  if (rt.numGpu !== null && rt.numGpu !== undefined && rt.numGpu !== "" && Number.isFinite(Number(rt.numGpu))) {
    options.num_gpu = Math.max(0, Math.floor(Number(rt.numGpu)));
  }
  if (Number(rt.numThread) > 0) options.num_thread = Math.floor(Number(rt.numThread));

  const keepAlive = String(rt.keepAlive ?? "").trim();
  return { options, keep_alive: keepAlive || null };
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

async function requestText(baseUrl, path, { method = "GET", headers = {}, body = "", timeoutMs } = {}) {
  const electronApi = getElectronApi();

  if (electronApi?.ollamaApiRequest) {
    const result = await electronApi.ollamaApiRequest({
      baseUrl,
      path,
      method,
      headers,
      body,
      timeoutMs,
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

function hasMessagePayload(message) {
  if (!message) return false;
  const content = String(message?.content || "").trim();
  const images = Array.isArray(message?.images) ? message.images : [];
  return content.length > 0 || images.length > 0;
}

function mergeConversationMessage(left, right) {
  const mergedText = [String(left?.content || "").trim(), String(right?.content || "").trim()]
    .filter(Boolean)
    .join("\n\n");

  const images = [
    ...(Array.isArray(left?.images) ? left.images : []),
    ...(Array.isArray(right?.images) ? right.images : []),
  ];

  const merged = {
    role: left?.role === "assistant" ? "assistant" : "user",
    content: mergedText,
  };

  if (images.length > 0) merged.images = images;
  return merged;
}

function buildOllamaConversation(messages = []) {
  const converted = (Array.isArray(messages) ? messages : []).map(toOllamaMessage);
  const systemBlocks = [];
  const conversational = [];

  for (const msg of converted) {
    if (msg?.role === "system") {
      const sysText = String(msg?.content || "").trim();
      if (sysText) systemBlocks.push(sysText);
      continue;
    }

    const normalized = {
      role: msg?.role === "assistant" ? "assistant" : "user",
      content: String(msg?.content || "").trim(),
    };

    if (Array.isArray(msg?.images) && msg.images.length > 0) {
      normalized.images = msg.images;
    }

    if (hasMessagePayload(normalized)) conversational.push(normalized);
  }

  if (systemBlocks.length > 0) {
    const systemPrefix = { role: "user", content: systemBlocks.join("\n\n") };
    if (conversational.length > 0 && conversational[0].role === "user") {
      conversational[0] = mergeConversationMessage(systemPrefix, conversational[0]);
    } else {
      conversational.unshift(systemPrefix);
    }
  }

  const alternated = [];
  for (const msg of conversational) {
    if (!hasMessagePayload(msg)) continue;

    if (alternated.length === 0) {
      if (msg.role !== "user") continue;
      alternated.push(msg);
      continue;
    }

    const prev = alternated[alternated.length - 1];
    if (prev.role === msg.role) {
      alternated[alternated.length - 1] = mergeConversationMessage(prev, msg);
    } else {
      alternated.push(msg);
    }
  }

  if (alternated.length === 0) {
    return [{ role: "user", content: "Continue." }];
  }

  return alternated;
}

function isModelNotFoundMessage(message) {
  const text = String(message || "").toLowerCase();
  return text.includes("model") && text.includes("not found");
}

function normalizeModelMatchKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function deriveModelRetryCandidates(modelName, availableNames = []) {
  const baseInput = String(modelName || "").trim();
  const candidates = [];
  const pushCandidate = (value) => {
    const normalized = String(value || "").trim();
    if (!normalized || candidates.includes(normalized)) return;
    candidates.push(normalized);
  };

  pushCandidate(baseInput);

  if (baseInput && !baseInput.includes(":")) {
    pushCandidate(`${baseInput}:latest`);
  }

  if (baseInput.endsWith(":latest")) {
    pushCandidate(baseInput.slice(0, -":latest".length));
  }

  const targetCanonical = canonicalModelKey(baseInput);
  if (targetCanonical) {
    for (const name of availableNames) {
      if (canonicalModelKey(name) === targetCanonical) {
        pushCandidate(name);
      }
    }
  }

  const targetKey = normalizeModelMatchKey(baseInput.split(":")[0] || baseInput);
  if (targetKey) {
    const scored = [];
    for (const name of availableNames) {
      const key = normalizeModelMatchKey(name);
      if (!key) continue;

      let score = 0;
      if (key === targetKey) score = 100;
      else if (key.startsWith(targetKey) || targetKey.startsWith(key)) score = 80;
      else if (key.includes(targetKey) || targetKey.includes(key)) score = 60;

      if (score > 0) scored.push({ name, score });
    }

    scored
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 3)
      .forEach((item) => pushCandidate(item.name));
  }

  return candidates;
}

async function fetchKnownModelNames(baseUrl, apiKey) {
  let tagModels = [];
  let v1Models = [];

  try { tagModels = await fetchTags(baseUrl, apiKey); } catch {}
  try { v1Models = await fetchOpenAICompatModels(baseUrl, apiKey); } catch {}

  return Array.from(
    new Set(
      [...tagModels, ...v1Models]
        .map((model) => pickModelName(model))
        .filter(Boolean)
    )
  );
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

  const primaryModels = [
    ...(Array.isArray(tagModels) ? tagModels : []),
    ...(Array.isArray(v1Models) ? v1Models : []),
  ];

  // Cloud catalog pages can include discoverability entries that are not directly chat-callable
  // for the current account; use those only when no API model list is available.
  const rawModels = primaryModels.length > 0
    ? primaryModels
    : [
        ...primaryModels,
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
  const conversation = buildOllamaConversation(messages);
  const runtimeOpts = localRuntimeRequestOptions(baseUrl);
  const buildPayload = (candidateModel, stream) => ({
    model: candidateModel,
    messages: conversation,
    stream,
    ...(runtimeOpts.keep_alive != null ? { keep_alive: runtimeOpts.keep_alive } : {}),
    // TOKEN OPTIMIZATION: keep local/cloud generation bounded.
    options: {
      num_predict: maxTokens ?? 512,
      temperature: temperature ?? 0.7,
      top_p: topP ?? 0.9,
      ...runtimeOpts.options,
    },
  });

  const chatTimeoutMs = Math.min(
    15 * 60 * 1000,
    Math.max(120000, (Number(maxTokens) || 512) * 180 + 45000)
  );

  const runWithModelRetries = async (runner) => {
    const queue = deriveModelRetryCandidates(modelId);
    const seen = new Set();
    let knownNames = null;
    let lastError = null;

    while (queue.length > 0) {
      const candidate = queue.shift();
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);

      try {
        return await runner(candidate);
      } catch (err) {
        lastError = err;

        if (!isModelNotFoundMessage(err?.message)) {
          throw err;
        }

        if (!knownNames) {
          knownNames = await fetchKnownModelNames(baseUrl, apiKey);
          const extras = deriveModelRetryCandidates(modelId, knownNames);
          for (const extra of extras) {
            if (!seen.has(extra) && !queue.includes(extra)) {
              queue.push(extra);
            }
          }
        }
      }
    }

    if (lastError && knownNames?.length) {
      const preview = knownNames.slice(0, 8).join(", ");
      throw new Error(
        `${lastError.message} Available Ollama models: ${preview}${knownNames.length > 8 ? ", ..." : ""}`
      );
    }

    throw lastError || new Error(`Ollama model \"${modelId}\" not found.`);
  };

  const electronApi = getElectronApi();
  if (electronApi?.ollamaApiRequest) {
    return runWithModelRetries(async (candidateModel) => {
      // Main-process proxy currently returns buffered payload; use non-stream mode and emit once.
      const raw = await requestText(baseUrl, "/api/chat", {
        method: "POST",
        headers: withAuthHeaders({ "Content-Type": "application/json" }, apiKey),
        body: JSON.stringify(buildPayload(candidateModel, false)),
        timeoutMs: chatTimeoutMs,
      });

      let json;
      try {
        json = JSON.parse(raw || "{}");
      } catch {
        throw new Error("Ollama: invalid chat response");
      }

      const modelError = String(json?.error || "").trim();
      if (modelError) {
        throw new Error(`Ollama: ${modelError}`);
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
    });
  }

  return runWithModelRetries(async (candidateModel) => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: withAuthHeaders({
        "Content-Type": "application/json",
      }, apiKey),
      body: JSON.stringify(buildPayload(candidateModel, true)),
      signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Ollama ${res.status}: ${body || "Request failed"}`);
    }

    if (!res.body) {
      const json = await res.json();
      const modelError = String(json?.error || "").trim();
      if (modelError) {
        throw new Error(`Ollama: ${modelError}`);
      }

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
  });
}
