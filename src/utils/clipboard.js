function fallbackCopyWithExecCommand(text) {
  if (typeof document === "undefined") return false;

  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  area.style.pointerEvents = "none";

  document.body.appendChild(area);
  area.focus();
  area.select();
  area.setSelectionRange(0, text.length);

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }

  document.body.removeChild(area);
  return ok;
}

/**
 * Copy text safely across browser and Electron contexts.
 * Returns true on success, false when all strategies fail.
 */
export async function safeCopyText(input) {
  const text = typeof input === "string" ? input : String(input ?? "");
  if (!text) return false;

  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
  }

  if (window?.electronAPI?.writeClipboardText) {
    try {
      const result = await window.electronAPI.writeClipboardText(text);
      if (result?.ok) return true;
    } catch {}
  }

  return fallbackCopyWithExecCommand(text);
}
