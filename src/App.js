import React, { useState, useCallback, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ApiKeyScreen from "./components/ApiKeyScreen";
import ChatApp from "./components/ChatApp";
import SplashScreen from "./components/SplashScreen";
import UpdateBanner from "./components/UpdateBanner";

const pageTransition = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] },
};

const EMPTY_PROVIDERS = { openrouter: null, openai: null, anthropic: null, huggingface: null, ollama: null };

async function loadAllProviderKeys() {
  if (window.electronAPI?.getAllProviderKeys) {
    return await window.electronAPI.getAllProviderKeys();
  }
  // Browser dev fallback — migrate from localStorage single key
  return {
    openrouter:  localStorage.getItem("openrouter_key")       || null,
    openai:      localStorage.getItem("openai_key")           || null,
    anthropic:   localStorage.getItem("anthropic_key")        || null,
    huggingface: localStorage.getItem("huggingface_key")      || null,
    ollama:      localStorage.getItem("ollama_key")           || null,
  };
}

async function saveAllProviderKeys(providers) {
  for (const [provider, key] of Object.entries(providers)) {
    if (key) {
      if (window.electronAPI?.setProviderKey) {
        await window.electronAPI.setProviderKey(provider, key);
      } else {
        localStorage.setItem(`${provider}_key`, key);
      }
    }
  }
}

async function removeProviderKey(provider) {
  if (window.electronAPI?.removeProviderKey) {
    await window.electronAPI.removeProviderKey(provider);
  } else {
    localStorage.removeItem(`${provider}_key`);
  }
}

function hasAnyKey(providers) {
  return Object.values(providers).some((k) => !!k);
}

export default function App() {
  const [providers, setProviders] = useState(EMPTY_PROVIDERS);
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  // Load all provider keys on mount
  useEffect(() => {
    loadAllProviderKeys().then((keys) => {
      setProviders({ ...EMPTY_PROVIDERS, ...keys });
      setKeysLoaded(true);
    });
  }, []);

  const handleSaveProviders = useCallback(async (newKeys) => {
    await saveAllProviderKeys(newKeys);
    // Re-load to get the fully merged state (existing + new)
    const merged = await loadAllProviderKeys();
    setProviders({ ...EMPTY_PROVIDERS, ...merged });
  }, []);

  const handleSaveProviderKey = useCallback(async (provider, key) => {
    if (window.electronAPI?.setProviderKey) {
      await window.electronAPI.setProviderKey(provider, key);
    } else {
      localStorage.setItem(`${provider}_key`, key);
    }
    setProviders((prev) => ({ ...prev, [provider]: key }));
  }, []);

  const handleRemoveProviderKey = useCallback(async (provider) => {
    await removeProviderKey(provider);
    setProviders((prev) => ({ ...prev, [provider]: null }));
  }, []);

  const handleResetAll = useCallback(async () => {
    for (const p of Object.keys(EMPTY_PROVIDERS)) {
      await removeProviderKey(p);
    }
    setProviders(EMPTY_PROVIDERS);
  }, []);

  const handleSplashDone = useCallback(() => setShowSplash(false), []);

  const ready = keysLoaded && !showSplash;

  return (
    <AnimatePresence mode="wait">
      {!ready ? (
        <motion.div key="splash" {...pageTransition}>
          <SplashScreen onDone={handleSplashDone} />
        </motion.div>
      ) : !hasAnyKey(providers) ? (
        <motion.div key="apikey" {...pageTransition}>
          <ApiKeyScreen onSave={handleSaveProviders} initialProviders={providers} />
        </motion.div>
      ) : (
        <motion.div key="chat" {...pageTransition} className="h-screen flex flex-col">
          <UpdateBanner />
          <div className="flex-1 min-h-0">
            <ChatApp
              providers={providers}
              onSaveProviderKey={handleSaveProviderKey}
              onRemoveProviderKey={handleRemoveProviderKey}
              onResetAll={handleResetAll}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
