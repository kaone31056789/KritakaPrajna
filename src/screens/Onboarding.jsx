import React, { useState } from "react";
import { motion } from "framer-motion";
import { PROVIDER_META } from "../api/providerRouter";
import { setProviderKey } from "../core/keys";
import { EASE_OUT, T_SLOW } from "../design/motion";
import Icon from "../ui/icons";
import { NeuButton, GradientOrb } from "../ui/primitives";
import { toast } from "../ui/Toaster";

/* First-run onboarding — connect at least one provider. */

const PROVIDER_HINTS = {
  openrouter: "openrouter.ai/keys — one key, hundreds of models",
  openai: "platform.openai.com/api-keys",
  anthropic: "console.anthropic.com/settings/keys",
  huggingface: "huggingface.co/settings/tokens",
  ollama: "Local endpoint, e.g. http://localhost:11434",
  nvidia: "build.nvidia.com — NIM API key",
};

function ProviderCard({ id, value, onChange }) {
  const meta = PROVIDER_META[id];
  const [show, setShow] = useState(false);
  const filled = !!value?.trim();
  return (
    <motion.div
      variants={{
        initial: { opacity: 0, y: 14 },
        animate: { opacity: 1, y: 0, transition: { duration: T_SLOW, ease: EASE_OUT } },
      }}
      className={`neu-raised rounded-lg p-5 flex flex-col gap-3 ${filled ? "[box-shadow:var(--neu-raised),0_0_0_1.5px_var(--accent-soft)]" : ""}`}
    >
      <div className="flex items-center gap-3">
        <GradientOrb seed={`provider-${id}`} size={30} glow={filled} />
        <div className="flex-1 min-w-0">
          <p className="font-display font-semibold text-[14px] text-hi">{meta.label}</p>
          <p className="text-[10.5px] text-faint truncate">{PROVIDER_HINTS[id]}</p>
        </div>
        {filled && <Icon name="check" size={16} className="text-ok shrink-0" />}
      </div>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={id === "ollama" ? "http://localhost:11434" : "Paste API key"}
          className="w-full h-10 rounded-sm bg-deep [box-shadow:var(--neu-inset-sm)] border-none outline-none text-[12.5px] font-mono text-hi placeholder:text-faint pl-4 pr-10 focus:[box-shadow:var(--neu-inset-sm),var(--neu-focus)]"
          style={{ transition: "box-shadow 150ms var(--ease-out)" }}
        />
        <button
          type="button"
          aria-label={show ? "Hide key" : "Show key"}
          onClick={() => setShow((s) => !s)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint hover:text-body"
        >
          <Icon name={show ? "eyeOff" : "eye"} size={14} />
        </button>
      </div>
    </motion.div>
  );
}

export default function Onboarding({ onDone }) {
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(false);
  const anyFilled = Object.values(drafts).some((v) => v?.trim());

  const save = async () => {
    setSaving(true);
    try {
      const entries = Object.entries(drafts).filter(([, v]) => v?.trim());
      for (const [provider, key] of entries) {
        await setProviderKey(provider, key.trim());
      }
      toast.success(`${entries.length} provider${entries.length > 1 ? "s" : ""} connected`);
      onDone?.();
    } catch (err) {
      toast.error("Could not save keys", { description: String(err?.message || "") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-screen overflow-y-auto bg-bg">
      <div className="aurora" />
      <div className="relative max-w-[820px] mx-auto px-8 py-14">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: EASE_OUT }}
          className="text-center mb-10"
        >
          <span className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 mb-5 text-[10px] uppercase tracking-[0.2em] font-semibold text-accent bg-accent-soft">
            <Icon name="spark" size={11} /> Welcome
          </span>
          <h1 className="font-display font-bold text-[30px] text-hi leading-tight">
            Connect your AI providers
          </h1>
          <p className="mt-2.5 text-[13.5px] text-dim max-w-[440px] mx-auto leading-relaxed">
            Add at least one key to start. Keys are stored locally on this machine — never sent
            anywhere except the provider itself.
          </p>
        </motion.div>

        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
          initial="initial"
          animate="animate"
          variants={{ animate: { transition: { staggerChildren: 0.06, delayChildren: 0.15 } } }}
        >
          {Object.keys(PROVIDER_META).map((id) => (
            <ProviderCard
              key={id}
              id={id}
              value={drafts[id]}
              onChange={(v) => setDrafts((d) => ({ ...d, [id]: v }))}
            />
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.3 }}
          className="flex justify-center mt-10"
        >
          <NeuButton
            variant="accent"
            size="lg"
            iconRight="arrowUpRight"
            disabled={!anyFilled}
            loading={saving}
            onClick={save}
            className="min-w-[220px]"
          >
            Enter KritakaPrajna
          </NeuButton>
        </motion.div>
      </div>
    </div>
  );
}
