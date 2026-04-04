const PROVIDER_USAGE_KEY = "openrouter_provider_usage_v1";

function emptyProvider(provider) {
  return {
    provider,
    requests: 0,
    cost: 0,
    promptTokens: 0,
    completionTokens: 0,
  };
}

export function loadProviderUsage() {
  try {
    const raw = localStorage.getItem(PROVIDER_USAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveProviderUsage(data) {
  try {
    localStorage.setItem(PROVIDER_USAGE_KEY, JSON.stringify(data));
  } catch {}
}

export function recordProviderUsage(provider, usage = {}, cost = 0) {
  const current = loadProviderUsage();
  const next = { ...current };
  const bucket = { ...emptyProvider(provider), ...(next[provider] || {}) };

  bucket.requests += 1;
  bucket.cost += Number(cost) || 0;
  bucket.promptTokens += Number(usage?.prompt_tokens) || 0;
  bucket.completionTokens += Number(usage?.completion_tokens) || 0;

  next[provider] = bucket;
  saveProviderUsage(next);
  return next;
}

export function providerUsageRows(usageMap = {}, providers = []) {
  return providers.map((provider) => ({ ...emptyProvider(provider), ...(usageMap[provider] || {}) }));
}
