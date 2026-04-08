"use client";

import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Root alert dialog wrapper that forwards all props to the Radix primitive. */
const AlertDialog = ({ ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Root>): JSX.Element => {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
};

/** Trigger element that opens the alert dialog. */
const AlertDialogTrigger = ({ ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>): JSX.Element => {
  return (
    <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
  );
};

/** Portal wrapper that renders dialog content outside the normal DOM tree. */
const AlertDialogPortal = ({ ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Portal>): JSX.Element => {
  return (
    <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
  );
};

/** Semi-transparent overlay rendered behind the dialog content. */
const AlertDialogOverlay = ({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>): JSX.Element => {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
};

/** The main dialog content panel, centred on screen. Supports "default" and "sm" sizes. */
const AlertDialogContent = ({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
  size?: "default" | "sm";
}): JSX.Element => {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(
          "group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl bg-popover p-4 text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      />
    </AlertDialogPortal>
  );
};

/** Header section containing the title and optional description. */
const AlertDialogHeader = ({ className, ...props }: React.ComponentProps<"div">): JSX.Element => {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn(
        "grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-4 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]",
        className,
      )}
      {...props}
    />
  );
};

/** Footer section containing the action and cancel buttons. */
const AlertDialogFooter = ({ className, ...props }: React.ComponentProps<"div">): JSX.Element => {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
};

/** Optional media/icon element that appears alongside the title in larger dialog sizes. */
const AlertDialogMedia = ({ className, ...props }: React.ComponentProps<"div">): JSX.Element => {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        `mb-2 inline-flex size-10 items-center justify-center
        rounded-md bg-muted
          sm:group-data-[size=default]/alert-dialog-content:row-span-2
          *:[svg:not([class*='size-'])]:size-6
        `,
        className,
      )}
      {...props}
    />
  );
};

/** The dialog title rendered with heading styles. */
const AlertDialogTitle = ({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Title>): JSX.Element => {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(
        "font-heading text-base font-medium sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
        className,
      )}
      {...props}
    />
  );
};

/** Supplementary description text below the title. */
const AlertDialogDescription = ({ className, ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Description>): JSX.Element => {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
};

/** The confirm action button; wraps the Radix Action primitive inside a Button. */
const AlertDialogAction = ({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">): JSX.Element => {
  return (
    <Button variant={variant} size={size} asChild>
      <AlertDialogPrimitive.Action
        data-slot="alert-dialog-action"
        className={cn(className)}
        {...props}
      />
    </Button>
  );
};

/** The cancel button; wraps the Radix Cancel primitive inside a Button. */
const AlertDialogCancel = ({
  className,
  variant = "outline",
  size = "default",
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel> &
  Pick<React.ComponentProps<typeof Button>, "variant" | "size">): JSX.Element => {
  return (
    <Button variant={variant} size={size} asChild>
      <AlertDialogPrimitive.Cancel
        data-slot="alert-dialog-cancel"
        className={cn(className)}
        {...props}
      />
    </Button>
  );
};

export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
};
