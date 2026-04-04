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
  { id: "any-to-any", label: "Any-to-Any", capability: "multimodal" },
  { id: "image-to-text", label: "Image-to-Text", capability: "vision" },
  { id: "image-to-image", label: "Image-to-Image", capability: "image-edit" },
  { id: "text-to-image", label: "Text-to-Image", capability: "image-gen" },
  { id: "text-to-video", label: "Text-to-Video", capability: "video" },
  { id: "text-to-speech", label: "Text-to-Speech", capability: "audio" },
  { id: "more", label: "More", capability: "specialized" },
];

const TEXT_TO_IMAGE_PATTERNS = [
  "flux", "stable-diffusion", "sdxl", "ideogram", "imagen", "dall-e", "dalle", "recraft", "kandinsky",
];
// Strict patterns — only model IDs that are video *generators*, not VL/multimodal models that accept video input
const TEXT_TO_VIDEO_PATTERNS = ["veo-", "sora", "hunyuanvideo", "wan-ai/wan", "kling", "seedance", "seed-1.", "seed-2.", "haiper", "pika", "luma"];
const AUDIO_PATTERNS = ["tts", "text-to-speech", "speech", "voice", "audio", "bark", "kokoro"];
const IMAGE_EDIT_PATTERNS = ["image-to-image", "img2img", "inpaint", "controlnet", "edit"];
const MULTIMODAL_PATTERNS = ["omni", "multimodal", "any-to-any", "gpt-4o", "gemini", "qwen-vl", "glm-4.5v", "claude"];

export function taskLabel(taskId) {
  return TASK_OPTIONS.find((t) => t.id === taskId)?.label || "Text Generation";
}

export function detectUiTask(text, uploads = [], attachedFiles = []) {
  const lower = (text || "").toLowerCase();

  if (uploads.some((u) => u.type === "image")) return "image-to-text";
  if (/(generate|create|make).*(image|logo|poster|art|photo|picture)/.test(lower)) return "text-to-image";
  if (/(generate|create|make).*(video|clip|animation)/.test(lower)) return "text-to-video";
  if (/(text to speech|tts|voiceover|narrate|read aloud|speak this)/.test(lower)) return "text-to-speech";
  if (/(edit image|modify image|restyle image|image to image|img2img)/.test(lower)) return "image-to-image";
  if (/(any to any|multimodal|audio and image|video and text)/.test(lower)) return "any-to-any";
  if (uploads.some((u) => u.type === "pdf") || uploads.some((u) => u.type === "file") || attachedFiles.length > 0) return "text-generation";

  return "text-generation";
}

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

const VISION_PATTERNS = [
  "vision", "gpt-4o", "gpt-4-turbo", "gemini", "claude-3",
  "claude-3.5", "claude-4", "llava", "pixtral", "qwen-vl",
  "qwen2-vl", "internvl", "cogvlm", "moondream",
];

/**
 * Check if a model likely supports image/vision input.
 * Uses model ID and architecture info from OpenRouter metadata.
 */
export function supportsVision(model) {
  const id = model.id.toLowerCase();
  // OpenRouter models may have an architecture.modality field
  const modality = model.architecture?.modality || "";
  if (modality.includes("image") || modality.includes("multimodal")) return true;
  return VISION_PATTERNS.some((p) => id.includes(p));
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

export function supportsVideo(model) {
  // Explicit flag set by our provider router (HF video gen models)
  if (model?._isVideoGen) return true;
  const id = model.id.toLowerCase();
  const modality = model.architecture?.modality || "";
  // Only models that OUTPUT video — "text+video->text" VL models must NOT match
  if (modality.includes("->video")) return true;
  return TEXT_TO_VIDEO_PATTERNS.some((p) => id.includes(p));
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
      return supportsVideo(model);
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

export function filterModelsForTask(models, taskId) {
  return models.filter((m) => supportsTask(m, taskId));
}

export function uiTaskToAdvisorTask(taskId, text = "", uploads = [], attachedFiles = []) {
  if (taskId === "image-to-text" || taskId === "any-to-any") return "vision";
  if (taskId === "text-generation") return detectTaskType(text, uploads, attachedFiles);
  return "general";
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

/**
 * Given models and context, return a recommendation.
 *
 * @param {Array} models - All available OpenRouter models
 * @param {string} taskType - "vision"|"document"|"coding"|"general"
 * @param {string} currentModelId - Currently selected model ID
 * @param {"auto"|"free"|"paid"} preference - "free" = only free, "paid" = only paid, "auto" = free first
 * @returns {{ recommended: object|null, free: object|null, paid: object|null,
 *             currentOk: boolean, reason: string, taskType: string }}
 */
export function selectSmartModel(models, taskType, currentModelId, preference = "auto") {
  if (!models.length) {
    return { recommended: null, free: null, paid: null, currentOk: false, reason: "", taskType };
  }

  // 1. Filter by capability
  let capable;
  if (taskType === "vision") {
    capable = models.filter(supportsVision);
  } else if (TASK_OPTIONS.some((t) => t.id === taskType)) {
    capable = models.filter((m) => supportsTask(m, taskType));
  } else {
    capable = [...models]; // all models handle text/document/coding
  }

  if (capable.length === 0) {
    return { recommended: null, free: null, paid: null, currentOk: false, reason: "No capable models found", taskType };
  }

  // 2. Split free / paid, sorted by quality (param-size-aware)
  const sortByQuality = (a, b) => qualityScore(b) - qualityScore(a);
  const freeModels = capable.filter(isFreeModel).sort(sortByQuality);
  const paidModels = capable.filter((m) => !isFreeModel(m)).sort(sortByQuality);

  const bestFree = freeModels[0] || null;
  const bestPaid = paidModels[0] || null;

  // 3. Check if current model is capable
  const currentModel = models.find((m) => (m._selectionId || m.id) === currentModelId || m.id === currentModelId);
  const currentCapable = currentModel
    ? (taskType === "vision"
        ? supportsVision(currentModel)
        : TASK_OPTIONS.some((t) => t.id === taskType)
          ? supportsTask(currentModel, taskType)
          : true)
    : false;

  // 4. Determine recommendation based on preference
  let recommended = null;
  let reason = "";

  if (currentCapable) {
    recommended = currentModel;
    reason = "";
  } else if (preference === "free") {
    // Only suggest free models
    if (bestFree) {
      recommended = bestFree;
      const params = extractParamBillions(bestFree);
      const paramInfo = params > 0 ? ` (${params}B params)` : "";
      reason = taskType === "vision"
        ? `Your current model doesn't support images. Switch to a free vision model${paramInfo}?`
        : `Switching to a higher-quality free model${paramInfo}.`;
    } else {
      reason = "No free models available for this task.";
    }
  } else if (preference === "paid") {
    // Only suggest paid models
    if (bestPaid) {
      recommended = bestPaid;
      const params = extractParamBillions(bestPaid);
      const paramInfo = params > 0 ? ` (${params}B params)` : "";
      reason = taskType === "vision"
        ? `Your current model doesn't support images. Switch to a top paid vision model${paramInfo}?`
        : `Switch to a top paid model${paramInfo} for best quality.`;
    } else {
      reason = "No paid models available for this task.";
    }
  } else {
    // "auto" — prefer free, fallback to paid
    if (bestFree) {
      recommended = bestFree;
      const params = extractParamBillions(bestFree);
      const paramInfo = params > 0 ? ` (${params}B params)` : "";
      reason = taskType === "vision"
        ? `Your current model doesn't support images. Switch to a free vision model${paramInfo}?`
        : "";
    } else if (bestPaid) {
      recommended = bestPaid;
      const params = extractParamBillions(bestPaid);
      const paramInfo = params > 0 ? ` (${params}B params)` : "";
      reason = taskType === "vision"
        ? `Image support requires a paid model${paramInfo}.`
        : `This task requires a paid model${paramInfo}.`;
    }
  }

  return {
    recommended,
    free: bestFree,
    paid: bestPaid,
    currentOk: currentCapable,
    reason,
    taskType,
  };
}
