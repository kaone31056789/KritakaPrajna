import { importTheme, exportTheme, appearanceStore, deleteCustomTheme, DEFAULTS, resolveMode } from "./appearance";

/* The two things that turn user data into a broken interface: a stored blob
   from an older build, and an imported file written by anyone at all. */

describe("importTheme validates before it applies", () => {
  const created = [];
  const keep = (r) => {
    if (r.ok) created.push(r.id);
    return r;
  };
  afterEach(() => {
    created.splice(0).forEach(deleteCustomTheme);
  });

  test("refuses input that is not a theme at all", () => {
    expect(importTheme("not json").ok).toBe(false);
    expect(importTheme("[1,2,3]").ok).toBe(false);
    expect(importTheme('{"kind":"someone-elses-theme","tokens":{"accent":"#fff"}}').ok).toBe(false);
    expect(importTheme('{"tokens":{}}').ok).toBe(false);
  });

  test("keeps the valid tokens and drops the rest, rather than failing whole", () => {
    const r = keep(
      importTheme({
        name: "Mixed",
        tokens: {
          accent: "#ffb454",
          bg: "rgb(10, 12, 16)",
          text: "javascript:alert(1)", // not a colour
          err: "url(http://evil/x.png)", // not a colour
          notARealToken: "#ffffff", // not in the allowlist
        },
      })
    );
    expect(r.ok).toBe(true);
    expect(r.imported).toBe(2);
    expect(r.rejected.sort()).toEqual(["err", "text"]);
    const saved = appearanceStore.get().custom[r.id];
    expect(saved.tokens).toEqual({ accent: "#ffb454", bg: "rgb(10, 12, 16)" });
    expect(saved.tokens.text).toBeUndefined();
  });

  test("a name from a file cannot run away with the UI", () => {
    const r = keep(importTheme({ name: "x".repeat(500), tokens: { accent: "#fff" } }));
    expect(appearanceStore.get().custom[r.id].name.length).toBeLessThanOrEqual(40);
  });

  test("export round-trips back through import", () => {
    const a = keep(importTheme({ name: "Round trip", tokens: { accent: "#123456", bg: "#654321" } }));
    const b = keep(importTheme(exportTheme(a.id)));
    expect(appearanceStore.get().custom[b.id].tokens).toEqual({ accent: "#123456", bg: "#654321" });
  });

  test("exporting something that does not exist is empty, not a crash", () => {
    expect(exportTheme("no-such-theme")).toBe("");
  });
});

describe("stored settings are treated as untrusted", () => {
  test("every group has a default to fall back to", () => {
    for (const g of ["shape", "type", "motion", "background", "a11y"]) {
      expect(DEFAULTS[g]).toBeTruthy();
      expect(Object.keys(DEFAULTS[g]).length).toBeGreaterThan(0);
    }
  });

  test("the live state kept every default group after boot", () => {
    const s = appearanceStore.get();
    for (const g of ["shape", "type", "motion", "background", "a11y"]) {
      expect(Object.keys(s[g]).sort()).toEqual(Object.keys(DEFAULTS[g]).sort());
    }
  });
});

describe("modes resolve to one of the two palettes", () => {
  test("the three derived modes land on dark or light", () => {
    for (const m of ["system", "auto", "oled", "dark", "light"]) {
      expect(["dark", "light"]).toContain(resolveMode(m));
    }
  });

  test("OLED is a dark mode, and anything unknown is too", () => {
    expect(resolveMode("oled")).toBe("dark");
    expect(resolveMode("nonsense")).toBe("dark");
    expect(resolveMode("light")).toBe("light");
  });
});
