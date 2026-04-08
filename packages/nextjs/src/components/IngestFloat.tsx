"use client";

import { useShallow } from "zustand/react/shallow";

import { Ic } from "../lib/icons";
import { useStore } from "../store/store";

/**
 * Floating progress indicator that appears over the page when an ingest job is running.
 * Clicking it navigates to the settings page where jobs are listed.
 */
const IngestFloat = (): JSX.Element | null => {
  const { page, jobs, setPage } = useStore(useShallow((s) => ({ page: s.page, jobs: s.ingestJobs, setPage: s.setPage })));

  const activeJobs = jobs.filter((j) => j.status === "running" || j.status === "queued");

  // Only show when not on settings and there are active jobs
  if (page === "settings" || activeJobs.length === 0) return null;

  const running = activeJobs.find((j) => j.status === "running");
  const queued = activeJobs.filter((j) => j.status === "queued").length;
  const pct = running && running.total
    ? Math.round(((running.done ?? 0) / running.total) * 100)
    : 0;

  const handleClick = () => setPage("settings");

  return (
    <div
      onClick={handleClick}
      className="fixed top-16 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2.5 py-2.5 px-3.5 rounded-[0.625rem] border border-(--g-border-accent) bg-(--g-surface) cursor-pointer shadow-[0_4px_20px_rgba(0,0,0,0.4)]"
    >
      {/* Progress circle */}
      <div className="relative w-8 h-8">
        <svg width={32} height={32} viewBox="0 0 36 36" className="-rotate-90">
          <circle cx="18" cy="18" r="15" fill="none" stroke="var(--g-border)" strokeWidth="3" />
          <circle
            cx="18"
            cy="18"
            r="15"
            fill="none"
            stroke="var(--g-accent)"
            strokeWidth="3"
            strokeDasharray={`${pct * 0.942} 94.2`}
            strokeLinecap="round"
            className="[transition:stroke-dasharray_0.2s]"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-mono text-[9px] font-semibold text-(--g-accent)">
          {pct}%
        </span>
      </div>

      {/* Info */}
      <div className="min-w-0">
        <div className="overflow-hidden text-[0.8125rem] font-semibold text-(--g-text) whitespace-nowrap text-ellipsis">
          {running ? running.apiName : "Queued"}
        </div>
        <div className="text-[11px] text-(--g-text-dim)">
          {running?.message ?? "Waiting..."}
          {queued > 0 && ` +${queued} queued`}
        </div>
      </div>
    </div>
  );
};

export default IngestFloat;
