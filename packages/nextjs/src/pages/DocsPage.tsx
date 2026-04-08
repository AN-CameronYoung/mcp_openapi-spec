"use client";

import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";

import { METHOD_COLORS } from "../lib/constants";
import { Ic } from "../lib/icons";
import { useStore } from "../store/store";
import GroupedApiSelect from "../components/GroupedApiSelect";

/**
 * Full-page API documentation viewer using a Swagger UI iframe.
 * Supports navigating to a specific endpoint via URL query params,
 * and updates the iframe when the selected API or anchor changes.
 */
const DocsPage = (): JSX.Element => {
  const { apis, docsApi, docsAnchor, setDocsApi, theme } = useStore(
    useShallow((s) => ({ apis: s.apis, docsApi: s.docsApi, docsAnchor: s.docsAnchor, setDocsApi: s.setDocsApi, theme: s.theme })),
  );

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const iframeKeyRef = useRef(0);

  const selectedApi = docsApi || (apis.length > 0 ? apis[0]!.name : "");
  const apiInfo = apis.find((a) => a.name === selectedApi);

  const resolvedTheme = theme === "system"
    ? (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;

  // Pass method+path+theme as query params
  const params = new URLSearchParams();
  if (docsAnchor) {
    params.set("method", docsAnchor.method);
    params.set("path", docsAnchor.path);
  }
  params.set("theme", resolvedTheme);
  const qs = `?${params}`;

  const iframeSrc = selectedApi ? `/openapi/docs/${selectedApi}${qs}` : "";

  // Force iframe reload when anchor changes by bumping the key
  useEffect(() => {
    if (docsAnchor) {
      iframeKeyRef.current++;
    }
  }, [docsAnchor]);

  return (
    <div className="flex flex-col h-[calc(100%-3.5rem)] px-5 py-3.5">
      {/* Header */}
      <div className="flex items-center gap-3.5 mb-[0.6875rem] shrink-0">
        <div className="relative flex items-center">
          <div className="absolute left-2.5 z-1 flex pointer-events-none text-(--g-text-dim)">
            {Ic.server()}
          </div>
          <GroupedApiSelect
            apis={apis}
            value={selectedApi}
            onChange={setDocsApi}
            height={42}
            fontSize={16}
            minWidth={196}
            color="var(--g-text)"
            withIcon
          />
        </div>
        {apiInfo && (
          <span className="text-[0.9375rem] text-(--g-text-dim)">{apiInfo.endpoints} endpoints</span>
        )}
        <a
          href={iframeSrc}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 ml-auto text-[0.9375rem] text-(--g-accent) no-underline"
        >
          {Ic.ext()} New tab
        </a>
      </div>

      {/* Navigation breadcrumb */}
      {docsAnchor && (
        <div className="flex items-center gap-[0.4375rem] mb-[0.6875rem] px-[0.6875rem] py-[0.4375rem] rounded-md border border-(--g-border-accent) bg-(--g-accent-dim) text-[0.9375rem] shrink-0">
          <span className="flex text-(--g-accent)">{Ic.arr()}</span>
          <span className="text-(--g-text-muted)">Navigated to</span>
          <span
            className="method-badge"
            style={{
              background: METHOD_COLORS[docsAnchor.method]?.bg,
              color: METHOD_COLORS[docsAnchor.method]?.text,
              border: `1px solid ${METHOD_COLORS[docsAnchor.method]?.border}`,
            }}
          >
            {docsAnchor.method}
          </span>
          <code className="font-mono text-[0.9375rem] text-(--g-text)">{docsAnchor.path}</code>
        </div>
      )}

      {/* Swagger iframe */}
      {selectedApi ? (
        <iframe
          key={`${selectedApi}-${qs}-${iframeKeyRef.current}`}
          ref={iframeRef}
          src={iframeSrc}
          className="flex-1 w-full rounded-md border border-(--g-border) bg-(--g-surface)"
          title={`${selectedApi} API docs`}
        />
      ) : (
        <div className="flex flex-col flex-1 items-center justify-center gap-3.5 rounded-md border border-(--g-border) bg-(--g-surface)">
          <div className="flex text-(--g-text-dim)">{Ic.doc(38)}</div>
          <span className="text-base text-(--g-text-dim)">No APIs ingested yet</span>
        </div>
      )}
    </div>
  );
};

export default DocsPage;
