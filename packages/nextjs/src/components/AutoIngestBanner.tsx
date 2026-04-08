"use client";

import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { listApis } from "../lib/api";
import { cn } from "../lib/utils";
import { useStore } from "../store/store";
import { Button } from "./ui/button";

interface SpecStatus {
  name: string;
  status: "pending" | "running" | "done" | "error";
  message: string;
  done?: number;
  total?: number;
}

/**
 * Pill button + dropdown that shows auto-ingest progress via SSE.
 * Connects to /openapi/ingest/status on mount and updates the store as events arrive.
 */
const AutoIngestIndicator = (): JSX.Element | null => {
  const { autoIngest, setAutoIngest, updateAutoIngestSpec, setApis } = useStore(
    useShallow((s) => ({
      autoIngest: s.autoIngest,
      setAutoIngest: s.setAutoIngest,
      updateAutoIngestSpec: s.updateAutoIngestSpec,
      setApis: s.setApis,
    })),
  );
  const evtSourceRef = useRef<EventSource | null>(null);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Connect to SSE endpoint
  useEffect(() => {
    if (evtSourceRef.current) return;

    const es = new EventSource("/openapi/ingest/status");
    evtSourceRef.current = es;

    es.onmessage = (msg) => {
      try {
        const e = JSON.parse(msg.data) as {
          type: string;
          specs?: string[];
          name?: string;
          message?: string;
          done?: number;
          total?: number;
          endpoints?: number;
          schemas?: number;
        };

        if (e.type === "start" && e.specs && e.specs.length > 0) {
          const specs: SpecStatus[] = e.specs.map((n) => ({ name: n, status: "pending", message: "" }));
          setAutoIngest({ active: true, specs, currentIndex: 0 });
        } else if (e.type === "spec-start" && e.name) {
          updateAutoIngestSpec(e.name, { status: "running", message: "Starting..." });
        } else if (e.type === "spec-progress" && e.name) {
          updateAutoIngestSpec(e.name, {
            status: "running",
            message: e.message ?? "",
            ...(e.done !== undefined && { done: e.done }),
            ...(e.total !== undefined && { total: e.total }),
          });
        } else if (e.type === "spec-done" && e.name) {
          updateAutoIngestSpec(e.name, {
            status: "done",
            message: `${e.endpoints ?? 0} endpoints, ${e.schemas ?? 0} schemas`,
          });
          listApis().then((a) => setApis(a)).catch(() => {});
        } else if (e.type === "spec-error" && e.name) {
          updateAutoIngestSpec(e.name, { status: "error", message: e.message ?? "Failed" });
        } else if (e.type === "complete") {
          setAutoIngest({ active: false });
          es.close();
          evtSourceRef.current = null;
        }
      } catch {}
    };

    es.onerror = () => {
      es.close();
      evtSourceRef.current = null;
    };

    return () => {
      es.close();
      evtSourceRef.current = null;
    };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  const { active, specs } = autoIngest;
  const allDone = !active && specs.length > 0 && specs.every((s) => s.status === "done" || s.status === "error");

  // Auto-hide 5s after completion
  useEffect(() => {
    if (!allDone) return;
    const t = setTimeout(() => setAutoIngest({ specs: [] }), 5000);
    return () => clearTimeout(t);
  }, [allDone]);

  if (specs.length === 0) return null;

  const doneCount = specs.filter((s) => s.status === "done").length;
  const errorCount = specs.filter((s) => s.status === "error").length;
  const finishedCount = doneCount + errorCount;
  const running = specs.find((s) => s.status === "running");
  const pct = running?.total ? Math.round(((running.done ?? 0) / running.total) * 100) : 0;
  const overallPct = specs.length > 0 ? Math.round((finishedCount / specs.length) * 100) : 0;

  const handleToggle = () => setOpen(!open);

  return (
    <div ref={containerRef} className="relative">
      {/* Pill button */}
      <Button
        variant="outline"
        size="xs"
        onClick={handleToggle}
        className="gap-1.5"
      >
        {active ? (
          <svg className="animate-spin" width={12} height={12} viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="8" fill="none" stroke="var(--g-border)" strokeWidth="2.5" />
            <path d="M10 2a8 8 0 0 1 8 8" fill="none" stroke="var(--g-accent)" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width={12} height={12} viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="8" fill="none" stroke="var(--g-green)" strokeWidth="2.5" />
            <path d="M6 10l3 3 5-6" fill="none" stroke="var(--g-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        <span className="text-secondary-foreground font-medium">
          {active ? `Ingesting ${finishedCount}/${specs.length}` : "Ingested"}
        </span>
      </Button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full right-0 z-[150] mt-1.5 w-80 max-h-72 overflow-hidden rounded-lg border border-(--g-border) bg-(--g-surface) shadow-[0_8px_30px_rgba(0,0,0,0.4)]">
          {/* Header */}
          <div className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-(--g-text)">
            {active ? "Auto-ingesting specs..." : "Auto-ingest complete"}
            <span className="ml-auto text-xs font-normal text-(--g-text-dim)">
              {finishedCount}/{specs.length}
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-0.5 bg-(--g-border)">
            <div
              className="h-full bg-(--g-accent) transition-all duration-300"
              style={{ width: `${active && running ? overallPct + (pct / specs.length) : overallPct}%` }}
            />
          </div>

          {/* Spec list */}
          <div className="max-h-56 overflow-y-auto">
            {specs.map((sp) => (
              <div key={sp.name} className="flex items-center gap-2 px-3 py-1.5 text-[0.8125rem] border-t border-(--g-border)">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{
                  backgroundColor:
                    sp.status === "done" ? "var(--g-green)" :
                    sp.status === "error" ? "var(--g-danger)" :
                    sp.status === "running" ? "var(--g-accent)" :
                    "var(--g-text-dim)",
                  opacity: sp.status === "pending" ? 0.4 : 1,
                }} />
                <span className={cn("font-medium truncate min-w-0", sp.status === "pending" ? "text-(--g-text-dim)" : "text-(--g-text)")}>
                  {sp.name}
                </span>
                <span className="ml-auto text-xs text-(--g-text-dim) whitespace-nowrap shrink-0">
                  {sp.status === "running" && sp.total
                    ? `${sp.done ?? 0}/${sp.total}`
                    : sp.status === "done" || sp.status === "error"
                    ? sp.message
                    : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AutoIngestIndicator;
