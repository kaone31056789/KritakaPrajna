import { createStore } from "./store";

/* ═══ Updates ═══════════════════════════════════════════════════════════════
   The app publishes to GitHub Releases (package.json → build.publish), and
   electron-updater in the main process watches that feed. All of that already
   existed; this is only the renderer's view of it — which version is running,
   and whatever the main process last reported.

   The version comes from app.getVersion() rather than a constant in this file
   on purpose: that is the version actually installed, so it cannot drift out
   of step with package.json. Running in a browser there is no bridge at all,
   so the store says "dev" rather than inventing a number.
   ═══════════════════════════════════════════════════════════════════════════ */

const api = () => (typeof window !== "undefined" ? window.electronAPI : null);

export const updatesStore = createStore({
  version: "", // "" until the main process answers; "dev" outside Electron
  status: "", // checking | available | downloading | downloaded | not-available | error
  info: "", // the new version, a percentage, or an error message
  packaged: !!api()?.getAppVersion,
});

if (api()?.getAppVersion) {
  api()
    .getAppVersion()
    .then((v) => updatesStore.set({ version: v || "" }))
    .catch(() => updatesStore.set({ version: "" }));
  api()?.onUpdateStatus?.(({ status, data }) =>
    updatesStore.set({ status: status || "", info: data == null ? "" : String(data) })
  );
} else {
  updatesStore.set({ version: "dev" });
}

export function checkForUpdates() {
  if (!api()?.checkForUpdates) return;
  updatesStore.set({ status: "checking", info: "" });
  api().checkForUpdates();
}

export function restartAndInstall() {
  api()?.restartAndInstall?.();
}

/** What clicking the footer should do, given where the update is up to. */
export function updateAction(status) {
  return status === "downloaded" ? restartAndInstall : checkForUpdates;
}

/** What the footer says, and whether it wants attention. */
export function updateLabel({ status, info, version, packaged }) {
  switch (status) {
    case "checking":
      return { text: "checking…", tone: "busy", hint: "Looking for a newer release on GitHub" };
    case "available":
      return { text: `v${info}`, tone: "busy", hint: `Version ${info} found — downloading it now` };
    case "downloading":
      return { text: `${info}%`, tone: "busy", hint: `Downloading the update — ${info}% done` };
    case "downloaded":
      return {
        text: "restart",
        tone: "alert",
        hint: `Version ${info} is installed and starts next time you open the app — click to restart now`,
      };
    case "error":
      return { text: `v${version}`, tone: "idle", hint: `Update check failed: ${info}` };
    case "not-available":
      return { text: `v${version}`, tone: "ok", hint: "You are on the latest release" };
    default:
      return {
        text: version ? (version === "dev" ? "dev" : `v${version}`) : "",
        tone: "idle",
        hint: packaged ? "Click to check GitHub for a new version" : "Development build — updates are checked in the installed app",
      };
  }
}
