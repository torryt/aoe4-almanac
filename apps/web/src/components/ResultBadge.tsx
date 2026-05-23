export function ResultBadge({ result }: { result: string }) {
  if (result === "win") {
    return (
      <span className="inline-flex items-center rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-emerald-800">
        W
      </span>
    );
  }
  if (result === "loss") {
    return (
      <span className="inline-flex items-center rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-rose-800">
        L
      </span>
    );
  }
  if (result === "draw") {
    return (
      <span className="inline-flex items-center rounded bg-stone-200 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-stone-700">
        D
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded bg-stone-200 px-1.5 py-0.5 text-[11px] font-semibold uppercase text-stone-500">
      ?
    </span>
  );
}
