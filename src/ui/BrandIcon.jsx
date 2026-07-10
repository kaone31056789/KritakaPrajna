// Real provider/vendor logos with graceful fallback to the gradient orb.
// Resolves a brand domain from a model (vendor prefix of the id) or an
// explicit provider key, then loads its favicon. Failures are cached per
// domain for the session so we never flash retries.
import React, { useState } from "react";
import { GradientOrb } from "./primitives";

const VENDOR_DOMAINS = {
  openai: "openai.com",
  anthropic: "anthropic.com",
  google: "google.com",
  "meta-llama": "meta.com",
  meta: "meta.com",
  mistralai: "mistral.ai",
  mistral: "mistral.ai",
  deepseek: "deepseek.com",
  "deepseek-ai": "deepseek.com",
  "x-ai": "x.ai",
  xai: "x.ai",
  qwen: "alibabacloud.com",
  alibaba: "alibabacloud.com",
  cohere: "cohere.com",
  cohereforai: "cohere.com",
  perplexity: "perplexity.ai",
  microsoft: "microsoft.com",
  amazon: "amazon.com",
  nvidia: "nvidia.com",
  moonshotai: "moonshot.cn",
  "z-ai": "z.ai",
  "zai-org": "z.ai",
  zhipuai: "z.ai",
  thudm: "z.ai",
  minimax: "minimax.io",
  minimaxai: "minimax.io",
  ai21: "ai21.com",
  ai21labs: "ai21.com",
  baidu: "baidu.com",
  tencent: "tencent.com",
  bytedance: "bytedance.com",
  liquid: "liquid.ai",
  nousresearch: "nousresearch.com",
  inflection: "inflection.ai",
  "01-ai": "01.ai",
  openrouter: "openrouter.ai",
  "ibm-granite": "ibm.com",
  ibm: "ibm.com",
  tiiuae: "tii.ae",
  stabilityai: "stability.ai",
  allenai: "allenai.org",
  bigcode: "huggingface.co",
  huggingfaceh4: "huggingface.co",
  xiaomi: "mi.com",
  stepfun: "stepfun.com",
  "stepfun-ai": "stepfun.com",
  baichuan: "baichuan-ai.com",
  "baichuan-inc": "baichuan-ai.com",
  upstage: "upstage.ai",
  sarvamai: "sarvam.ai",
  sarvam: "sarvam.ai",
  rakuten: "rakuten.com",
  writer: "writer.com",
  snowflake: "snowflake.com",
  databricks: "databricks.com",
  "rekaai": "reka.ai",
  reka: "reka.ai",
  "arcee-ai": "arcee.ai",
  arcee: "arcee.ai",
  inception: "inceptionlabs.ai",
  tngtech: "tngtech.com",
  eleutherai: "eleuther.ai",
  openchat: "openchat.team",
  internlm: "intern-ai.org.cn",
  opengvlab: "intern-ai.org.cn",
  deepcogito: "deepcogito.com",
  featherless: "featherless.ai",
  "featherless-ai": "featherless.ai",
  morph: "morphllm.com",
  groq: "groq.com",
  togethercomputer: "together.ai",
  together: "together.ai",
  fireworks: "fireworks.ai",
  apple: "apple.com",
};

// Keyword → brand domain, matched against "name + id". Handles vendor
// checkpoints hosted elsewhere (HuggingFace, NVIDIA NIM, Ollama tags).
// Order matters: more specific families first.
const NAME_BRANDS = [
  ["deepseek", "deepseek.com"],
  ["gemini", "google.com"],
  ["gemma", "google.com"],
  ["claude", "anthropic.com"],
  ["gpt-", "openai.com"],
  ["chatgpt", "openai.com"],
  ["qwen", "alibabacloud.com"],
  ["qwq", "alibabacloud.com"],
  ["mixtral", "mistral.ai"],
  ["mistral", "mistral.ai"],
  ["ministral", "mistral.ai"],
  ["codestral", "mistral.ai"],
  ["devstral", "mistral.ai"],
  ["magistral", "mistral.ai"],
  ["llama", "meta.com"],
  ["grok", "x.ai"],
  ["phi-", "microsoft.com"],
  ["command", "cohere.com"],
  ["aya-", "cohere.com"],
  ["kimi", "moonshot.cn"],
  ["glm-", "z.ai"],
  ["hermes", "nousresearch.com"],
  ["granite", "ibm.com"],
  ["falcon", "tii.ae"],
  ["nemotron", "nvidia.com"],
  ["sonar", "perplexity.ai"],
  ["jamba", "ai21.com"],
  ["ernie", "baidu.com"],
  ["hunyuan", "tencent.com"],
  ["minimax", "minimax.io"],
  ["yi-", "01.ai"],
  ["olmo", "allenai.org"],
  ["smollm", "huggingface.co"],
  ["starcoder", "huggingface.co"],
  ["zephyr", "huggingface.co"],
  ["mimo", "mi.com"],
  ["step-", "stepfun.com"],
  ["baichuan", "baichuan-ai.com"],
  ["solar-", "upstage.ai"],
  ["palmyra", "writer.com"],
  ["arctic", "snowflake.com"],
  ["dbrx", "databricks.com"],
  ["mercury", "inceptionlabs.ai"],
  ["nova-", "amazon.com"],
  ["titan-", "amazon.com"],
  ["wizardlm", "microsoft.com"],
  ["mai-", "microsoft.com"],
  ["doubao", "bytedance.com"],
  ["seed-", "bytedance.com"],
  ["skylark", "bytedance.com"],
  ["lfm-", "liquid.ai"],
  ["lfm2", "liquid.ai"],
  ["intern", "intern-ai.org.cn"],
  ["cogito", "deepcogito.com"],
  ["pixtral", "mistral.ai"],
  ["deephermes", "nousresearch.com"],
  ["reka-", "reka.ai"],
  ["-r1t", "tngtech.com"],
];

const PROVIDER_DOMAINS = {
  openrouter: "openrouter.ai",
  openai: "openai.com",
  anthropic: "anthropic.com",
  huggingface: "huggingface.co",
  ollama: "ollama.com",
  nvidia: "nvidia.com",
};

// Domains whose icons failed to load this session.
const failedSources = new Set();

export function brandDomainForModel(model) {
  if (!model) return null;
  // 1) Vendor prefix of the id — the model's actual brand beats the host.
  const id = String(model.id || "").toLowerCase();
  const vendor = id.split("/")[0];
  if (VENDOR_DOMAINS[vendor]) return VENDOR_DOMAINS[vendor];
  // 2) Family keyword in the display name or id.
  const hay = ` ${String(model.name || "").toLowerCase()} ${id} `;
  for (const [kw, domain] of NAME_BRANDS) {
    if (hay.includes(kw)) return domain;
  }
  // 3) Hosting provider as a last resort.
  const provider = String(model.provider || "").toLowerCase();
  if (provider && provider !== "openrouter" && PROVIDER_DOMAINS[provider]) {
    return PROVIDER_DOMAINS[provider];
  }
  return null;
}

function sourcesFor(domain) {
  return [
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  ];
}

export default function BrandIcon({
  model = null,
  provider = null,
  seed = "",
  size = 20,
  className = "",
  glow = false,
}) {
  const domain = provider
    ? PROVIDER_DOMAINS[String(provider).toLowerCase()] || null
    : brandDomainForModel(model);
  const sources = domain ? sourcesFor(domain) : [];
  const firstLive = sources.findIndex((s) => !failedSources.has(s));
  const [step, setStep] = useState(firstLive === -1 ? sources.length : firstLive);

  const orbSeed = seed || model?.id || provider || "model";
  if (!domain || step >= sources.length) {
    return <GradientOrb seed={orbSeed} size={size} className={className} glow={glow} />;
  }

  const src = sources[step];
  const pad = Math.max(2, Math.round(size * 0.12));
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-surface-3 ${className}`}
      style={{
        width: size,
        height: size,
        boxShadow: glow
          ? "0 0 10px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.06)"
          : "inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.35)",
      }}
    >
      <img
        src={src}
        alt=""
        aria-hidden="true"
        draggable={false}
        loading="lazy"
        style={{
          width: size - pad * 2,
          height: size - pad * 2,
          borderRadius: "9999px",
          objectFit: "contain",
        }}
        onError={() => {
          failedSources.add(src);
          setStep((s) => s + 1);
        }}
      />
    </span>
  );
}
