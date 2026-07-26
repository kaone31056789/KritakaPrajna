import { updateLabel, updateAction, checkForUpdates, restartAndInstall } from "./updates";

/* The renderer half of auto-update. The Electron half needs a packaged build to
   exercise; this covers the part that decides what the footer says and what
   clicking it does — which is where a wrong branch would silently mean the
   button lies about its own label. */

const state = (over) => ({ version: "4.0.0", status: "", info: "", packaged: true, ...over });

describe("updateLabel", () => {
  test("idle shows the running version", () => {
    expect(updateLabel(state()).text).toBe("v4.0.0");
  });

  test("outside Electron it says dev and offers nothing", () => {
    const l = updateLabel(state({ version: "dev", packaged: false }));
    expect(l.text).toBe("dev");
    expect(l.hint).toMatch(/installed app/i);
  });

  test("available reads as downloading, because it is", () => {
    // autoDownload is on, so "available" is never a prompt to fetch.
    const l = updateLabel(state({ status: "available", info: "4.1.0" }));
    expect(l.hint).toMatch(/downloading/i);
    expect(l.hint).not.toMatch(/click|prompt/i);
  });

  test("progress and the ready state are distinguishable at a glance", () => {
    expect(updateLabel(state({ status: "downloading", info: "42" })).text).toBe("42%");
    const ready = updateLabel(state({ status: "downloaded", info: "4.1.0" }));
    expect(ready.text).toBe("restart");
    expect(ready.tone).toBe("alert");
  });

  test("a failed check falls back to the version rather than going blank", () => {
    const l = updateLabel(state({ status: "error", info: "getaddrinfo ENOTFOUND" }));
    expect(l.text).toBe("v4.0.0");
    expect(l.hint).toMatch(/ENOTFOUND/);
  });

  test("up to date says so", () => {
    const l = updateLabel(state({ status: "not-available" }));
    expect(l.text).toBe("v4.0.0");
    expect(l.tone).toBe("ok");
  });
});

describe("updateAction", () => {
  test("only the downloaded state restarts; everything else re-checks", () => {
    expect(updateAction("downloaded")).toBe(restartAndInstall);
    for (const s of ["", "checking", "available", "downloading", "not-available", "error"]) {
      expect(updateAction(s)).toBe(checkForUpdates);
    }
  });
});
