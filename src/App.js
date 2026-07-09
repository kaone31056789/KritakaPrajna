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

  // (Re)load the model catalog whenever provider keys change
  useEffect(() => {
    if (loaded && hasAnyKey(providers)) loadModels(providers);
  }, [loaded, providers]);

  if (!splashDone || !loaded) return <Splash onDone={() => setSplashDone(true)} />;
  if (!hasAnyKey(providers)) return <Onboarding onDone={() => {}} />;
  return <Shell />;
}
