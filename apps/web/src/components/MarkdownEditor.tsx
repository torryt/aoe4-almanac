import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

type Mode = "edit" | "preview";

export function MarkdownEditor(props: {
  value: string;
  onChange: (v: string) => void;
  onSave?: () => void;
  saving?: boolean;
  placeholder?: string;
  minHeight?: number;
}) {
  const [mode, setMode] = useState<Mode>("edit");
  const [draft, setDraft] = useState(props.value);

  useEffect(() => {
    setDraft(props.value);
  }, [props.value]);

  const dirty = draft !== props.value;

  return (
    <div className="rounded-md border border-stone-300 bg-white">
      <div className="flex items-center justify-between border-b border-stone-200 px-2 py-1">
        <div className="flex gap-1">
          <TabButton active={mode === "edit"} onClick={() => setMode("edit")}>
            Edit
          </TabButton>
          <TabButton active={mode === "preview"} onClick={() => setMode("preview")}>
            Preview
          </TabButton>
        </div>
        {props.onSave && (
          <button
            type="button"
            disabled={!dirty || props.saving}
            onClick={() => {
              props.onChange(draft);
              props.onSave?.();
            }}
            className="rounded bg-stone-900 px-3 py-1 text-xs font-medium text-stone-50 disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            {props.saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        )}
      </div>
      {mode === "edit" ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={props.placeholder ?? "Write some notes (markdown supported)…"}
          className="block w-full resize-y bg-transparent p-3 font-mono text-sm outline-none"
          style={{ minHeight: props.minHeight ?? 220 }}
        />
      ) : (
        <div
          className="prose-note p-3 text-sm"
          style={{ minHeight: props.minHeight ?? 220 }}
        >
          {draft.trim().length === 0 ? (
            <span className="text-stone-400">Nothing yet.</span>
          ) : (
            <ReactMarkdown>{draft}</ReactMarkdown>
          )}
        </div>
      )}
    </div>
  );
}

function TabButton(props: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`rounded px-2 py-1 text-xs font-medium transition ${
        props.active
          ? "bg-stone-200 text-stone-900"
          : "text-stone-500 hover:bg-stone-100"
      }`}
    >
      {props.children}
    </button>
  );
}
