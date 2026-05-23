import type { ReactNode } from "react";

export function Card({
  title,
  children,
  actions,
}: {
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white shadow-sm">
      {(title || actions) && (
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-2.5">
          {title && (
            <h2 className="text-sm font-semibold text-stone-700">{title}</h2>
          )}
          {actions}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}
