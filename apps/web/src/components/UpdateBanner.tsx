import { useState } from "react";
import { useUpdater } from "../lib/useUpdater.ts";

export function UpdateBanner() {
  const { state, install } = useUpdater({ checkOnMount: true });
  const [dismissed, setDismissed] = useState(false);

  if (state.phase === "idle" || state.phase === "checking") return null;
  if (state.phase === "error") return null;
  if (dismissed && state.phase === "available") return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded border border-[#c9bfa6] bg-[#f8f4ea] shadow-lg px-4 py-3">
      {state.phase === "available" ? (
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <p className="font-display text-[15px] text-[#1c1c1a]">
              Update available · v{state.update.version}
            </p>
            <p className="eyebrow-tight text-[#5b574e] pt-1">
              Install and restart to apply
            </p>
          </div>
          <button
            type="button"
            onClick={() => void install()}
            className="eyebrow-tight text-[#7a6a4a] hover:text-[#1c1c1a] underline-offset-2 hover:underline cursor-pointer"
          >
            install
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Dismiss"
            className="text-[#7a6a4a] hover:text-[#1c1c1a] leading-none text-lg cursor-pointer -mt-0.5"
          >
            ×
          </button>
        </div>
      ) : null}

      {state.phase === "downloading" ? (
        <div>
          <p className="font-display text-[15px] text-[#1c1c1a]">
            Downloading update…
          </p>
          <p className="eyebrow-tight text-[#5b574e] pt-1">
            {formatProgress(state.downloaded, state.total)}
          </p>
        </div>
      ) : null}

      {state.phase === "ready" ? (
        <p className="font-display text-[15px] text-[#1c1c1a]">
          Restarting to apply update…
        </p>
      ) : null}
    </div>
  );
}

function mb(n: number): string {
  return (n / 1024 / 1024).toFixed(1);
}

function formatProgress(downloaded: number, total: number | null): string {
  if (total === null) return `${mb(downloaded)} MB`;
  const pct = Math.floor((downloaded / total) * 100);
  return `${mb(downloaded)} / ${mb(total)} MB · ${pct}%`;
}
