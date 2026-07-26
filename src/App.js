import React, { useEffect, useState } from "react";
import { useStore } from "./core/store";
import { keysStore, loadProviderKeys, hasAnyKey } from "./core/keys";
import { loadModels } from "./core/models";
import { loadMemory } from "./core/memory";
import Splash from "./screens/Splash";
import Onboarding from "./screens/Onboarding";
import Shell from "./screens/Shell";

export default function App() {
  const [splashDone, setSplashDone] = useState(false);
  const { providers, loaded } = useStore(keysStore, (s) => ({
    providers: s.providers,
    loaded: s.loaded,
  }));

  useEffect(() => {
    loadProviderKeys();
    loadMemory();
  }, []);

  // Uniform auto-zoom — the UI is designed comfortable at ~1280×800; in smaller
  // windows everything felt oversized and cramped. Chromium supports CSS zoom on
  // the root element, which scales the whole app proportionally (text, spacing,
  // shadows) without any per-component media queries.
  useEffect(() => {
    const DESIGN_W = 1280;
    const DESIGN_H = 800;
    let raf = 0;
    const apply = () => {
      const z = Math.min(1, Math.max(0.72, Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H)));
      document.documentElement.style.zoom = z >= 0.99 ? "" : String(Math.round(z * 100) / 100);
    };
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.documentElement.style.zoom = "";
    };
  }, []);

  // (Re)load the model catalog whenever provider keys change
  useEffect(() => {
    if (loaded && hasAnyKey(providers)) loadModels(providers);
  }, [loaded, providers]);

  if (!splashDone || !loaded) return <Splash onDone={() => setSplashDone(true)} />;
  if (!hasAnyKey(providers)) return <Onboarding onDone={() => {}} />;
  return <Shell />;
}
