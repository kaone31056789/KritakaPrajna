// ── Task type detection ─────────────────────────────────────────────────────

const CODING_KEYWORDS = [
  "function", "const ", "let ", "var ", "class ", "import ", "export ",
  "def ", "return ", "console.log", "async ", "await ", "=>", "useState",
  "useEffect", "npm ", "pip ", "git ", "docker", "sql ", "SELECT ",
  "CREATE TABLE", "INSERT INTO", "DELETE FROM", "kubectl", "terraform",
  "bash ", "chmod ", "sudo ", "#!/", ".map(", ".filter(", ".reduce(",
  "try {", "catch (", "if (", "for (", "while (", "switch (",
  "interface ", "type ", "struct ", "impl ", "fn ", "pub ",
  "console.", "print(", "println!", "fmt.",
  "bug", "error", "fix ", "debug", "refactor", "optimize",
  "code", "implement", "write a function", "write a script",
  "algorithm", "data structure", "API", "endpoint", "middleware",
  "component", "render", "CSS", "HTML", "JavaScript", "TypeScript",
  "Python", "Rust", "Java", "C++", "Go ", "Ruby", "PHP",
  "React", "Vue", "Angular", "Node", "Express", "Django", "Flask",
];

export const TASK_OPTIONS = [
  { id: "text-generation", label: "Text Generation", capability: "text" },
  { id: "image-to-text", label: "Image-to-Text", capability: "vision" },
  { id: "image-to-image", label: "Image-to-Image", capability: "image-edit" },
  { id: "text-to-image", label: "Text-to-Image", capability: "image-gen" },
  { id: "text-to-speech", label: "Text-to-Speech", capability: "audio" },
  { id: "more", label: "More", capability: "specialized" },
];

const TEXT_TO_IMAGE_PATTERNS = [
  "flux", "stable-diffusion", "sdxl", "ideogram", "imagen", "dall-e", "dalle", "recraft", "kandinsky",
];
const AUDIO_PATTERNS = ["tts", "text-to-speech", "speech", "voice", "audio", "bark", "kokoro"];
const IMAGE_EDIT_PATTERNS = ["image-to-image", "img2img", "inpaint", "controlnet", "edit"];
const MULTIMODAL_PATTERNS = ["omni", "multimodal", "any-to-any", "gpt-4o", "gemini", "qwen-vl", "glm-4.5v", "claude"];

/**
 * Detect the task type from the current context.
 * @param {string} text - The user's message text
 * @param {Array} uploads - The current upload items
 * @param {Array} attachedFiles - The sidebar-attached files
 * @returns {"vision"|"document"|"coding"|"general"}
 */
export function detectTaskType(text, uploads = [], attachedFiles = []) {
  const hasImages = uploads.some((u) => u.type === "image");
  if (hasImages) return "vision";

  const hasPdf = uploads.some((u) => u.type === "pdf");
  const hasFiles = uploads.some((u) => u.type === "file") || attachedFiles.length > 0;
  if (hasPdf || hasFiles) return "document";

  const lower = text.toLowerCase();
  const isCoding = CODING_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
  if (isCoding) return "coding";

  // Detect large code blocks (fenced or indented) — suggest coding model
  const codeBlockMatch = text.match(/```[\s\S]*?```/g);
  if (codeBlockMatch) {
    const totalCodeLen = codeBlockMatch.reduce((sum, b) => sum + b.length, 0);
    if (totalCodeLen > 200) return "coding";
  }

  // Long text that looks code-heavy (lots of braces, semicolons, indentation)
  const codeChars = (text.match(/[{};()=><]/g) || []).length;
  if (text.length > 300 && codeChars / text.length > 0.03) return "coding";

  return "general";
}

// ── Model capability detection ──────────────────────────────────────────────

/* Vision detection.
 *
 * OpenRouter reports architecture.modality, but the NVIDIA and HuggingFace
 * catalogues carry no architecture field at all, so for those providers the id
 * patterns below are the ONLY signal. Substring matching also missed families
 * whose names do not spell it out — "qwen2-vl" never matched "qwen2.5-vl", and
 * natively-multimodal families like Llama 4 and Gemma 3 were absent entirely.
 *
 * Only add a family here when it genuinely accepts image input: a false
 * positive sends a picture to a text-only endpoint and fails the request. */
const VISION_RE = new RegExp(
  [
    "vision", // llama-3.2-*-vision, phi-3.5-vision, aya-vision, grok-2-vision
    "multimodal", // phi-4-multimodal
    "[-_.]vl\\b", // qwen2.5-vl, qwen3-vl, nemotron-nano-12b-v2-vl, kimi-vl
    "llava", "pixtral", "internvl", "cogvlm", "moondream", "molmo",
    "minicpm-v", "smolvlm", "idefics", "ovis",
    "glm-4[.0-9]*v", "step-1v",
    "llama-4", // Scout and Maverick are natively multimodal
    "gemma-3", // 4b / 12b / 27b / 3n — the 1b is text-only, excluded below
    "mistral-small-3\\.[12]",
    "gpt-4o", "gpt-4-turbo", "gpt-4\\.1", "gpt-5",
    "(^|[^a-z])o[34]([^a-z]|$)",
    "gemini",
    "claude-3", "claude-4", "claude-(opus|sonnet|haiku)-4",
  ].join("|"),
  "i"
);

/** Text-only members of families that are otherwise multimodal. */
const VISION_EXCEPTIONS = /gemma-3-(1b|270m)|gemma-3n?-1b/i;

/**
 * Check if a model likely supports image/vision input.
 * Uses model ID and architecture info from OpenRouter metadata.
 */
export function supportsVision(model) {
  const id = String(model?.id || "").toLowerCase();
  // OpenRouter models may have an architecture.modality field
  const modality = model?.architecture?.modality || "";
  if (modality.includes("image") || modality.includes("multimodal")) return true;
  if (VISION_EXCEPTIONS.test(id)) return false;
  return VISION_RE.test(id);
}

/** All text models support text — this is a convenience check for non-image tasks */
export function supportsText(model) {
  // Exclude dedicated image/video gen models — they cannot do chat
  if (model?._isImageGen || model?._isVideoGen) return false;
  return true;
}

export function supportsImageGeneration(model) {
  // Explicit flag set by our provider router (HF / OR image gen models)
  if (model?._isImageGen) return true;
  const id = model.id.toLowerCase();
  const modality = model.architecture?.modality || "";
  // Only models that OUTPUT images, not VL models that accept image input
  if (modality.includes("->image") || modality.includes("text->image")) return true;
  return TEXT_TO_IMAGE_PATTERNS.some((p) => id.includes(p));
}

export function supportsImageEditing(model) {
  const id = model.id.toLowerCase();
  const modality = model.architecture?.modality || "";
  if (modality.includes("image->image")) return true;
  return IMAGE_EDIT_PATTERNS.some((p) => id.includes(p));
}

export function supportsAudio(model) {
  const id = model.id.toLowerCase();
  const modality = model.architecture?.modality || "";
  if (modality.includes("audio") || modality.includes("speech")) return true;
  return AUDIO_PATTERNS.some((p) => id.includes(p));
}

export function supportsAnyToAny(model) {
  const id = model.id.toLowerCase();
  const modality = model.architecture?.modality || "";
  if (modality.includes("image") && (modality.includes("audio") || modality.includes("video"))) return true;
  return MULTIMODAL_PATTERNS.some((p) => id.includes(p));
}

export function supportsTask(model, taskId) {
  switch (taskId) {
    case "text-generation":
      return supportsText(model);
    case "image-to-text":
      return supportsVision(model);
    case "text-to-image":
      return supportsImageGeneration(model);
    case "image-to-image":
      return supportsImageEditing(model);
    case "text-to-video":
      return false;
    case "text-to-speech":
      return supportsAudio(model);
    case "any-to-any":
      return supportsAnyToAny(model) || (supportsVision(model) && supportsText(model));
    case "more":
      return true;
    default:
      return supportsText(model);
  }
}

// ── Cost helpers ────────────────────────────────────────────────────────────

export function isFreeModel(model) {
  const p = model?.pricing;
  if (!p) return false;
  return Number(p.prompt) === 0 && Number(p.completion) === 0;
}

// ── Parameter size extraction ───────────────────────────────────────────────

/**
 * Extract the approximate parameter count (in billions) from the model ID/name.
 * E.g. "llama-3.1-405b-instruct" → 405, "qwen-2.5-72b" → 72, "gpt-4o" → 0 (unknown)
 */
export function extractParamBillions(model) {
  const text = `${model.id} ${model.name || ""}`.toLowerCase();
  // Match patterns like "405b", "70b", "8b", "1.5b", "0.5b"
  const match = text.match(/[\-_\s](\d+(?:\.\d+)?)b[\-_\s:)/]/);
  if (match) return parseFloat(match[1]);
  // Also try end-of-string: "...70b"
  const endMatch = text.match(/(\d+(?:\.\d+)?)b$/);
  if (endMatch) return parseFloat(endMatch[1]);
  return 0;
}

// ── Quality scoring (heuristic) ─────────────────────────────────────────────

const QUALITY_TIERS = [
  // High quality (well-known capable models)
  { pattern: "claude-4", score: 96 },
  { pattern: "claude-3-opus", score: 95 },
  { pattern: "claude-3.5-sonnet", score: 92 },
  { pattern: "gpt-4o", score: 90 },
  { pattern: "gpt-4-turbo", score: 88 },
  { pattern: "gemini-2", score: 88 },
  { pattern: "gemini-1.5-pro", score: 86 },
  { pattern: "llama-3.1-405b", score: 85 },
  { pattern: "deepseek-v3", score: 83 },
  { pattern: "deepseek-r1", score: 82 },
  { pattern: "llama-3.3-70b", score: 80 },
  { pattern: "mistral-large", score: 80 },
  { pattern: "qwen-2.5-72b", score: 79 },
  { pattern: "deepseek-chat", score: 78 },
  { pattern: "qwen3", score: 76 },
  // Mid quality
  { pattern: "llama-3", score: 65 },
  { pattern: "mixtral", score: 62 },
  { pattern: "gemma", score: 60 },
  { pattern: "phi-4", score: 58 },
  { pattern: "phi-3", score: 55 },
  { pattern: "qwen", score: 55 },
  { pattern: "mistral", score: 50 },
  { pattern: "deepseek", score: 70 },
];

/**
 * Composite quality score that combines tier matching with parameter size bonus.
 * Larger models get a significant boost (up to +20 points for 400B+ models).
 */
export function qualityScore(model) {
  const id = model.id.toLowerCase();
  let base = 30; // unknown default
  for (const tier of QUALITY_TIERS) {
    if (id.includes(tier.pattern)) { base = tier.score; break; }
  }

  // Parameter size bonus — larger models ranked higher
  const params = extractParamBillions(model);
  let paramBonus = 0;
  if (params >= 200) paramBonus = 20;
  else if (params >= 65) paramBonus = 15;
  else if (params >= 30) paramBonus = 10;
  else if (params >= 10) paramBonus = 5;
  else if (params >= 1) paramBonus = 2;

  return base + paramBonus;
}

// ── Main selection logic ────────────────────────────────────────────────────
