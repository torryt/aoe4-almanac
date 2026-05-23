import * as React from "react";
import { cn } from "../../lib/cn.ts";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "w-full bg-transparent border-0 border-b border-[rgba(28,28,26,0.3)] font-display text-[18px] text-[#1c1c1a] py-1.5 px-0.5 outline-none focus:border-[#9b2b2b] disabled:opacity-50 placeholder:text-[#5b574e] placeholder:italic",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "block w-full bg-transparent border-0 outline-none font-display text-[17px] leading-[1.55] text-[#1c1c1a] resize-y",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
