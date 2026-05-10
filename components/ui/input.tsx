import * as React from "react";

import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        className={cn(
          "flex h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-elev)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus-visible:outline-none focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent-soft)] disabled:cursor-not-allowed disabled:opacity-50 transition-colors",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
