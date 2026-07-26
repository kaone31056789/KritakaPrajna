import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
// Imported for its side effect and imported early on purpose: the module stamps
// the saved appearance onto <html> at import time, so the first paint is already
// the user's theme rather than the default flashing past it.
import "./core/appearance";
import { initAgentWorkspace } from "./core/agent";

// Re-arm the main-process file scope for a restored workspace so the Files tab
// and write_file work immediately, before the user re-picks the folder.
try { initAgentWorkspace(); } catch {}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
