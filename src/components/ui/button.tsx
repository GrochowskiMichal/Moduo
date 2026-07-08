import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  cn(
    "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap",
    "rounded-md font-display text-base font-medium",
    "transition-[color,background-color,border-color,box-shadow] duration-(--motion-fade) ease-(--ease-out) outline-none",
    "focus-visible:ring-2 focus-visible:ring-ring/50",
    "disabled:pointer-events-none disabled:opacity-50",
    "aria-invalid:ring-2 aria-invalid:ring-destructive/40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-icon-sm",
  ),
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        outline: "border border-border bg-transparent text-foreground hover:bg-accent",
        ghost: "bg-transparent text-foreground hover:bg-accent",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        link: "bg-transparent text-primary underline-offset-4 hover:underline",
      },
      // Size changes height (via --ctrl-h* below) + padding only; font stays
      // text-base across rungs so any two controls on a rung share a baseline.
      size: {
        sm: "px-2.5",
        md: "px-4",
        lg: "px-6 [&_svg:not([class*='size-'])]:size-icon",
        icon: "aspect-square px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

function Button({
  className,
  variant = "default",
  size = "md",
  asChild = false,
  style,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";

  const sizeVar =
    size === "sm"
      ? "var(--ctrl-h-sm)"
      : size === "lg"
        ? "var(--ctrl-h-lg)"
        : "var(--ctrl-h)";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      style={{ height: sizeVar, ...(size === "icon" ? { width: sizeVar } : null), ...style }}
      {...props}
    />
  );
}

export { Button, buttonVariants };
export type { ButtonProps };
