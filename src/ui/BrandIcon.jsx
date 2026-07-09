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
  "x-ai": "x.ai",
  xai: "x.ai",
  qwen: "alibabacloud.com",
  cohere: "cohere.com",
  perplexity: "perplexity.ai",
  microsoft: "microsoft.com",
  amazon: "amazon.com",
  nvidia: "nvidia.com",
  moonshotai: "moonshot.cn",
  "z-ai": "z.ai",
  minimax: "minimax.io",
  ai21: "ai21.com",
  baidu: "baidu.com",
  tencent: "tencent.com",
  bytedance: "bytedance.com",
  liquid: "liquid.ai",
  nousresearch: "nousresearch.com",
  inflection: "inflection.ai",
  "01-ai": "01.ai",
  openrouter: "openrouter.ai",
};

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
  const provider = String(model.provider || "").toLowerCase();
  if (provider && provider !== "openrouter" && PROVIDER_DOMAINS[provider]) {
    return PROVIDER_DOMAINS[provider];
  }
  const vendor = String(model.id || "").split("/")[0].toLowerCase();
  return VENDOR_DOMAINS[vendor] || null;
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
