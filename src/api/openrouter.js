const API_BASE = "https://openrouter.ai/api/v1";

export async function fetchModels(apiKey) {
  const res = await fetch(`${API_BASE}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch models: ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  return json.data || [];
}

/**
 * Fetch account credits and usage from OpenRouter.
 * Returns { total_credits, total_usage } or null on failure.
 */
export async function fetchCredits(apiKey) {
  try {
    const res = await fetch(`${API_BASE}/credits`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data || null;
  } catch {
    return null;
  }
}

/**
 * Stream a chat completion. Calls `onChunk(text)` for each token.
 * Returns { text, usage } where usage is { prompt_tokens, completion_tokens } or null.
 * Pass an AbortController signal to allow cancellation.
 */
export async function streamMessage(apiKey, model, messages, { onChunk, signal } = {}) {
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://kritakaprajna.app",
        "X-Title": "KritakaPrajna",
      },
      body: JSON.stringify({ model, messages, stream: true }),
      signal,
    });

    if (res.status === 429 && attempt < maxRetries - 1) {
      const wait = (attempt + 1) * 2000;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    if (!res.ok) {
      const errorBody = await res.text();
      let detail = "";
      try {
        const parsed = JSON.parse(errorBody);
        detail = parsed.error?.message || errorBody;
      } catch {
        detail = errorBody;
      }
      if (res.status === 429) {
        throw new Error("Rate limited — try a different model or wait a moment.");
      }
      if (res.status === 404 && detail.toLowerCase().includes("guardrail")) {
        throw new Error("Blocked by your OpenRouter privacy settings. Go to openrouter.ai/settings/privacy and allow this provider.");
      }
      throw new Error(`${res.status}: ${detail}`);
    }

    // Read the SSE stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    let buffer = "";
    let usage = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") break;
        try {
          const json = JSON.parse(payload);
          const token = json.choices?.[0]?.delta?.content;
          if (token) {
            full += token;
            onChunk?.(full);
          }
          // Capture usage from the final chunk (OpenRouter includes it)
          if (json.usage) {
            usage = {
              prompt_tokens: json.usage.prompt_tokens || 0,
              completion_tokens: json.usage.completion_tokens || 0,
              cost: json.usage.cost ?? null, // Actual cost from OpenRouter
            };
          }
        } catch {
          // skip malformed chunks
        }
      }
    }

    return { text: full || "(No response)", usage };
  }
}
