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

export default function App() {
  const [apiKey, setApiKey] = useState(null);
  const [keyLoaded, setKeyLoaded] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  // Load API key from secure store on mount
  useEffect(() => {
    const load = async () => {
      if (window.electronAPI?.getApiKey) {
        const key = await window.electronAPI.getApiKey();
        if (key) setApiKey(key);
      } else {
        // Fallback for browser dev (migrate from localStorage)
        const key = localStorage.getItem("openrouter_key");
        if (key) setApiKey(key);
      }
      setKeyLoaded(true);
    };
    load();
  }, []);

  const handleSaveKey = async (key) => {
    if (window.electronAPI?.setApiKey) {
      await window.electronAPI.setApiKey(key);
    } else {
      localStorage.setItem("openrouter_key", key);
    }
    setApiKey(key);
  };

  const handleResetKey = async () => {
    if (window.electronAPI?.removeApiKey) {
      await window.electronAPI.removeApiKey();
    } else {
      localStorage.removeItem("openrouter_key");
    }
    setApiKey(null);
  };

  const handleSplashDone = useCallback(() => setShowSplash(false), []);

  return (
    <AnimatePresence mode="wait">
      {showSplash || !keyLoaded ? (
        <motion.div key="splash" {...pageTransition}>
          <SplashScreen onDone={handleSplashDone} />
        </motion.div>
      ) : !apiKey ? (
        <motion.div key="apikey" {...pageTransition}>
          <ApiKeyScreen onSave={handleSaveKey} />
        </motion.div>
      ) : (
        <motion.div key="chat" {...pageTransition} className="h-screen flex flex-col">
          <UpdateBanner />
          <div className="flex-1 min-h-0">
            <ChatApp apiKey={apiKey} onSaveKey={handleSaveKey} onResetKey={handleResetKey} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
