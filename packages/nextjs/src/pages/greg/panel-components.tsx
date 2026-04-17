"use client";

import React, { useState, useRef, useEffect, useMemo, memo } from "react";
import { useShallow } from "zustand/react/shallow";

import { Ic } from "../../lib/icons";
import { cn } from "../../lib/utils";
import { useStore } from "../../store/store";
import { getDocContent } from "../../lib/api";
import ApiViewer from "../../components/ApiViewer";
import GroupedApiSelect from "../../components/GroupedApiSelect";
import GroupedDocSelect from "../../components/GroupedDocSelect";
import MarkdownContent from "../../components/MarkdownContent";
import { Button } from "../../components/ui/button";
import { splitIntoPages, PAGE_LIMIT } from "../../lib/docPagination";
import type { DebugPanelProps, DebugPanelEntriesProps, SwaggerPanelProps, DocsSidePanelProps } from "./types";
import { collapseBtn, debugEntry, debugGroupLabel, EMPTY_DEBUG } from "./constants";
import { estimateCost, slugifyHeading, findPageWithHeading } from "./utils";
import { GregMarkdown } from "./markdown-components";
import { cleanText } from "./utils";

// ---------------------------------------------------------------------------
// DebugPanelEntries
// ---------------------------------------------------------------------------

/**
 * Renders the list of debug trace entries inside the debug panel.
 */
export const DebugPanelEntries = ({ entries }: DebugPanelEntriesProps): JSX.Element => {
  const [expandedIdx, setExpandedIdx] = useState<Set<number>>(new Set());

  const toggleExpand = (i: number): void => {
    setExpandedIdx((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const rows: React.ReactNode[] = [];
  let currentGroup = "";
  let roundNum = 0;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as Record<string, unknown>;
    const ev = e.event as string;

    if (ev === "round") {
      roundNum++;
      const group = `round ${roundNum}`;
      if (group !== currentGroup) {
        currentGroup = group;
        rows.push(
          <div key={`grp-${i}`} className={debugGroupLabel}>
            {group}
          </div>,
        );
      }
      const inTok = (e.inputTokens as number ?? 0).toLocaleString();
      const outTok = (e.outputTokens as number ?? 0).toLocaleString();
      const stop = e.stopReason as string ?? "";
      rows.push(
        <div key={`r-${i}`} className={cn(debugEntry, "font-medium truncate text-(--g-accent)")}>
          in:{inTok} out:{outTok} stop:{stop}
        </div>,
      );
      continue;
    }

    if (ev === "tool_call") {
      const name = e.name as string;
      const inputStr = JSON.stringify(e.input);
      const full = `${name}(${inputStr})`;
      const truncated = full.length > 80;
      const preview = truncated ? full.slice(0, 80) + "…" : full;
      const expanded = expandedIdx.has(i);
      rows.push(
        <div key={`tc-${i}`} className={debugEntry}>
          <span className="text-(--g-accent)">→ </span>
          <span className="text-(--g-green)">{expanded ? full : preview}</span>
          {truncated && (
            <button onClick={() => toggleExpand(i)} className="pl-1 border-none bg-transparent cursor-pointer font-mono text-[0.625rem] text-(--g-accent)">
              {expanded ? "less" : "more"}
            </button>
          )}
        </div>,
      );
      continue;
    }

    if (ev === "tool_result") {
      const name = e.name as string;
      const len = (e.resultLength as number ?? 0).toLocaleString();
      const count = e.endpointCount as number ?? 0;
      const resultText = e.resultText as string ?? "";
      const preview = resultText.slice(0, 200);
      const truncated = resultText.length > 200;
      const expanded = expandedIdx.has(i);
      rows.push(
        <div key={`tr-${i}`} className={cn(debugEntry, "ml-2")}>
          <span className="text-(--g-text-muted)">← {name}: {len} chars, {count} cards</span>
          <div className="mt-px text-[0.625rem] text-(--g-text-dim) whitespace-pre-wrap wrap-break-word">
            {expanded ? resultText : preview}{truncated && !expanded && "…"}
          </div>
          {truncated && (
            <button onClick={() => toggleExpand(i)} className="pl-0 border-none bg-transparent cursor-pointer font-mono text-[0.625rem] text-(--g-accent)">
              {expanded ? "show less" : `show all (${(e.resultLength as number ?? 0).toLocaleString()} chars)`}
            </button>
          )}
        </div>,
      );
      continue;
    }

    rows.push(
      <div key={`oth-${i}`} className={cn(debugEntry, "truncate text-(--g-text-dim)")}>
        {JSON.stringify(e)}
      </div>,
    );
  }

  return <>{rows}</>;
};

// ---------------------------------------------------------------------------
// DebugPanel
// ---------------------------------------------------------------------------

/**
 * Side panel showing the full debug trace for a completed assistant message.
 */
export const DebugPanel = memo(({ entries, model, compactedTokens, compactedHistory, onClose }: DebugPanelProps): JSX.Element => {
  const [showHistory, setShowHistory] = useState(true);

  const rounds = entries.filter((e) => (e as { event: string }).event === "round");
  const lastRound = rounds[rounds.length - 1] as { totalInput?: number; totalOutput?: number; inputTokens?: number; outputTokens?: number } | undefined;
  const primaryTokens = lastRound ? ((lastRound.totalInput ?? lastRound.inputTokens ?? 0) + (lastRound.totalOutput ?? lastRound.outputTokens ?? 0)) : 0;
  const toolCallCount = entries.filter((e) => (e as { event: string }).event === "tool_call").length;

  const verifyEntry = entries.find((e) => (e as { event: string }).event === "verification_done") as { inputTokens?: number; outputTokens?: number } | undefined;
  const verifyTokens = verifyEntry ? ((verifyEntry.inputTokens ?? 0) + (verifyEntry.outputTokens ?? 0)) : 0;
  const grandTotal = primaryTokens + verifyTokens;

  const primaryCost = estimateCost(model, {
    input: (lastRound?.totalInput ?? lastRound?.inputTokens ?? 0),
    output: (lastRound?.totalOutput ?? lastRound?.outputTokens ?? 0),
  });
  const verifyCost = verifyEntry ? estimateCost("claude-sonnet-4", {
    input: verifyEntry.inputTokens ?? 0,
    output: verifyEntry.outputTokens ?? 0,
  }) : null;
  const totalCostNum = (primaryCost ? parseFloat(primaryCost) : 0) + (verifyCost ? parseFloat(verifyCost) : 0);
  const cost = totalCostNum > 0 ? totalCostNum.toFixed(Math.max(2, 6 - Math.floor(Math.log10(totalCostNum)))) : primaryCost;

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden border-l border-(--g-border) bg-(--g-surface)">
      <div className="flex items-center shrink-0 px-3.5 py-2.5 border-b border-(--g-border) bg-(--g-bg)">
        <span className="flex-1 text-xs font-medium text-(--g-text-muted)">Debug trace</span>
        <span className={cn(debugEntry, "mr-2 text-(--g-text-dim)")}>{entries.length} events</span>
        <Button variant="ghost" size="icon-xs" onClick={onClose}>{Ic.x(12)}</Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-2.5">
        {entries.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-xs text-(--g-text-dim)">
            No debug data yet
          </div>
        ) : (
          <DebugPanelEntries entries={entries} />
        )}
        {compactedHistory && compactedHistory.length > 0 && (
          <div className="mt-3 border-t border-(--g-border) pt-2.5">
            <button
              onClick={() => setShowHistory((v) => !v)}
              className={cn(collapseBtn, "text-[0.625rem] font-mono text-(--g-text-dim) hover:text-(--g-text-muted) mb-1.5")}
            >
              <span className={cn("transition-transform duration-150", showHistory ? "rotate-90" : "rotate-0")}>▶</span>
              <span className="ml-1">context sent ({compactedHistory.length} messages{compactedTokens ? `, -${compactedTokens.toLocaleString()} tok` : ""})</span>
            </button>
            {showHistory && (
              <div className="flex flex-col gap-2">
                {[...compactedHistory].reverse().map((m, i) => (
                  <div key={i} className="text-[0.625rem] font-mono">
                    <span className={cn("font-semibold", m.role === "user" ? "text-(--g-accent)" : "text-(--g-method-patch-text)")}>{m.role}</span>
                    <pre className="whitespace-pre-wrap break-all mt-0.5 text-(--g-text-dim) leading-[1.5]">{m.content}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 shrink-0 px-3 py-[0.4375rem] border-t border-(--g-border) bg-(--g-bg)">
        <div className="flex gap-3.5">
          <span className={cn(debugEntry, "text-(--g-text-dim)")}>
            primary <span className="text-(--g-text-muted)">{primaryTokens.toLocaleString()}</span>
          </span>
          {verifyTokens > 0 && (
            <span className={cn(debugEntry, "text-(--g-text-dim)")}>
              double check <span className="text-(--g-green)">{verifyTokens.toLocaleString()}</span>
            </span>
          )}
          <span className={cn(debugEntry, "text-(--g-text-dim)")}>
            <span className="text-(--g-text-muted)">{toolCallCount}</span> tools
          </span>
          {compactedTokens !== undefined ? (
            <span className={cn(debugEntry, compactedTokens > 0 ? "text-(--g-method-patch-text)" : "text-(--g-text-dim)")}>
              auto-compact: {compactedTokens > 0 ? `-${compactedTokens.toLocaleString()} tok` : "on"}
            </span>
          ) : null}
        </div>
        <div className="flex gap-3.5">
          <span className={cn(debugEntry, "font-semibold text-(--g-text)")}>
            total {grandTotal.toLocaleString()} tokens
          </span>
          {cost && (
            <span className={cn(debugEntry, "text-(--g-text-dim)")}>
              ${cost}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// SwaggerPanel
// ---------------------------------------------------------------------------

/**
 * Side panel showing Swagger UI with an API selector dropdown.
 * Accepts an optional anchor (api + method/path) for navigating to a specific endpoint.
 */
export const SwaggerPanel = memo(({ anchor, onClose }: SwaggerPanelProps): JSX.Element => {
  const { apis } = useStore(useShallow((s) => ({ apis: s.apis })));

  const [searchQuery, setSearchQuery] = useState("");
  const [zoom, setZoom] = useState(() => {
    try { const v = parseFloat(localStorage.getItem("greg-panel-zoom") ?? ""); return v > 0 ? v : 0.8; } catch { return 0.8; }
  });
  const defaultApi = anchor?.api ?? apis[0]?.name ?? "";
  const [selectedApi, setSelectedApi] = useState(defaultApi);

  useEffect(() => {
    if (anchor?.api && anchor.api !== selectedApi) setSelectedApi(anchor.api);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor?.api]);

  useEffect(() => {
    try { localStorage.setItem("greg-panel-zoom", String(zoom)); } catch {}
  }, [zoom]);

  useEffect(() => { setSearchQuery(""); }, [selectedApi]);

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-(--g-border) bg-(--g-surface)">
        <GroupedApiSelect
          apis={apis}
          value={selectedApi}
          onChange={setSelectedApi}
          height={28}
          fontSize={12}
          minWidth={120}
          color="var(--g-text)"
        />
        <span className="flex-1" />
        <div className="relative flex items-center">
          <span className="absolute left-1.5 text-(--g-text-dim) pointer-events-none">{Ic.search(11)}</span>
          <input
            type="text"
            placeholder="Search…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-6 w-32 rounded border border-(--g-border) bg-(--g-surface) pl-6 pr-5 text-xs text-(--g-text) placeholder:text-(--g-text-dim) focus:border-(--g-accent) focus:outline-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-1 text-(--g-text-dim) hover:text-(--g-text)">
              {Ic.x(10)}
            </button>
          )}
        </div>
        <button onClick={() => setZoom((z) => Math.max(0.4, parseFloat((z - 0.1).toFixed(1))))} title="Zoom out" className="flex items-center justify-center w-5 h-5 rounded text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors">
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M4.5 6.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
        <span className="text-[0.625rem] font-mono text-(--g-text-dim) w-7 text-center tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <button onClick={() => setZoom((z) => Math.min(1.5, parseFloat((z + 0.1).toFixed(1))))} title="Zoom in" className="flex items-center justify-center w-5 h-5 rounded text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors">
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M4.5 6.5h4M6.5 4.5v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
        <Button variant="ghost" size="icon-xs" onClick={() => window.open(`/openapi/docs/${encodeURIComponent(selectedApi)}`, "_blank")} title="Open in new tab">
          {Ic.ext()}
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={onClose} title="Close panel">
          {Ic.x(12)}
        </Button>
      </div>

      {selectedApi ? (
        <div className="flex-1 min-h-0 overflow-hidden rounded-b-md border border-t-0 border-(--g-border) bg-(--g-bg)">
          <ApiViewer
            apiName={selectedApi}
            anchor={anchor?.api === selectedApi && anchor.method && anchor.path ? { method: anchor.method, path: anchor.path } : null}
            searchQuery={searchQuery}
            zoom={zoom}
          />
        </div>
      ) : (
        <div className="flex flex-col flex-1 items-center justify-center gap-3 rounded-b-md border border-t-0 border-(--g-border) bg-(--g-surface) text-(--g-text-dim)">
          <div className="flex">{Ic.doc(32)}</div>
          <span className="text-sm">{apis.length > 0 ? "Select an api from the dropdown" : "no apis ingested yet"}</span>
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// DocsSidePanel
// ---------------------------------------------------------------------------

/**
 * Side panel showing raw markdown documentation with a doc selector dropdown.
 * Large documents are split into pages at H1/H2 boundaries to keep renders fast.
 */
export const DocsSidePanel = memo(({ onClose, anchor }: DocsSidePanelProps): JSX.Element => {
  const { docs } = useStore(useShallow((s) => ({ docs: s.docs })));

  const [selectedDoc, setSelectedDoc] = useState(docs[0]?.name ?? "");
  const [pages, setPages] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [zoom, setZoom] = useState(() => {
    try { const v = parseFloat(localStorage.getItem("greg-docs-zoom") ?? ""); return v > 0 ? v : 1.0; } catch { return 1.0; }
  });
  const contentScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem("greg-docs-zoom", String(zoom)); } catch {}
  }, [zoom]);

  useEffect(() => { setSearchQuery(""); }, [selectedDoc]);

  useEffect(() => {
    if (anchor?.docName && anchor.docName !== selectedDoc) {
      setSelectedDoc(anchor.docName);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor?.docName]);

  useEffect(() => {
    const name = selectedDoc || docs[0]?.name;
    if (!name) { setPages([]); setPageIndex(0); return; }
    let cancelled = false;
    setLoading(true);
    getDocContent(name)
      .then((text) => {
        if (!cancelled) {
          setPages(splitIntoPages(text || "(empty document)", PAGE_LIMIT));
          setPageIndex(0);
        }
      })
      .catch((err) => {
        console.error("getDocContent failed:", err);
        if (!cancelled) { setPages([`Error loading document: ${err}`]); setPageIndex(0); }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDoc, docs]);

  useEffect(() => {
    if (!anchor?.heading || pages.length === 0) return;
    setPageIndex(findPageWithHeading(pages, anchor.heading));
  }, [anchor?.heading, pages]);

  useEffect(() => {
    if (!anchor?.heading || loading) return;
    const slug = slugifyHeading(anchor.heading);
    const id = requestAnimationFrame(() => {
      const el = document.getElementById(slug);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [pageIndex, anchor, loading]);

  const activeName = selectedDoc || (docs[0]?.name ?? "");

  const lowerQuery = searchQuery.toLowerCase();
  const matchingPageIndices = useMemo(
    () => (lowerQuery ? pages.map((p, i) => (p.toLowerCase().includes(lowerQuery) ? i : -1)).filter((i) => i !== -1) : []),
    [pages, lowerQuery],
  );
  const currentMatchPos = lowerQuery ? matchingPageIndices.indexOf(pageIndex) : -1;

  useEffect(() => {
    if (lowerQuery && matchingPageIndices.length > 0 && !matchingPageIndices.includes(pageIndex)) {
      setPageIndex(matchingPageIndices[0]!);
      contentScrollRef.current?.scrollTo({ top: 0 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lowerQuery, pages]);

  const goToMatch = (dir: 1 | -1): void => {
    if (matchingPageIndices.length === 0) return;
    const next = currentMatchPos === -1
      ? (dir === 1 ? 0 : matchingPageIndices.length - 1)
      : (currentMatchPos + dir + matchingPageIndices.length) % matchingPageIndices.length;
    setPageIndex(matchingPageIndices[next]!);
    contentScrollRef.current?.scrollTo({ top: 0 });
  };

  return (
    <div className="flex flex-col h-full min-w-0">
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-(--g-border) bg-(--g-surface)">
        <GroupedDocSelect
          docs={docs}
          value={activeName}
          onChange={setSelectedDoc}
          height={28}
          fontSize={12}
          minWidth={120}
          color="var(--g-text)"
        />
        <span className="flex-1" />
        <div className="relative flex items-center">
          <span className="absolute left-1.5 text-(--g-text-dim) pointer-events-none">{Ic.search(11)}</span>
          <input
            type="text"
            placeholder="Search…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-6 w-28 rounded border border-(--g-border) bg-(--g-surface) pl-6 pr-5 text-xs text-(--g-text) placeholder:text-(--g-text-dim) focus:border-(--g-accent) focus:outline-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-1 text-(--g-text-dim) hover:text-(--g-text)">
              {Ic.x(10)}
            </button>
          )}
        </div>
        {lowerQuery && (
          <div className="flex items-center gap-0.5">
            <button onClick={() => goToMatch(-1)} title="Previous match" className="flex items-center justify-center w-4 h-4 rounded text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors disabled:opacity-30" disabled={matchingPageIndices.length === 0}>
              <svg width={10} height={10} viewBox="0 0 16 16" fill="none"><path d="M10 3L6 8l4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <span className="text-[0.5625rem] font-mono text-(--g-text-dim) tabular-nums select-none w-[3.25rem] text-center">
              {matchingPageIndices.length === 0 ? "no match" : `${currentMatchPos + 1}/${matchingPageIndices.length}`}
            </span>
            <button onClick={() => goToMatch(1)} title="Next match" className="flex items-center justify-center w-4 h-4 rounded text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors disabled:opacity-30" disabled={matchingPageIndices.length === 0}>
              <svg width={10} height={10} viewBox="0 0 16 16" fill="none"><path d="M6 3l4 5-4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        )}
        {!lowerQuery && pages.length > 1 && (
          <>
            <button
              onClick={() => { setPageIndex((i) => Math.max(0, i - 1)); contentScrollRef.current?.scrollTo({ top: 0 }); }}
              disabled={pageIndex === 0}
              title="Previous page"
              className="flex items-center justify-center w-4 h-4 rounded text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors disabled:opacity-30 disabled:cursor-default"
            >
              <svg width={10} height={10} viewBox="0 0 16 16" fill="none">
                <path d="M10 3L6 8l4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="text-[0.5625rem] font-mono text-(--g-text-dim) tabular-nums select-none" style={{ minWidth: "3rem", textAlign: "center" }}>
              {pageIndex + 1}/{pages.length}
            </span>
            <button
              onClick={() => { setPageIndex((i) => Math.min(pages.length - 1, i + 1)); contentScrollRef.current?.scrollTo({ top: 0 }); }}
              disabled={pageIndex === pages.length - 1}
              title="Next page"
              className="flex items-center justify-center w-4 h-4 rounded text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors disabled:opacity-30 disabled:cursor-default"
            >
              <svg width={10} height={10} viewBox="0 0 16 16" fill="none">
                <path d="M6 3l4 5-4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </>
        )}
        <button onClick={() => setZoom((z) => Math.max(0.6, parseFloat((z - 0.1).toFixed(1))))} title="Zoom out" className="flex items-center justify-center w-5 h-5 rounded text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors">
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M4.5 6.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
        <span className="text-[0.625rem] font-mono text-(--g-text-dim) w-7 text-center tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <button onClick={() => setZoom((z) => Math.min(1.6, parseFloat((z + 0.1).toFixed(1))))} title="Zoom in" className="flex items-center justify-center w-5 h-5 rounded text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors">
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M4.5 6.5h4M6.5 4.5v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
        <Button variant="ghost" size="icon-xs" onClick={() => window.open(`${window.location.origin}${window.location.pathname}#docs`, "_blank")} title="Open in new tab">
          {Ic.ext()}
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={onClose} title="Close panel">
          {Ic.x(12)}
        </Button>
      </div>

      {activeName ? (
        <div ref={contentScrollRef} className="flex-1 min-h-0 overflow-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center h-full text-(--g-text-dim)">Loading...</div>
          ) : (
            <div style={{ fontSize: `${zoom}em` }}>
              <MarkdownContent content={pages[pageIndex] ?? ""} className="text-(--g-text-muted) leading-relaxed" />
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col flex-1 items-center justify-center gap-3 text-(--g-text-dim)">
          <div className="flex">{Ic.doc(32)}</div>
          <span className="text-sm">No docs ingested yet</span>
        </div>
      )}
    </div>
  );
});
