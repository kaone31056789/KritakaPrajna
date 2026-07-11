import React, { useMemo, useState } from "react";
import { useStore } from "../../core/store";
import {
  promptsStore,
  createPrompt,
  updatePrompt,
  deletePrompt,
  recordPromptUse,
  searchPrompts,
} from "../../core/prompts";
import { NeuModal, NeuButton, NeuInput, NeuTextArea, NeuBadge, EmptyState } from "../../ui/primitives";
import Icon from "../../ui/icons";
import { toast } from "../../ui/Toaster";

/* Prompt Library — save, search, and insert reusable prompts from the composer. */

const EMPTY_FORM = { title: "", tags: "", body: "" };

export default function PromptLibrary({ open, onClose, draft = "", onInsert }) {
  const { prompts } = useStore(promptsStore);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null); // null | "new" | prompt id
  const [form, setForm] = useState(EMPTY_FORM);
  const [confirmDel, setConfirmDel] = useState("");

  const results = useMemo(() => searchPrompts(prompts, query), [prompts, query]);

  const startNew = (body = "") => {
    setForm({ ...EMPTY_FORM, body });
    setEditing("new");
  };
  const startEdit = (p) => {
    setForm({ title: p.title, tags: (p.tags || []).join(", "), body: p.body });
    setEditing(p.id);
  };
  const closeEditor = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
  };

  const saveForm = () => {
    if (!form.body.trim()) {
      toast.error("Prompt body is empty");
      return;
    }
    const tags = form.tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 6);
    if (editing === "new") {
      createPrompt({ title: form.title, body: form.body, tags });
      toast.success("Prompt saved");
    } else {
      updatePrompt(editing, { title: form.title.trim() || "Untitled prompt", body: form.body, tags });
      toast.success("Prompt updated");
    }
    closeEditor();
  };

  const insert = (p) => {
    recordPromptUse(p.id);
    onInsert?.(p.body);
    onClose?.();
  };

  const handleClose = () => {
    closeEditor();
    setConfirmDel("");
    setQuery("");
    onClose?.();
  };

  return (
    <NeuModal
      open={open}
      onClose={handleClose}
      title={editing ? (editing === "new" ? "New prompt" : "Edit prompt") : "Prompt library"}
      width={560}
      footer={
        editing ? (
          <>
            <NeuButton size="sm" onClick={closeEditor}>Cancel</NeuButton>
            <NeuButton size="sm" variant="accent" onClick={saveForm}>Save prompt</NeuButton>
          </>
        ) : null
      }
    >
      {editing ? (
        <div className="flex flex-col gap-3">
          <NeuInput
            label="Title"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="e.g. Code review"
            autoFocus
          />
          <NeuInput
            label="Tags (comma separated)"
            value={form.tags}
            onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
            placeholder="writing, code"
          />
          <NeuTextArea
            label="Prompt"
            value={form.body}
            onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
            rows={8}
            placeholder="The prompt text inserted into the composer…"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <NeuInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search prompts…"
                autoFocus
              />
            </div>
            {draft.trim() && (
              <NeuButton size="sm" onClick={() => startNew(draft)}>Save draft</NeuButton>
            )}
            <NeuButton size="sm" variant="accent" onClick={() => startNew()}>New</NeuButton>
          </div>

          {results.length === 0 ? (
            <EmptyState
              icon="bookmark"
              title={query ? "No prompts match" : "No prompts yet"}
              hint={query ? "Try another search." : "Save prompts you reuse — they insert straight into the composer."}
              className="py-8"
            />
          ) : (
            <div className="flex flex-col gap-1.5 max-h-[48vh] overflow-y-auto pr-1">
              {results.map((p) => (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => insert(p)}
                  onKeyDown={(e) => e.key === "Enter" && insert(p)}
                  className="group text-left w-full rounded-sm px-3 py-2.5 cursor-pointer hover:bg-surface-2 transition-colors relative"
                >
                  <div className="flex items-center gap-2 pr-14">
                    <span className="text-[13px] font-semibold text-hi truncate">{p.title}</span>
                    {(p.tags || []).slice(0, 3).map((t) => (
                      <NeuBadge key={t} className="shrink-0">{t}</NeuBadge>
                    ))}
                    {p.uses > 0 && (
                      <span className="text-[10.5px] text-faint shrink-0 ml-auto">used {p.uses}×</span>
                    )}
                  </div>
                  <p className="text-[12px] text-dim mt-0.5 line-clamp-2 whitespace-pre-wrap break-words pr-14">
                    {p.body}
                  </p>
                  <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      aria-label="Edit prompt"
                      title="Edit"
                      onClick={(e) => { e.stopPropagation(); startEdit(p); }}
                      className="w-6 h-6 rounded-xs flex items-center justify-center text-faint hover:text-body"
                    >
                      <Icon name="edit" size={12} />
                    </button>
                    <button
                      type="button"
                      aria-label={confirmDel === p.id ? "Click again to confirm delete" : "Delete prompt"}
                      title={confirmDel === p.id ? "Click again to confirm" : "Delete"}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirmDel === p.id) {
                          deletePrompt(p.id);
                          setConfirmDel("");
                          toast.success("Prompt deleted");
                        } else {
                          setConfirmDel(p.id);
                          setTimeout(() => setConfirmDel((c) => (c === p.id ? "" : c)), 2500);
                        }
                      }}
                      className={`w-6 h-6 rounded-xs flex items-center justify-center ${
                        confirmDel === p.id ? "text-err" : "text-faint hover:text-err"
                      }`}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </NeuModal>
  );
}
