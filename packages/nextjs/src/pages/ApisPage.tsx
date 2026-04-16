"use client";

import { useShallow } from "zustand/react/shallow";

import { METHOD_COLORS } from "../lib/constants";
import { Ic } from "../lib/icons";
import { useStore } from "../store/store";
import ApiViewer from "../components/ApiViewer";
import GroupedApiSelect from "../components/GroupedApiSelect";

/**
 * Full-page API documentation viewer using ApiViewer.
 * Supports navigating to a specific endpoint via store anchor state,
 * and updates when the selected API or anchor changes.
 */
const ApisPage = (): JSX.Element => {
  const { apis, apisApi, apisAnchor, setApisApi } = useStore(
    useShallow((s) => ({ apis: s.apis, apisApi: s.apisApi, apisAnchor: s.apisAnchor, setApisApi: s.setApisApi })),
  );

  const selectedApi = apisApi || (apis.length > 0 ? apis[0]!.name : "");
  const apiInfo = apis.find((a) => a.name === selectedApi);
  const newTabHref = selectedApi ? `/openapi/docs/${encodeURIComponent(selectedApi)}` : "#";

  return (
    <div className="flex flex-col h-[calc(100%-2.75rem)] px-5 py-3.5">
      {/* Header */}
      <div className="flex items-center gap-3.5 mb-[0.6875rem] shrink-0">
        <div className="relative flex items-center">
          <div className="absolute left-2.5 z-1 flex pointer-events-none text-(--g-text-dim)">
            {Ic.server()}
          </div>
          <GroupedApiSelect
            apis={apis}
            value={selectedApi}
            onChange={setApisApi}
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
          href={newTabHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 ml-auto text-[0.9375rem] text-(--g-accent) no-underline"
        >
          {Ic.ext()} New tab
        </a>
      </div>

      {/* Navigation breadcrumb */}
      {apisAnchor && (
        <div className="flex items-center gap-[0.4375rem] mb-[0.6875rem] px-[0.6875rem] py-[0.4375rem] rounded-md border border-(--g-border-accent) bg-(--g-accent-dim) text-[0.9375rem] shrink-0">
          <span className="flex text-(--g-accent)">{Ic.arr()}</span>
          <span className="text-(--g-text-muted)">Navigated to</span>
          <span
            className="method-badge"
            style={{
              background: METHOD_COLORS[apisAnchor.method]?.bg,
              color: METHOD_COLORS[apisAnchor.method]?.text,
              border: `1px solid ${METHOD_COLORS[apisAnchor.method]?.border}`,
            }}
          >
            {apisAnchor.method}
          </span>
          <code className="font-mono text-[0.9375rem] text-(--g-text)">{apisAnchor.path}</code>
        </div>
      )}

      {/* API Viewer — direct render, no iframe */}
      {selectedApi ? (
        <div className="flex-1 min-h-0 overflow-hidden rounded-md border border-(--g-border) bg-(--g-bg)">
          <ApiViewer apiName={selectedApi} anchor={apisAnchor} />
        </div>
      ) : (
        <div className="flex flex-col flex-1 items-center justify-center gap-3.5 rounded-md border border-(--g-border) bg-(--g-surface)">
          <div className="flex text-(--g-text-dim)">{Ic.doc(38)}</div>
          <span className="text-base text-(--g-text-dim)">No APIs ingested yet</span>
        </div>
      )}
    </div>
  );
};

export default ApisPage;
