import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type ResizeDir =
  | "North"
  | "South"
  | "East"
  | "West"
  | "NorthEast"
  | "NorthWest"
  | "SouthEast"
  | "SouthWest";

const RESIZE_DIRS: Array<{ cls: string; dir: ResizeDir }> = [
  { cls: "resize-n", dir: "North" },
  { cls: "resize-s", dir: "South" },
  { cls: "resize-e", dir: "East" },
  { cls: "resize-w", dir: "West" },
  { cls: "resize-ne", dir: "NorthEast" },
  { cls: "resize-nw", dir: "NorthWest" },
  { cls: "resize-se", dir: "SouthEast" },
  { cls: "resize-sw", dir: "SouthWest" },
];

function ResizeEdges() {
  const win = getCurrentWindow();
  return (
    <div className="resize-edges" aria-hidden>
      {RESIZE_DIRS.map(({ cls, dir }) => (
        <div
          key={dir}
          className={`resize-edge ${cls}`}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            void win.startResizeDragging(dir);
          }}
        />
      ))}
    </div>
  );
}

export function Titlebar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void win.isMaximized().then(setMaximized);
    void win.onResized(() => {
      void win.isMaximized().then(setMaximized);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, []);

  if (!isTauri) return null;

  const win = getCurrentWindow();
  return (
    <>
    <ResizeEdges />
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-title" data-tauri-drag-region>
        AOE4 Almanac
      </div>
      <div className="titlebar-controls">
        <button
          type="button"
          aria-label="Minimize"
          className="titlebar-btn"
          onClick={() => void win.minimize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <rect x="1" y="4.5" width="8" height="1" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          aria-label={maximized ? "Restore" : "Maximize"}
          className="titlebar-btn"
          onClick={() => void win.toggleMaximize()}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <rect x="1.5" y="3" width="5.5" height="5.5" fill="none" stroke="currentColor" strokeWidth="1" />
              <rect x="3" y="1.5" width="5.5" height="5.5" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>
        <button
          type="button"
          aria-label="Close"
          className="titlebar-btn titlebar-btn-close"
          onClick={() => void win.close()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </div>
    </>
  );
}
