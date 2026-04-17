"use client";

import React, { useState, useRef, useEffect, useMemo, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { Ic } from "../../lib/icons";
import { cn } from "../../lib/utils";
import { useStore } from "../../store/store";
import type { ChatMsg } from "../../store/store";
import EpCard from "../../components/EpCard";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { ForkButton } from "../../components/chat/ForkButton";
import type {
  CopyBtnProps,
  EndpointDropdownProps,
  DocDropdownProps,
  VerificationBadgeProps,
  ChatMessageProps,
  QuickActionBarProps,
  ToolCallEntry,
} from "./types";
import {
  collapseBtn,
  PERSONALITY_COLOR,
  DOC_CARD_SCORE_THRESHOLD,
  DIAGRAM_OPTIONS,
  CODE_OPTIONS,
} from "./constants";
import { estimateCost, cleanText, extractToolCallEntries } from "./utils";
import { GregMarkdown, StreamingText } from "./markdown-components";

// ---------------------------------------------------------------------------
// TokenCounter
// ---------------------------------------------------------------------------

/**
 * Token counter with color-coded context health, an info popover, and a compact button at red.
 */
export const TokenCounter = ({ chatMessages, provider, onCompact }: { chatMessages: ChatMsg[]; provider?: string; onCompact: () => void }): JSX.Element | null => {
  const [showInfo, setShowInfo] = useState(false);
  const msgsWithUsage = chatMessages.filter((m) => m.role === "assistant" && m.usage);
  if (chatMessages.length === 0) return null;

  const isOllama = provider === "ollama";
  const warnAt = isOllama ? 60_000 : 100_000;
  const redAt  = isOllama ? 100_000 : 150_000;

  const lastAsst = msgsWithUsage[msgsWithUsage.length - 1];
  const lastIn   = lastAsst?.usage?.input ?? 0;
  const lastOut  = lastAsst?.usage?.output ?? 0;
  const total = lastAsst
    ? lastIn + lastOut
    : chatMessages.reduce((s, m) => s + Math.ceil(m.text.length / 4), 0);

  const isRed = total >= redAt;
  const lerpColor = (): string => {
    if (total < warnAt) return "var(--g-text-dim)";
    const t = Math.min(1, (total - warnAt) / (redAt - warnAt));
    const r = Math.round(202 + (220 - 202) * t);
    const g = Math.round(138 + (38  - 138) * t);
    const b = Math.round(4   + (38  - 4)   * t);
    return `rgb(${r},${g},${b})`;
  };
  const color = lerpColor();
  const fmt   = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(total);

  return (
    <div className="relative flex items-center gap-1">
      <span className="font-mono text-[0.625rem] tabular-nums" style={{ color }}>
        {fmt}
      </span>
      <button
        onMouseEnter={() => setShowInfo(true)}
        onMouseLeave={() => setShowInfo(false)}
        className="flex items-center justify-center w-3.5 h-3.5 rounded-full text-[0.5625rem] font-bold border cursor-default select-none leading-none"
        style={{ color: "var(--g-text-dim)", borderColor: "var(--g-border-hover)" }}
      >
        i
      </button>
      {isRed && (
        <button
          onClick={onCompact}
          className="flex items-center gap-0.5 h-[1.125rem] px-1.5 rounded text-[0.5625rem] font-medium border cursor-pointer transition-colors hover:bg-(--g-danger-muted)"
          style={{ color: "var(--g-danger)", borderColor: "color-mix(in srgb, var(--g-danger) 30%, transparent)" }}
          title="Remove code blocks and endpoint cards from chat history to free up context"
        >
          compact
        </button>
      )}
      {showInfo && (
        <div className="absolute bottom-full left-0 mb-2 w-72 rounded-lg border border-(--g-border-hover) bg-(--g-surface) shadow-lg p-4 z-50 text-xs leading-[1.55] text-(--g-text-muted)">
          <div className="text-sm font-semibold text-(--g-text) mb-2">Context window usage</div>
          <p className="mb-2">
            <span className="font-mono text-(--g-text)">{lastIn.toLocaleString()}</span> in &nbsp;·&nbsp; <span className="font-mono text-(--g-text)">{lastOut.toLocaleString()}</span> out
          </p>
          <p className="mb-2.5">Tracks the last turn's actual token count — what the model received in its most recent call. As the conversation grows this number increases; once the context fills, earlier instructions get ignored.</p>
          <div className="flex flex-col gap-1 border-t border-(--g-border) pt-2">
            <span style={{ color: "var(--g-text-dim)" }}>● Gray — healthy</span>
            <span style={{ color: "#CA8A04" }}>● Yellow — getting full, consider a new chat ({warnAt / 1000}k+)</span>
            <span style={{ color: "var(--g-danger)" }}>● Red — degradation likely ({redAt / 1000}k+)</span>
          </div>
          <p className="mt-2 text-[0.6875rem] text-(--g-text-dim)">{isOllama ? "Thresholds adjusted for local models." : "Thresholds for Claude models."}</p>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// InputBoxWrapper
// ---------------------------------------------------------------------------

/**
 * Styled container for the chat input area; border colour changes on focus.
 */
export const InputBoxWrapper = ({ children }: { children: React.ReactNode }): JSX.Element => {
  const [focused, setFocused] = useState(false);

  return (
    <div
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={() => setFocused(false)}
      className="flex flex-col rounded-xl px-3.5 pt-3.5 pb-2.5 transition-[border-color,background] duration-150"
      style={{
        background: "var(--g-surface)",
        border: `1px solid ${focused ? "var(--g-accent)" : "var(--g-border)"}`,
      }}
    >
      {children}
    </div>
  );
};

// ---------------------------------------------------------------------------
// EndpointDropdown
// ---------------------------------------------------------------------------

/**
 * Collapsible list of retrieved endpoint cards, sorted by score descending.
 */
export const EndpointDropdown = ({ endpoints, onSelect }: EndpointDropdownProps): JSX.Element => {
  const [open, setOpen] = useState(false);

  const handleToggle = (): void => setOpen(!open);

  return (
    <div>
      <button
        onClick={handleToggle}
        className={cn(collapseBtn, "w-full rounded border border-(--g-border-accent) px-2.5 py-1 text-[0.8125rem] text-(--g-accent) bg-(--g-accent-dim)")}
      >
        <span className="flex items-center gap-1.5 flex-1 text-left">
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span className="font-semibold">{endpoints.length}</span>
          {` endpoint${endpoints.length !== 1 ? "s" : ""}`}
        </span>
        <span className={cn("flex transition-transform duration-150", open ? "rotate-180" : "rotate-0")}>
          <svg width={10} height={10} viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="tree-children flex flex-col gap-[0.1875rem] mt-1 max-h-[18.75rem] overflow-auto">
            {[...endpoints].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((ep, j) => (
              <div key={j} className="tree-item">
                <EpCard
                  method={ep.method}
                  path={ep.path}
                  api={ep.api}
                  description={ep.description}
                  {... (ep.warnings !== undefined && { warnings: ep.warnings })}
                  onClick={() => onSelect(ep)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// DocDropdown
// ---------------------------------------------------------------------------

const chevronSvg = (
  <svg width={10} height={10} viewBox="0 0 10 10" fill="none">
    <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Collapsible list of retrieved document cards, grouped by doc name.
 */
export const DocDropdown = ({ docs, onSelect }: DocDropdownProps): JSX.Element => {
  const [open, setOpen] = useState(false);
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());
  const filtered = docs.filter((d) => (d.score ?? 0) >= DOC_CARD_SCORE_THRESHOLD);
  if (filtered.length === 0) return <></>;

  const grouped = filtered.reduce<Map<string, typeof filtered>>((acc, dc) => {
    const existing = acc.get(dc.doc_name);
    if (existing) existing.push(dc);
    else acc.set(dc.doc_name, [dc]);
    return acc;
  }, new Map());
  const uniqueDocCount = grouped.size;

  const toggleDoc = (name: string): void =>
    setExpandedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(collapseBtn, "w-full rounded border border-(--g-border) px-2.5 py-1 text-[0.8125rem] text-(--g-text-muted) bg-(--g-surface)")}
      >
        <span className="flex items-center gap-1.5 flex-1 text-left">
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <span className="font-semibold">{uniqueDocCount}</span>
          {` doc${uniqueDocCount !== 1 ? "s" : ""}`}
        </span>
        <span className={cn("flex transition-transform duration-150", open ? "rotate-180" : "rotate-0")}>
          {chevronSvg}
        </span>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="tree-children flex flex-col gap-[0.1875rem] mt-1 max-h-[14rem] overflow-auto">
            {[...grouped.entries()].map(([docName, cards]) => {
              const isExpanded = expandedDocs.has(docName);
              const sorted = [...cards].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
              return (
                <div key={docName} className="tree-item">
                <div className="rounded border border-(--g-border) overflow-hidden">
                  <button
                    onClick={() => toggleDoc(docName)}
                    className="flex items-center gap-1.5 w-full text-left px-2.5 py-1.5 bg-(--g-surface) hover:bg-(--g-surface-raised) transition-colors cursor-pointer"
                  >
                    {Ic.doc(12)}
                    <span className="font-mono text-xs text-(--g-text) truncate flex-1">{docName}</span>
                    {cards[0]?.project && <Badge variant="api" className="shrink-0">{cards[0].project}</Badge>}
                    <span className="text-[0.6875rem] text-(--g-text-dim) shrink-0 mr-1">{cards.length}</span>
                    <span className={cn("flex shrink-0 transition-transform duration-150", isExpanded ? "rotate-180" : "rotate-0")}>
                      {chevronSvg}
                    </span>
                  </button>
                  <div
                    className="grid transition-[grid-template-rows] duration-150 ease-out"
                    style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
                  >
                    <div className="overflow-hidden">
                      <div className="flex flex-col border-t border-(--g-border)">
                        {sorted.map((dc, j) => (
                          <button
                            key={j}
                            onClick={() => onSelect(dc)}
                            className="flex items-center gap-1.5 w-full text-left px-6 py-1 text-[0.75rem] text-(--g-text-muted) hover:text-(--g-text) hover:bg-(--g-surface-raised) transition-colors border-b border-(--g-border) last:border-b-0 cursor-pointer"
                          >
                            <span className="shrink-0 mr-1">•</span>
                            <span className="truncate prose prose-sm prose-neutral dark:prose-invert max-w-none [&>*]:inline [&>p]:m-0">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{dc.heading || dc.heading_path || "—"}</ReactMarkdown>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// VerificationBadge
// ---------------------------------------------------------------------------

/**
 * Badge shown below an assistant message with the double-check result.
 * Shows a spinner while streaming, a green checkmark if verified, or a collapsible correction block.
 */
export const VerificationBadge = ({ text, usage, msgKey, streaming }: VerificationBadgeProps): JSX.Element | null => {
  const [open, setOpen] = useState(false);
  const isVerified = text.trim().startsWith("✓");
  const tokenCount = usage ? (usage.input + usage.output) : 0;

  if (streaming && !text.trim()) {
    return (
      <div className="flex items-center gap-1.5 mt-2.5 px-2.5 py-1.5 border-t border-(--g-border) text-[0.6875rem] text-(--g-text-dim)">
        <svg className="animate-spin" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="var(--g-green)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <span>double checking...</span>
      </div>
    );
  }

  if (!text.trim()) return null;

  if (isVerified) {
    return (
      <div className="flex items-center gap-[0.3125rem] mt-2.5 py-1.5 border-t border-(--g-border) text-[0.6875rem] text-(--g-green)">
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
        <span>{text.trim()}</span>
        {tokenCount > 0 && <span className="text-[0.625rem] text-(--g-text-dim)">({tokenCount.toLocaleString()} tok)</span>}
      </div>
    );
  }

  const handleToggle = (): void => setOpen(!open);

  return (
    <div className="mt-2.5 border-t border-(--g-border)">
      <button
        onClick={handleToggle}
        className="flex items-center gap-[0.3125rem] w-full py-2 border-none bg-transparent cursor-pointer text-[0.6875rem] font-semibold uppercase tracking-[0.5px] text-(--g-method-put-text)"
      >
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
        <span>Corrected by Sonnet</span>
        {tokenCount > 0 && <span className="font-normal text-(--g-text-dim)">{tokenCount.toLocaleString()} tok</span>}
        <span className="flex-1" />
        <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform duration-150 ${open ? "rotate-180" : "rotate-0"}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="pb-1 text-sm leading-[1.6] text-(--g-text-muted)">
          <GregMarkdown text={cleanText(text)} msgKey={`${msgKey}-verify`} />
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// CopyMarkdownBtn
// ---------------------------------------------------------------------------

/**
 * Copy button specifically for copying a message as markdown text.
 */
export const CopyMarkdownBtn = ({ text }: CopyBtnProps): JSX.Element => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = (): void => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={handleCopy}
      title="Copy as markdown"
      className="opacity-0 group-hover/msg:opacity-60 hover:!opacity-100 hover:text-(--g-accent)"
    >
      {copied ? (
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </Button>
  );
};

// ---------------------------------------------------------------------------
// Tool call icons
// ---------------------------------------------------------------------------

/** Wrench icon for individual tool call rows. */
export const ToolIcon = ({ size = 11 }: { size?: number }): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);

/** Crossed wrench + screwdriver icon for the tool group header. */
export const ToolGroupIcon = ({ size = 11 }: { size?: number }): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z" />
  </svg>
);

// ---------------------------------------------------------------------------
// ToolCallActivity
// ---------------------------------------------------------------------------

/**
 * Inline tool-call feed shown during and after streaming.
 */
export const ToolCallActivity = memo(({ debug }: { debug: Record<string, unknown>[] }): JSX.Element => {
  const entries = useMemo(() => extractToolCallEntries(debug), [debug]);
  const [open, setOpen] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<Set<number>>(new Set());

  if (entries.length === 0) return <></>;

  const toggle = (idx: number): void => setExpandedIdx((prev) => {
    const next = new Set(prev);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    return next;
  });

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(collapseBtn, "w-full rounded border border-(--g-method-patch-border) px-2.5 py-1 text-[0.8125rem] text-(--g-method-patch-text) bg-(--g-method-patch-bg)")}
      >
        <span className="flex items-center gap-1.5 flex-1 text-left">
          <ToolGroupIcon size={11} />
          <span className="font-semibold">{entries.length}</span>
          {` tool call${entries.length !== 1 ? "s" : ""}`}
        </span>
        {(() => { const total = entries.reduce((s, e) => s + (e.roundInput ?? 0), 0); return total > 0 ? (
          <span className="flex items-center gap-0.5 font-mono text-[0.6875rem] tabular-nums opacity-70 mr-1.5">
            {Ic.bolt(9)} {total.toLocaleString()}
          </span>
        ) : null; })()}
        <span className={cn("flex transition-transform duration-150", open ? "rotate-180" : "rotate-0")}>
          <svg width={10} height={10} viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="tree-children flex flex-col gap-[0.1875rem] mt-1 max-h-[18.75rem] overflow-auto">
            {entries.map((entry) => {
              const isExpanded = expandedIdx.has(entry.idx);
              const pending = !entry.result;
              return (
                <div key={entry.idx} className="tree-item">
                <div className="rounded border border-(--g-border) overflow-hidden text-xs">
                  <button
                    onClick={() => toggle(entry.idx)}
                    className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-left bg-(--g-surface) hover:bg-(--g-surface-hover) transition-colors"
                  >
                    <span className="text-(--g-text) shrink-0">{entry.name === "search_apis" ? Ic.server(11) : entry.name === "search_docs" ? Ic.doc(11) : <ToolIcon size={11} />}</span>
                    <span className="font-mono truncate flex-1 text-(--g-text-muted)">
                      {entry.name}
                      {entry.name === "get_doc" && (entry.input as Record<string, unknown>)?.doc_name ? (
                        <span className="text-(--g-text-dim)"> — <i>"{String((entry.input as Record<string, unknown>).doc_name)}" - "{String((entry.input as Record<string, unknown>).heading ?? "")}"</i></span>
                      ) : entry.name === "get_endpoint" && (entry.input as Record<string, unknown>)?.method ? (
                        <span className="text-(--g-text-dim)"> — <i>"{String((entry.input as Record<string, unknown>).method)}"</i> {"->"} <i>"{String((entry.input as Record<string, unknown>).api ?? "")}:/{String((entry.input as Record<string, unknown>).path ?? "")}"</i></span>
                      ) : (entry.input as Record<string, unknown>)?.query ? (
                        <span className="text-(--g-text-dim)"> — <i>"{String((entry.input as Record<string, unknown>).query)}"</i></span>
                      ) : null}
                    </span>
                    {entry.roundInput !== undefined && (
                      <span className="flex items-center gap-0.5 font-mono text-[0.6875rem] text-(--g-text-dim) shrink-0 tabular-nums">
                        {Ic.bolt(9)} {entry.roundInput.toLocaleString()}
                      </span>
                    )}
                    {pending ? (
                      <span className="text-[0.6875rem] text-(--g-text-dim) animate-pulse shrink-0">running…</span>
                    ) : null}
                    <span className={cn("flex shrink-0 ml-0.5 text-(--g-text-dim) transition-transform duration-150", isExpanded ? "rotate-180" : "rotate-0")}>
                      <svg width={8} height={8} viewBox="0 0 10 10" fill="none">
                        <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>
                  <div
                    className="grid transition-[grid-template-rows] duration-150 ease-out"
                    style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
                  >
                    <div className="overflow-hidden">
                      <div className="border-t border-(--g-border) px-2.5 py-2 bg-(--g-surface)">
                        <div className="flex gap-2">
                          <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-(--g-text-dim) w-8 shrink-0 pt-px">in</span>
                          <pre className="font-mono text-[0.6875rem] text-(--g-text-muted) whitespace-pre-wrap break-all leading-relaxed min-w-0">{JSON.stringify(entry.input, null, 2)}</pre>
                        </div>
                        {entry.result && entry.result.resultText && (
                          <div className="flex gap-2 mt-1.5">
                            <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-(--g-text-dim) w-8 shrink-0 pt-px">out</span>
                            <pre className="font-mono text-[0.6875rem] text-(--g-text-dim) whitespace-pre-wrap break-all leading-relaxed min-w-0">{entry.result.resultText.slice(0, 600)}{entry.result.resultText.length > 600 ? "…" : ""}</pre>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// QuickActionBar
// ---------------------------------------------------------------------------

/**
 * Diagram + code dropdowns extracted so open/close state never causes ChatMessage to re-render.
 */
export const QuickActionBar = memo(({ msgText, msgIdx, onQuickAction, onFork }: QuickActionBarProps): JSX.Element => {
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const diagramRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);

  const hasDiagram = useMemo(() => /```mermaid/i.test(msgText), [msgText]);
  const hasCode = useMemo(() => /```(?!mermaid\b)(?!json\b)(?!ya?ml\b)(?!markdown?\b)(?!xml\b)(?!html\b)(?!css\b)(?!toml\b)(?!ini\b)(?!te?xt\b)\w/i.test(msgText), [msgText]);

  const diagramDisabled = hasDiagram;
  const codeDisabled = hasCode;

  useEffect(() => {
    if (!diagramOpen && !codeOpen) return;
    const handler = (e: MouseEvent): void => {
      if (diagramOpen && diagramRef.current && !diagramRef.current.contains(e.target as Node)) setDiagramOpen(false);
      if (codeOpen && codeRef.current && !codeRef.current.contains(e.target as Node)) setCodeOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [diagramOpen, codeOpen]);

  return (
    <div className="flex items-center gap-1.5 mt-2">
      <div ref={diagramRef} className="relative">
        <button
          onClick={() => !diagramDisabled && setDiagramOpen((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs font-medium transition-colors",
            diagramDisabled
              ? "border-(--g-border) text-(--g-text-dim) bg-(--g-surface) opacity-40 cursor-not-allowed"
              : "border-(--g-border) text-(--g-text-muted) bg-(--g-surface) hover:text-(--g-accent) hover:border-(--g-border-accent) hover:bg-(--g-accent-dim)",
          )}
          title={hasDiagram ? "Diagram already in this response" : "Generate a mermaid diagram from this response"}
        >
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
          </svg>
          diagram
          <svg width={8} height={8} viewBox="0 0 10 10" fill="none" className={cn("transition-transform duration-150", diagramOpen ? "rotate-180" : "rotate-0")}>
            <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {diagramOpen && (
          <div className="absolute bottom-full mb-1.5 left-0 z-50 min-w-[10rem] rounded-lg border border-(--g-border) bg-(--g-surface) shadow-lg overflow-hidden py-1">
            {DIAGRAM_OPTIONS.map((opt) => (
              <button
                key={opt.type}
                title={opt.title}
                onClick={() => { setDiagramOpen(false); onQuickAction(msgIdx, "diagram", opt.type); }}
                className="flex w-full items-center px-3 py-1.5 text-xs text-left text-(--g-text-muted) hover:bg-(--g-surface-hover) hover:text-(--g-text) transition-colors"
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={codeRef} className="relative">
        <button
          onClick={() => !codeDisabled && setCodeOpen((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs font-medium transition-colors",
            codeDisabled
              ? "border-(--g-border) text-(--g-text-dim) bg-(--g-surface) opacity-40 cursor-not-allowed"
              : "border-(--g-border) text-(--g-text-muted) bg-(--g-surface) hover:text-(--g-accent) hover:border-(--g-border-accent) hover:bg-(--g-accent-dim)",
          )}
          title={hasCode ? "Code already in this response" : "Generate code from this response"}
        >
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
          </svg>
          code
          <svg width={8} height={8} viewBox="0 0 10 10" fill="none" className={cn("transition-transform duration-150", codeOpen ? "rotate-180" : "rotate-0")}>
            <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {codeOpen && (
          <div className="absolute bottom-full mb-1.5 left-0 z-50 min-w-[8rem] rounded-lg border border-(--g-border) bg-(--g-surface) shadow-lg overflow-hidden py-1">
            {CODE_OPTIONS.map((opt) => (
              <button
                key={opt.type}
                onClick={() => { setCodeOpen(false); onQuickAction(msgIdx, "code", opt.type); }}
                className="flex w-full items-center px-3 py-1.5 text-xs text-left text-(--g-text-muted) hover:bg-(--g-surface-hover) hover:text-(--g-text) transition-colors"
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {onFork && <ForkButton msgIdx={msgIdx} onFork={onFork} />}
    </div>
  );
});

// ---------------------------------------------------------------------------
// ChatMessage
// ---------------------------------------------------------------------------

/**
 * Single chat message bubble — user messages are right-aligned, assistant messages left-aligned.
 * Shows model name, debug button, endpoint cards, and verification badge for assistant messages.
 */
export const ChatMessage = memo(({ msg, i, onSelectEndpoint, onSelectDoc, onShowDebug, onRetry, onQuickAction, onFork, onDelete, loadingGif }: ChatMessageProps): JSX.Element => {
  const p = msg.personality ?? "greg";

  const userBubbleStyle = useMemo(() => ({
    background: "var(--g-user-bg)",
    border: "1px solid var(--g-border-accent)",
    color: "var(--g-text)",
  }), []);

  return (
    <div className={cn("group/msg flex", msg.role === "user" ? "justify-end" : "w-full")}>
      <div className={msg.role === "user" ? "max-w-[85%]" : "w-full"}>
        {msg.role === "assistant" && (
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[0.8125rem] font-medium shrink-0" style={{ color: PERSONALITY_COLOR[p] }}>greg</span>
              {msg.model && (
                <span className="font-mono text-[0.6875rem] text-(--g-text-dim) truncate">{msg.model}</span>
              )}
              {((msg.debug && msg.debug.length > 0) || msg.compactedHistory) && !msg.streaming && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onShowDebug(i)}
                  title="Debug trace"
                  className="shrink-0 opacity-60 hover:opacity-100 hover:text-(--g-accent)"
                >
                  {Ic.bug(12)}
                </Button>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {(msg.debug?.filter((e) => e.event === "tool_call").length ?? 0) > 0 && (
                <span
                  className="flex items-center gap-1 font-mono text-[0.6875rem] text-(--g-text-dim)"
                  title={`${msg.debug!.filter((e) => e.event === "tool_call").length} tool call${msg.debug!.filter((e) => e.event === "tool_call").length !== 1 ? "s" : ""}`}
                >
                  <ToolIcon size={10} />
                  {msg.debug!.filter((e) => e.event === "tool_call").length}
                </span>
              )}
              {!msg.streaming && (
                <CopyMarkdownBtn text={cleanText(msg.text)} />
              )}
              {!msg.streaming && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onDelete(i)}
                  title="Delete message"
                  className="opacity-0 group-hover/msg:opacity-60 hover:!opacity-100 text-(--g-danger)"
                >
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6" /><path d="M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </Button>
              )}
            </div>
          </div>
        )}
        <div
          className={cn(
            "text-[0.9375rem] leading-[1.6]",
            msg.role === "user"
              ? "px-4 py-3 rounded-[12px_12px_2px_12px]"
              : "py-2",
          )}
          style={msg.role === "user" ? userBubbleStyle : { color: "var(--g-text)" }}
        >
          {msg.role === "user" ? (
            msg.text
          ) : msg.streaming ? (
            <>
              {loadingGif && !msg.text && (
                <img src={loadingGif} alt="greg thinking" className="block max-h-[180px] max-w-full rounded-lg mb-1.5" />
              )}
              <StreamingText text={msg.text} msgKey={i} {...(msg.personality !== undefined && { personality: msg.personality })} />
            </>
          ) : (
            <GregMarkdown text={cleanText(msg.text)} msgKey={i} />
          )}
          {(msg.verificationText !== undefined || msg.verificationStreaming) && (
            <VerificationBadge text={msg.verificationText ?? ""} {...(msg.verificationUsage !== undefined && { usage: msg.verificationUsage })} msgKey={i} {...(msg.verificationStreaming !== undefined && { streaming: msg.verificationStreaming })} />
          )}
        </div>
        {msg.role === "user" && (
          <div className="flex justify-end gap-0.5 mt-1 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-150">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onRetry(i)}
              title="Retry"
              className="opacity-60 hover:opacity-100 hover:text-(--g-accent)"
            >
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onDelete(i)}
              title="Delete message"
              className="opacity-60 hover:opacity-100 text-(--g-danger)"
            >
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" /><path d="M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </Button>
          </div>
        )}
        {(msg.debug?.some((e) => e.event === "tool_call") || (msg.endpoints && msg.endpoints.length > 0) || (msg.docs && msg.docs.length > 0)) && (
          <div className="flex flex-col gap-1.5 mt-2">
            {msg.debug && msg.debug.some((e) => e.event === "tool_call") && (
              <ToolCallActivity debug={msg.debug} />
            )}
            {msg.endpoints && msg.endpoints.length > 0 && (
              <EndpointDropdown endpoints={msg.endpoints} onSelect={onSelectEndpoint} />
            )}
            {msg.docs && msg.docs.length > 0 && (
              <DocDropdown docs={msg.docs} onSelect={onSelectDoc} />
            )}
          </div>
        )}
        {msg.role === "assistant" && !msg.streaming && (
          <QuickActionBar
            msgText={msg.text}
            msgIdx={i}
            onQuickAction={onQuickAction}
            {...(onFork && { onFork })}
          />
        )}
      </div>
    </div>
  );
});
