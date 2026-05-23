import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../lib/cn.ts";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-sans uppercase tracking-[0.28em] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none",
  {
    variants: {
      variant: {
        signet:
          "bg-[#9b2b2b] text-[#f1ece4] hover:bg-[#7a1f1f] disabled:bg-[#b8a87f]",
        ghost:
          "bg-transparent text-[#1c1c1a] border border-[rgba(28,28,26,0.3)] hover:border-[#1c1c1a]",
        warning:
          "bg-transparent text-[#7a1f1f] border border-[#9b2b2b] hover:bg-[rgba(155,43,43,0.06)]",
        link:
          "p-0 text-[#1c1c1a] underline-offset-2 hover:underline tracking-normal normal-case font-medium",
      },
      size: {
        sm: "px-3 py-1.5 text-[9px]",
        md: "px-[18px] py-[10px] text-[10px]",
        lg: "px-6 py-3 text-[11px]",
      },
    },
    defaultVariants: {
      variant: "signet",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
