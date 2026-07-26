/** @jest-environment node */
import { parseChatSSE } from "./sse";

const mockRes = (frames) => ({ body: { getReader() {
  let i = 0;
  const enc = new TextEncoder();
  return { read: async () => i < frames.length
    ? { done: false, value: enc.encode(frames[i++]) }
    : { done: true } };
} } });

const FRAMES = [
  'data: {"choices":[{"delta":{"content":"He"}}]}\n',
  'data: {"choices":[{"delta":{"content":"llo"}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"cost":0.01}}\n',
  "data: [DONE]\n",
];

test("parseChatSSE assembles text + usage and gates cost behind withCost", async () => {
  const on = await parseChatSSE(mockRes(FRAMES), () => {}, { withCost: true });
  expect(on.text).toBe("Hello");
  expect(on.usage.completion_tokens).toBe(2);
  expect(on.usage.cost).toBe(0.01);

  const off = await parseChatSSE(mockRes(FRAMES), () => {});
  expect(off.usage.cost).toBeNull();
});

test("parseChatSSE wraps sibling reasoning fields as <think> and closes them", async () => {
  const chunks = [];
  const out = await parseChatSSE(
    mockRes([
      'data: {"choices":[{"delta":{"reasoning":"Let me "}}]}\n',
      'data: {"choices":[{"delta":{"reasoning_content":"count."}}]}\n',
      'data: {"choices":[{"delta":{"content":"Two."}}]}\n',
      "data: [DONE]\n",
    ]),
    (t) => chunks.push(t)
  );
  // Unclosed while only reasoning has arrived, so the panel streams live.
  expect(chunks[0]).toBe("<think>Let me ");
  expect(out.text).toBe("<think>Let me count.</think>Two.");
});

test("parseChatSSE closes a reasoning-only response", async () => {
  const out = await parseChatSSE(
    mockRes(['data: {"choices":[{"delta":{"reasoning":"hm"}}]}\n', "data: [DONE]\n"]),
    () => {}
  );
  expect(out.text).toBe("<think>hm</think>");
});
