/**
 * Tool-call parser coverage across model dialects.
 *
 * WHY THIS EXISTS: so nobody has to hand-test every model to discover how its
 * tool calls leak. Each case feeds a representative raw assistant response (in
 * the exact shape a given model family emits) into parseAgentResponse() and
 * asserts the tool call is recognised with the right name + params.
 *
 * If you wire up a new provider/model and it emits a NEW dialect, add a case
 * here — a green run means the agent will actually execute that model's tools
 * instead of leaking them as chat text.
 */

// agentLoop.js imports only { routeStream } from providerRouter, and the parser
// functions never call it. Mock the module so the import chain stays inert in
// the test environment (no network/provider setup required).
jest.mock("../api/providerRouter", () => ({
  routeStream: jest.fn(),
}));

import { parseAgentResponse } from "./agentLoop";

const TSEP = "｜"; // fullwidth vertical bar ｜ (DeepSeek/Qwen native tokens)
const TUND = "▁"; // fullwidth underscore ▁

const toolsOf = (raw) => parseAgentResponse(raw).filter((b) => b.type === "tool_call");
const firstTool = (raw) => toolsOf(raw)[0];
const textOf = (raw) =>
  parseAgentResponse(raw)
    .filter((b) => b.type === "text")
    .map((b) => b.content)
    .join("\n");

describe("tool-call parser — per-model dialects", () => {
  test("Claude / native — canonical <tool><param> XML", () => {
    const t = firstTool('<tool name="read_file">\n<param name="path">index.html</param>\n</tool>');
    expect(t?.tool).toBe("read_file");
    expect(t.params.path).toBe("index.html");
  });

  test("Kimi K2 — functions.NAME:idx{json} compact form", () => {
    const t = firstTool('functions.read_file:0{"path": "index.html"}');
    expect(t?.tool).toBe("read_file");
    expect(t.params.path).toBe("index.html");
  });

  test("OpenAI — functions.NAME(json) with braces inside content", () => {
    const t = firstTool(
      'functions.write_file({"path": "index.html", "content": "<style>.x{color:red}</style>"})'
    );
    expect(t?.tool).toBe("write_file");
    expect(t.params.path).toBe("index.html");
    expect(t.params.content).toContain("<style>.x{color:red}</style>");
  });

  test("Harmony (gpt-oss) — to=functions.NAME <|message|>{json}", () => {
    const raw = `to=functions.run_command<${TSEP}message${TSEP}>{"command": "npm run build"}`;
    const t = firstTool(raw);
    expect(t?.tool).toBe("run_command");
    expect(t.params.command).toBe("npm run build");
  });

  test("DeepSeek — function<｜tool▁sep｜>NAME + fenced json", () => {
    const raw = [
      `function<${TSEP}tool${TUND}sep${TSEP}>list_directory`,
      "```json",
      '{"path": "."}',
      "```",
    ].join("\n");
    const t = firstTool(raw);
    expect(t?.tool).toBe("list_directory");
    expect(t.params.path).toBe(".");
  });

  test("Qwen / Hermes — fenced {name, arguments} JSON block", () => {
    const raw = [
      "```json",
      '{"name": "write_file", "arguments": {"path": "a.txt", "content": "hello"}}',
      "```",
    ].join("\n");
    const t = firstTool(raw);
    expect(t?.tool).toBe("write_file");
    expect(t.params.path).toBe("a.txt");
    expect(t.params.content).toBe("hello");
  });

  test("GPT fallback — bare un-fenced {name, arguments} JSON", () => {
    const t = firstTool('{"name": "search_files", "arguments": {"query": "TODO"}}');
    expect(t?.tool).toBe("search_files");
    expect(t.params.query).toBe("TODO");
  });

  test("write_file with nested/escaped JSON content survives brace matching", () => {
    const raw = 'functions.write_file:0{"path": "config.json", "content": "{\\"a\\": {\\"b\\": 1}}"}';
    const t = firstTool(raw);
    expect(t?.tool).toBe("write_file");
    expect(t.params.path).toBe("config.json");
    expect(t.params.content).toBe('{"a": {"b": 1}}');
  });

  test("prose + tool call — narration preserved, call still parsed", () => {
    const raw = 'I\'ll read the file first.\nfunctions.read_file:0{"path": "src/app.js"}';
    const tools = toolsOf(raw);
    expect(tools).toHaveLength(1);
    expect(tools[0].params.path).toBe("src/app.js");
    expect(textOf(raw)).toContain("read the file first");
  });

  test("multiple sequential functions.NAME calls in one turn", () => {
    const raw = 'functions.read_file:1{"path": "a.js"}\nfunctions.read_file:2{"path": "b.js"}';
    const tools = toolsOf(raw);
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.params.path)).toEqual(["a.js", "b.js"]);
  });

  test("<think> reasoning is stripped and does not break the call", () => {
    const raw = '<think>Let me plan my approach</think>\nfunctions.read_file:0{"path": "x"}';
    expect(firstTool(raw)?.tool).toBe("read_file");
    expect(textOf(raw)).not.toContain("Let me plan");
  });

  test("plan block still parses (plan_first mode)", () => {
    const blocks = parseAgentResponse('<plan><step status="pending">Do X</step></plan>');
    const plan = blocks.find((b) => b.type === "plan");
    expect(plan?.steps).toHaveLength(1);
    expect(plan.steps[0].text).toBe("Do X");
  });

  test("non-tool JSON is NOT misparsed as a tool call", () => {
    const raw = 'Here is some config: {"foo": 1, "bar": 2}';
    expect(toolsOf(raw)).toHaveLength(0);
    expect(textOf(raw)).toContain("foo");
  });

  test("delete_file via functions namespace", () => {
    const t = firstTool('functions.delete_file:0{"path": "old.tmp"}');
    expect(t?.tool).toBe("delete_file");
    expect(t.params.path).toBe("old.tmp");
  });

  test("prose mentioning a tool name (no JSON) is left as text", () => {
    const raw = "You can call functions.read_file to read files, then continue.";
    expect(toolsOf(raw)).toHaveLength(0);
    expect(textOf(raw)).toContain("read files");
  });
});
