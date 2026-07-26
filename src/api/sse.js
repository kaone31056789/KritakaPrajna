// Parse an OpenAI-style SSE chat stream (`data: {...}\n` frames).
// Shared by openai / openrouter / nvidia / huggingface — the loops were identical;
// only usage.cost differs (OpenRouter reports it), so it's gated behind withCost.
// Also accumulates streamed `delta.tool_calls` fragments (native function calling):
// each fragment carries an index plus partial id/name/arguments that concatenate.
// Reasoning tokens arrive on a sibling field (`delta.reasoning` on OpenRouter,
// `delta.reasoning_content` on NVIDIA/DeepSeek) rather than in `content`; they are
// re-wrapped as <think>…</think> so splitReasoning() in core/send.js renders them
// in the Reasoning panel — left unclosed while streaming so it shimmers live.
export async function parseChatSSE(res, onChunk, { withCost = false } = {}) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let reason = "";
  let buffer = "";
  let usage = null;
  let finished = false;
  const toolCalls = [];
  const compose = (close) =>
    reason ? (full || close ? `<think>${reason}</think>${full}` : `<think>${reason}`) : full;

  while (!finished) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const payload = trimmed.slice(6);
      if (payload === "[DONE]") { finished = true; break; }
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta;
        const think = delta?.reasoning ?? delta?.reasoning_content;
        if (typeof think === "string" && think) { reason += think; onChunk?.(compose(false)); }
        const token = delta?.content;
        if (token) { full += token; onChunk?.(compose(false)); }
        if (Array.isArray(delta?.tool_calls)) {
          for (const frag of delta.tool_calls) {
            const idx = Number.isInteger(frag?.index) ? frag.index : 0;
            if (!toolCalls[idx]) {
              toolCalls[idx] = { id: "", type: "function", function: { name: "", arguments: "" } };
            }
            const slot = toolCalls[idx];
            if (frag.id) slot.id = frag.id;
            if (frag.function?.name) slot.function.name += frag.function.name;
            if (frag.function?.arguments) slot.function.arguments += frag.function.arguments;
          }
        }
        if (json.usage) {
          usage = {
            prompt_tokens: json.usage.prompt_tokens || 0,
            completion_tokens: json.usage.completion_tokens || 0,
            cost: withCost ? (json.usage.cost ?? null) : null,
          };
        }
      } catch {}
    }
  }

  const calls = toolCalls.filter(Boolean).filter((c) => c.function.name);
  const text = compose(true);
  return {
    text: text || (calls.length ? "" : "(No response)"),
    usage,
    tool_calls: calls.length ? calls : null,
  };
}
