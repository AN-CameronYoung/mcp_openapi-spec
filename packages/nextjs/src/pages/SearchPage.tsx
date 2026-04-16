"use client";

import { useState, useMemo, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";

import { METHOD_COLORS } from "../lib/constants";
import { Ic } from "../lib/icons";
import { searchEndpoints, searchSchemas, searchDocs, searchAll } from "../lib/api";
import type { SearchResult } from "../lib/api";
import { cn } from "../lib/utils";
import { useStore } from "../store/store";
import DetailPanel from "../components/DetailPanel";
import GroupedApiSelect from "../components/GroupedApiSelect";
import ScoreBar from "../components/ScoreBar";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";

type SearchTab = "endpoints" | "schemas" | "docs" | "all";

/**
 * Semantic search page with endpoint/schema/docs/all tab toggle, API filter, and an inline detail panel.
 */
const SearchPage = (): JSX.Element => {
  const { apis, detailItem, detailType, setDetail } = useStore(
    useShallow((s) => ({ apis: s.apis, detailItem: s.detailItem, detailType: s.detailType, setDetail: s.setDetail })),
  );

  const [query, setQuery] = useState("");
  const [apiFilter, setApiFilter] = useState("all");
  const [tab, setTab] = useState<SearchTab>("endpoints");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);

  const doSearch = useCallback(
    async (q: string, t: SearchTab, api: string) => {
      if (!q.trim()) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const apiParam = api === "all" ? undefined : api;
        let r: SearchResult[];
        if (t === "endpoints" || t === "schemas") {
          const fn = t === "endpoints" ? searchEndpoints : searchSchemas;
          r = await fn(q, apiParam, 20);
        } else if (t === "docs") {
          r = await searchDocs(q, apiParam ? { project: apiParam } : undefined, 20);
        } else {
          r = await searchAll(q, apiParam, 20);
        }
        setResults(r);
      } catch {
        setResults([]);
      }
      setLoading(false);
    },
    [],
  );

  const handleSearch = () => doSearch(query, tab, apiFilter);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const filtered = useMemo(() => {
    if (apiFilter === "all") return results;
    return results.filter((r) => r.api === apiFilter);
  }, [results, apiFilter]);

  const placeholderText = tab === "docs" ? "Search documentation..."
    : tab === "all" ? "Search APIs and docs..."
    : "Search endpoints and schemas...";

  return (
    <div className="flex flex-col h-[calc(100%-2.75rem)] px-4 py-3.5">
      {/* Search bar + filter */}
      <div className="flex gap-2 mb-[0.6875rem] shrink-0">
        <div className="relative flex items-center">
          <div className="absolute left-2.5 z-1 flex pointer-events-none text-(--g-text-dim)">
            {Ic.server()}
          </div>
          <GroupedApiSelect
            apis={apis}
            value={apiFilter}
            onChange={setApiFilter}
            allLabel={tab === "docs" || tab === "all" ? "All Projects" : "All APIs"}
            height={44}
            fontSize={15}
            minWidth={140}
            withIcon
          />
        </div>
        <div className="relative flex-1">
          <div className="absolute left-[0.8125rem] top-[0.8125rem] flex text-(--g-text-dim)">
            {Ic.search()}
          </div>
          <Input
            type="text"
            placeholder={placeholderText}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="pl-[2.375rem]"
          />
        </div>
      </div>

      {/* Tab toggle */}
      <div className="flex gap-[0.1875rem] mb-2 shrink-0">
        {(
          [
            { key: "endpoints" as const, icon: Ic.bolt, label: "Endpoints" },
            { key: "schemas" as const, icon: Ic.cube, label: "Schemas" },
            { key: "docs" as const, icon: Ic.doc, label: "Docs" },
            { key: "all" as const, icon: Ic.search, label: "All" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setDetail(null);
              if (query.trim()) doSearch(query, t.key, apiFilter);
            }}
            className={cn(
              "flex items-center gap-1 py-1 px-[0.8125rem] rounded-md border-none cursor-pointer text-[0.9375rem] font-medium",
              tab === t.key
                ? "bg-(--g-accent-muted) text-(--g-accent)"
                : "bg-transparent text-(--g-text-dim)",
            )}
          >
            {t.icon()}
            {t.label}
          </button>
        ))}
        <span className="self-center ml-auto text-sm text-(--g-text-dim)">
          {loading ? "searching..." : `${filtered.length} result${filtered.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* Results + detail */}
      <div className="flex gap-3.5 flex-1 min-h-0">
        <div className="flex-1 min-w-0 overflow-auto">
          {filtered.map((item) => {
            const isSel = detailItem && "id" in detailItem && detailItem.id === item.id;
            const isDoc = item.type === "doc";
            const isEp = !isDoc && (tab === "endpoints" || tab === "all");
            const m = isEp && item.method ? METHOD_COLORS[item.method] ?? METHOD_COLORS.GET : null;

            const detailTab = isDoc ? "docs" as const : (tab === "all" ? "endpoints" as const : tab);

            return (
              <div
                key={item.id}
                onClick={() => setDetail(isSel ? null : item, detailTab)}
                className={cn(
                  "py-2 px-[0.6875rem] mb-px rounded-md cursor-pointer border-l-2",
                  isSel
                    ? "border-l-(--g-accent) bg-(--g-surface-active)"
                    : "border-l-transparent bg-transparent hover:bg-(--g-surface-hover)",
                )}
              >
                <div className="flex items-center gap-[0.4375rem]">
                  {/* Source badge for "all" tab */}
                  {tab === "all" && (
                    <span className={cn(
                      "text-[0.6875rem] px-1.5 py-px rounded font-semibold uppercase tracking-wider",
                      isDoc
                        ? "bg-purple-500/10 text-purple-500"
                        : "bg-(--g-accent-muted) text-(--g-accent)",
                    )}>
                      {isDoc ? "DOC" : "API"}
                    </span>
                  )}

                  {isDoc ? (
                    <>
                      <span className="flex opacity-50 shrink-0 text-purple-500">
                        {Ic.doc(15)}
                      </span>
                      <span className="text-[0.9375rem] font-semibold text-(--g-text)">
                        {item.name}
                      </span>
                      {item.path && (
                        <span className="text-xs text-(--g-text-dim) truncate">
                          {item.path}
                        </span>
                      )}
                    </>
                  ) : m ? (
                    <>
                      <Badge
                        variant="method"
                        style={{
                          background: m.bg,
                          color: m.text,
                          border: `1px solid ${m.border}`,
                          minWidth: 46,
                        }}
                      >
                        {item.method}
                      </Badge>
                      <code className="flex-1 font-mono text-[0.9375rem] text-(--g-text) truncate">
                        {item.path}
                      </code>
                    </>
                  ) : (
                    <>
                      <span className="flex opacity-35 shrink-0 text-(--g-accent)">
                        {Ic.cube(15)}
                      </span>
                      <span className="text-[0.9375rem] font-semibold font-mono text-(--g-text)">
                        {item.name}
                      </span>
                    </>
                  )}

                  <span className="flex items-center gap-[0.4375rem] ml-auto shrink-0">
                    <ScoreBar score={item.score} />
                    <Badge variant="api">
                      {item.api}
                    </Badge>
                  </span>
                </div>
                <p
                  className={cn(
                    "mt-[0.1875rem] text-sm leading-[1.4] truncate text-(--g-text-dim)",
                    isDoc ? "pl-6" : m ? "pl-14" : "pl-6",
                  )}
                >
                  {item.description}
                </p>
              </div>
            );
          })}

          {/* Empty states */}
          {!loading && filtered.length === 0 && query.trim() && (
            <div className="p-8 text-center text-base text-(--g-text-dim)">
              No results
            </div>
          )}
          {!query.trim() && (
            <div className="p-8 text-center text-base text-(--g-text-dim)">
              Type a query and press Enter to search
            </div>
          )}
        </div>

        {/* Detail panel */}
        {detailItem && (
          <div className="w-[26.875rem] shrink-0">
            <DetailPanel item={detailItem as never} type={detailType} onClose={() => setDetail(null)} />
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchPage;
