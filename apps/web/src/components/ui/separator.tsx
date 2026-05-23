import * as SeparatorPrimitive from "@radix-ui/react-separator";
import * as React from "react";
import { cn } from "../../lib/cn.ts";

export const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root> & {
    tone?: "faint" | "default" | "gold" | "thick";
  }
>(
  (
    {
      className,
      orientation = "horizontal",
      decorative = true,
      tone = "default",
      ...props
    },
    ref,
  ) => (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0",
        orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
        tone === "faint" && "bg-[rgba(28,28,26,0.1)]",
        tone === "default" && "bg-[rgba(28,28,26,0.18)]",
        tone === "gold" && "bg-[#7a6a4a]",
        tone === "thick" && "h-[2px] bg-[#1c1c1a]",
        className,
      )}
      {...props}
    />
  ),
);
Separator.displayName = SeparatorPrimitive.Root.displayName;
