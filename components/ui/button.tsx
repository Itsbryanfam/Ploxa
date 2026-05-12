import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:opacity-50 disabled:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--accent)] text-white hover:brightness-110 active:brightness-95 shadow-[0_0_0_1px_var(--accent)] hover:shadow-[0_0_20px_var(--accent-glow)]",
        secondary:
          "bg-[var(--bg-card)] text-[var(--text)] border border-[var(--border)] hover:bg-[var(--bg-card-hover)] hover:border-[var(--accent)]",
        ghost:
          "text-[var(--text-dim)] hover:bg-[var(--bg-card)] hover:text-[var(--text)]",
        link: "text-[var(--accent)] underline-offset-4 hover:underline",
        pixel:
          "bg-[var(--pixel)] text-[var(--bg)] hover:brightness-110 active:brightness-95 font-semibold tracking-wide",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
