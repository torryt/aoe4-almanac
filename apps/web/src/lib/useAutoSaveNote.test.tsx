import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAutoSaveNote } from "./useAutoSaveNote.ts";
import { qk } from "./api.ts";

function makeWrapper(opts: { strict?: boolean; autoSave?: boolean } = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  qc.setQueryData(qk.preferences, { auto_save_notes: opts.autoSave ?? true });
  return function Wrapper({ children }: { children: ReactNode }) {
    const inner = (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    return opts.strict ? <StrictMode>{inner}</StrictMode> : inner;
  };
}

describe("useAutoSaveNote", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Regression: this is the empty-PUT bug that wiped notes.
  // Even under StrictMode (which double-invokes effects), a mount with a
  // cached serverBody and no user interaction must NOT call save("").
  it("does not fire an empty save when mounted (StrictMode) with cached serverBody and no interaction", () => {
    const save = vi.fn();
    const { unmount } = renderHook(
      ({ serverBody }) =>
        useAutoSaveNote({ serverBody, isSaving: false, save }),
      {
        wrapper: makeWrapper({ strict: true }),
        initialProps: {
          serverBody: "long note from server" as string | undefined,
        },
      },
    );
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    unmount();
    expect(save).not.toHaveBeenCalled();
  });

  // Regression: when the refetch after our own save returns the older saved
  // body, characters typed while the save was in flight must survive.
  it("preserves typed characters when the post-save refetch echoes the older saved body", () => {
    const save = vi.fn();
    const { result, rerender } = renderHook(
      ({ serverBody }: { serverBody: string | undefined }) =>
        useAutoSaveNote({ serverBody, isSaving: false, save }),
      {
        wrapper: makeWrapper(),
        initialProps: { serverBody: "" as string | undefined },
      },
    );
    expect(result.current.draft).toBe("");
    act(() => {
      result.current.setDraft("abc");
    });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(save).toHaveBeenCalledWith("abc");
    // User keeps typing while the save is in-flight.
    act(() => {
      result.current.setDraft("abc def");
    });
    // Server echoes the previously-saved value via the post-save refetch.
    rerender({ serverBody: "abc" });
    expect(result.current.draft).toBe("abc def");
  });

  it("debounces and saves once after user interaction", () => {
    const save = vi.fn();
    const { result } = renderHook(
      () =>
        useAutoSaveNote({
          serverBody: "" as string | undefined,
          isSaving: false,
          save,
        }),
      { wrapper: makeWrapper() },
    );
    act(() => {
      result.current.setDraft("hello");
    });
    expect(save).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(799);
    });
    expect(save).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("hello");
  });

  it("does not save on unmount when the user never interacted", () => {
    const save = vi.fn();
    const { unmount } = renderHook(
      () =>
        useAutoSaveNote({
          serverBody: "existing" as string | undefined,
          isSaving: false,
          save,
        }),
      { wrapper: makeWrapper() },
    );
    unmount();
    expect(save).not.toHaveBeenCalled();
  });

  it("flushes pending edits on unmount when the user has interacted", () => {
    const save = vi.fn();
    const { result, unmount } = renderHook(
      () =>
        useAutoSaveNote({
          serverBody: "" as string | undefined,
          isSaving: false,
          save,
        }),
      { wrapper: makeWrapper() },
    );
    act(() => {
      result.current.setDraft("partial");
    });
    // Unmount BEFORE the 800ms debounce fires.
    unmount();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("partial");
  });

  it("adopts external server changes when the user has no local divergence", () => {
    const save = vi.fn();
    const { result, rerender } = renderHook(
      ({ serverBody }: { serverBody: string | undefined }) =>
        useAutoSaveNote({ serverBody, isSaving: false, save }),
      {
        wrapper: makeWrapper(),
        initialProps: { serverBody: "v1" as string | undefined },
      },
    );
    expect(result.current.draft).toBe("v1");
    rerender({ serverBody: "v2" });
    expect(result.current.draft).toBe("v2");
  });

  it("preserves user input typed before the server body resolves", () => {
    const save = vi.fn();
    const { result, rerender } = renderHook(
      ({ serverBody }: { serverBody: string | undefined }) =>
        useAutoSaveNote({ serverBody, isSaving: false, save }),
      {
        wrapper: makeWrapper(),
        initialProps: { serverBody: undefined as string | undefined },
      },
    );
    act(() => {
      result.current.setDraft("user-typed");
    });
    rerender({ serverBody: "from-server" });
    expect(result.current.draft).toBe("user-typed");
  });

  it("does not save when auto-save preference is disabled", () => {
    const save = vi.fn();
    const { result } = renderHook(
      () =>
        useAutoSaveNote({
          serverBody: "" as string | undefined,
          isSaving: false,
          save,
        }),
      { wrapper: makeWrapper({ autoSave: false }) },
    );
    act(() => {
      result.current.setDraft("hello");
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(save).not.toHaveBeenCalled();
    expect(result.current.autoSaveEnabled).toBe(false);
    expect(result.current.dirty).toBe(true);
  });

  it("reports status transitions: saved → dirty → saving → saved", () => {
    const save = vi.fn();
    type Props = { serverBody: string | undefined; isSaving: boolean };
    const { result, rerender } = renderHook(
      ({ serverBody, isSaving }: Props) =>
        useAutoSaveNote({ serverBody, isSaving, save }),
      {
        wrapper: makeWrapper(),
        initialProps: { serverBody: "x", isSaving: false } as Props,
      },
    );
    expect(result.current.status).toBe("saved");
    act(() => {
      result.current.setDraft("xy");
    });
    expect(result.current.status).toBe("dirty");
    rerender({ serverBody: "x", isSaving: true });
    expect(result.current.status).toBe("saving");
    rerender({ serverBody: "xy", isSaving: false });
    expect(result.current.status).toBe("saved");
  });
});
