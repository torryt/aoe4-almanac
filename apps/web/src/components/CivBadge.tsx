import { Link } from "@tanstack/react-router";

export function CivBadge({
  slug,
  name,
  variant,
  size = "sm",
  link = false,
}: {
  slug: string;
  name?: string;
  variant?: boolean;
  size?: "xs" | "sm" | "md";
  link?: boolean;
}) {
  const sizing = size === "xs" ? "px-1.5 py-0.5 text-[10px]" : size === "md" ? "px-2.5 py-1 text-sm" : "px-2 py-0.5 text-xs";
  const cls = `inline-flex items-center gap-1 rounded-full border ${
    variant
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-stone-300 bg-stone-100 text-stone-800"
  } font-medium ${sizing}`;
  const inner = (
    <span className={cls}>
      <span>{name ?? slug}</span>
      {variant && (
        <span
          title="variant civilization"
          className="text-[8px] uppercase tracking-wide text-amber-700"
        >
          var
        </span>
      )}
    </span>
  );
  if (!link) return inner;
  return (
    <Link to="/notes/civs/$slug" params={{ slug }}>
      {inner}
    </Link>
  );
}
