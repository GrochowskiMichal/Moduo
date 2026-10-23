import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

import { buttonVariants } from "./button";

// AlertDialog — a Dialog that asks one question and must be answered (shadcn's
// alert-dialog over Radix). Same surface as Dialog (overlay, card, shadow,
// z-layers); no close ×, and Esc / click-away resolve to Cancel. Use it for a
// confirm, never for a form.

function AlertDialog({ ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />;
}

function AlertDialogPortal({ ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />;
}

function AlertDialogOverlay({
  className,
  style,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 bg-background/60",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      style={{ zIndex: "var(--z-overlay)", ...style }}
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  style,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(
          "motion-pop fixed top-1/2 left-1/2 grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 p-6 outline-none",
          "rounded-xl border border-border bg-card text-card-foreground",
          className,
        )}
        style={{
          zIndex: "var(--z-dialog)",
          boxShadow: "var(--shadow-overlay)",
          ...style,
        }}
        {...props}
      />
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn("flex flex-col gap-2 text-left", className)}
      {...props}
    />
  );
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("font-display text-lg leading-snug text-foreground", className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

/** The answer that does something. Pass `variant="destructive"` for a destroy. */
function AlertDialogAction({
  className,
  variant = "default",
  style,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> & {
  variant?: "default" | "destructive";
}) {
  return (
    <AlertDialogPrimitive.Action
      data-slot="alert-dialog-action"
      className={cn(buttonVariants({ variant, size: "md" }), className)}
      style={{ height: "var(--ctrl-h)", ...style }}
      {...props}
    />
  );
}

/** The safe answer; Esc and click-away pick it too. */
function AlertDialogCancel({
  className,
  style,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      data-slot="alert-dialog-cancel"
      className={cn(buttonVariants({ variant: "ghost", size: "md" }), className)}
      style={{ height: "var(--ctrl-h)", ...style }}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
};
