import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const STATUS_MESSAGES = {
  checking: "Checking for updates…",
  available: "Update available!",
  downloading: "Downloading update…",
  downloaded: "Update ready — restarting soon",
  "not-available": null,
  error: null,
};

export default function UpdateBanner() {
  const [update, setUpdate] = useState(null);

  useEffect(() => {
    if (!window.electronAPI?.onUpdateStatus) return;
    const unsub = window.electronAPI.onUpdateStatus(({ status, data }) => {
      if (status === "not-available" || status === "error") {
        // auto-dismiss after a brief flash
        setUpdate({ status, data });
        const t = setTimeout(() => setUpdate(null), 3000);
        return () => clearTimeout(t);
      }
      setUpdate({ status, data });
      if (status === "downloaded") {
        setTimeout(() => setUpdate(null), 5000);
      }
    });
    return unsub;
  }, []);

  const message = update
    ? update.status === "downloading"
      ? `Downloading update… ${update.data ?? 0}%`
      : update.status === "available"
        ? `Update v${update.data} available — downloading…`
        : update.status === "error"
          ? "Update check failed"
          : STATUS_MESSAGES[update.status]
    : null;

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="overflow-hidden"
        >
          <div className="flex items-center justify-center gap-2 px-3 py-1.5 bg-accent-600/90 text-white text-xs font-medium">
            {update.status === "downloading" && (
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
            {update.status === "checking" && (
              <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
            {message}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
