"use client";

import { Group, Panel, Separator } from "react-resizable-panels";
import type { GroupProps, PanelProps, SeparatorProps } from "react-resizable-panels";

import { cn } from "@/lib/utils";

const ResizablePanelGroup = ({
  className,
  orientation = "horizontal",
  ...props
}: GroupProps & { orientation?: "horizontal" | "vertical" }) => (
  <Group
    orientation={orientation}
    className={cn("flex h-full w-full", orientation === "vertical" ? "flex-col" : "flex-row", className)}
    {...props}
  />
);

const ResizablePanel = ({ className, ...props }: PanelProps) => (
  <Panel className={cn("min-w-0 min-h-0", className)} {...props} />
);

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: SeparatorProps & { withHandle?: boolean }) => (
  <Separator
    className={cn(
      "relative flex w-px shrink-0 items-center justify-center bg-(--g-border) transition-colors hover:bg-(--g-accent) focus-visible:outline-none",
      className,
    )}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-9 w-3 items-center justify-center">
        <div className="h-9 w-[0.1875rem] rounded-[0.125rem] bg-(--g-text-dim) opacity-50" />
      </div>
    )}
  </Separator>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
