"use client";

import { useState, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import { Ic } from "../lib/icons";
import { getDocContent } from "../lib/api";
import { useStore } from "../store/store";
import GroupedDocSelect from "../components/GroupedDocSelect";
import MarkdownContent from "../components/MarkdownContent";
import { splitIntoPages, PAGE_LIMIT } from "../lib/docPagination";

/**
 * Full-page markdown documentation viewer.
 * Shows a grouped dropdown of ingested docs and renders the selected doc's raw markdown.
 * Large documents are split into pages at H1/H2 boundaries to keep renders fast.
 */
const DocsPage = (): JSX.Element => {
  const { docs, selectedDoc, setSelectedDoc } = useStore(
    useShallow((s) => ({ docs: s.docs, selectedDoc: s.selectedDoc, setSelectedDoc: s.setSelectedDoc })),
  );

  const [pages, setPages] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(() => {
    try { const v = parseFloat(localStorage.getItem("greg-docs-zoom") ?? ""); return v > 0 ? v : 1; } catch { return 1; }
  });
  const contentScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem("greg-docs-zoom", String(zoom)); } catch {}
  }, [zoom]);

  // Scroll to top whenever the page changes
  useEffect(() => {
    contentScrollRef.current?.scrollTo({ top: 0 });
  }, [pageIndex]);

  const activeName = selectedDoc || (docs.length > 0 ? docs[0]!.name : "");

  // Fetch content when selection changes
  useEffect(() => {
    if (!activeName) {
      setPages([]);
      setPageIndex(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getDocContent(activeName)
      .then((text) => {
        if (!cancelled) {
          setPages(splitIntoPages(text || "(empty document)", PAGE_LIMIT));
          setPageIndex(0);
        }
      })
      .catch((err) => {
        console.error("getDocContent failed:", err);
        if (!cancelled) {
          setPages([`Error loading document: ${err}`]);
          setPageIndex(0);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeName]);

  const activeDoc = docs.find((d) => d.name === activeName);

  return (
    <div className="flex flex-col h-[calc(100%-2.75rem)] px-5 py-3.5">
      {/* Header */}
      <div className="flex items-center gap-3.5 mb-[0.6875rem] shrink-0 flex-wrap">
        <div className="relative flex items-center">
          <div className="absolute left-2.5 z-1 flex pointer-events-none text-(--g-text-dim)">
            {Ic.doc()}
          </div>
          <GroupedDocSelect
            docs={docs}
            value={activeName}
            onChange={setSelectedDoc}
            height={42}
            fontSize={16}
            minWidth={196}
            color="var(--g-text)"
          />
        </div>

        {activeDoc && (
          <>
            <span className="text-[0.9375rem] text-(--g-text-dim)">{activeDoc.category}</span>
            {activeDoc.project && (
              <span className="text-[0.9375rem] text-(--g-text-dim)">{activeDoc.project}</span>
            )}
            {activeDoc.apiRefs?.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="flex text-(--g-text-dim)">{Ic.server()}</span>
                {activeDoc.apiRefs!.map((ref) => (
                  <span
                    key={ref}
                    onClick={() => {
                      useStore.getState().setApisApi(ref);
                      useStore.getState().setPage("apis");
                    }}
                    className="text-xs px-1.5 py-0.5 rounded bg-(--g-accent-muted) text-(--g-accent) font-medium cursor-pointer hover:opacity-80"
                  >
                    {ref}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
        <span className="flex-1" />

        {/* Pagination controls — hidden for single-page docs */}
        {pages.length > 1 && (
          <>
            <button
              onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
              disabled={pageIndex === 0}
              title="Previous page"
              className="flex items-center justify-center w-5 h-5 rounded text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors disabled:opacity-30 disabled:cursor-default"
            >
              <svg width={14} height={14} viewBox="0 0 16 16" fill="none">
                <path d="M10 3L6 8l4 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="text-[0.625rem] font-mono text-(--g-text-dim) tabular-nums select-none" style={{ minWidth: "4.5rem", textAlign: "center" }}>
              {pageIndex + 1} / {pages.length}
            </span>
            <button
              onClick={() => setPageIndex((i) => Math.min(pages.length - 1, i + 1))}
              disabled={pageIndex === pages.length - 1}
              title="Next page"
              className="flex items-center justify-center w-5 h-5 rounded text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors disabled:opacity-30 disabled:cursor-default"
            >
              <svg width={14} height={14} viewBox="0 0 16 16" fill="none">
                <path d="M6 3l4 5-4 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="w-px h-3.5 bg-(--g-border) mx-0.5" />
          </>
        )}

        {/* Zoom controls */}
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
        <button onClick={() => setZoom((z) => Math.min(2, parseFloat((z + 0.1).toFixed(1))))} title="Zoom in" className="flex items-center justify-center w-5 h-5 rounded text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors">
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M4.5 6.5h4M6.5 4.5v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Markdown content */}
      {activeName ? (
        <div ref={contentScrollRef} className="flex-1 min-h-0 overflow-auto rounded-md border border-(--g-border) bg-(--g-bg) p-5">
          {loading ? (
            <div className="flex items-center justify-center h-full text-base text-(--g-text-dim)">
              Loading...
            </div>
          ) : (
            <MarkdownContent content={pages[pageIndex] ?? ""} style={zoom !== 1 ? { zoom } : undefined} />
          )}
        </div>
      ) : (
        <div className="flex flex-col flex-1 items-center justify-center gap-3.5 rounded-md border border-(--g-border) bg-(--g-surface)">
          <div className="flex text-(--g-text-dim)">{Ic.doc(38)}</div>
          <span className="text-base text-(--g-text-dim)">No docs ingested yet</span>
        </div>
      )}
    </div>
  );
};

export default DocsPage;
