"use client";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store/store";
import { listApis } from "../lib/api";

interface SpecStatus {
	name: string;
	status: "pending" | "running" | "done" | "error";
	message: string;
	done?: number;
	total?: number;
}

export default function AutoIngestBanner() {
	const { autoIngest, setAutoIngest, updateAutoIngestSpec, setApis } = useStore(
		useShallow((s) => ({
			autoIngest: s.autoIngest,
			setAutoIngest: s.setAutoIngest,
			updateAutoIngestSpec: s.updateAutoIngestSpec,
			setApis: s.setApis,
		})),
	);
	const evtSourceRef = useRef<EventSource | null>(null);
	const [dismissed, setDismissed] = useState(false);

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
						done: e.done,
						total: e.total,
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

	const { active, specs } = autoIngest;
	const allDone = !active && specs.length > 0 && specs.every((s) => s.status === "done" || s.status === "error");

	// Auto-dismiss after completion
	useEffect(() => {
		if (!allDone) return;
		const t = setTimeout(() => {
			setDismissed(true);
			setAutoIngest({ specs: [] });
		}, 8000);
		return () => clearTimeout(t);
	}, [allDone]);

	// Nothing to show
	if (specs.length === 0 || dismissed) return null;

	const doneCount = specs.filter((s) => s.status === "done").length;
	const errorCount = specs.filter((s) => s.status === "error").length;
	const running = specs.find((s) => s.status === "running");
	const pct = running?.total ? Math.round(((running.done ?? 0) / running.total) * 100) : 0;
	const overallPct = specs.length > 0 ? Math.round(((doneCount + errorCount) / specs.length) * 100) : 0;

	return (
		<div className="mx-5 mt-2 mb-0 rounded-lg border border-[var(--g-border)] bg-[var(--g-surface)] overflow-hidden shrink-0">
			{/* Header bar */}
			<div className="flex items-center gap-2 px-3 py-2">
				<div className="relative w-5 h-5 shrink-0">
					{active ? (
						<svg className="animate-spin" width={20} height={20} viewBox="0 0 20 20">
							<circle cx="10" cy="10" r="8" fill="none" stroke="var(--g-border)" strokeWidth="2" />
							<path d="M10 2a8 8 0 0 1 8 8" fill="none" stroke="var(--g-accent)" strokeWidth="2" strokeLinecap="round" />
						</svg>
					) : (
						<svg width={20} height={20} viewBox="0 0 20 20">
							<circle cx="10" cy="10" r="8" fill="none" stroke="var(--g-green)" strokeWidth="2" />
							<path d="M6 10l3 3 5-6" fill="none" stroke="var(--g-green)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					)}
				</div>
				<span className="text-sm font-semibold text-[var(--g-text)]">
					{active ? "Auto-ingesting specs..." : "Auto-ingest complete"}
				</span>
				<span className="text-xs text-[var(--g-text-dim)] ml-auto">
					{doneCount + errorCount}/{specs.length}
				</span>
				{!active && (
					<button
						onClick={() => { setDismissed(true); setAutoIngest({ specs: [] }); }}
						className="text-[var(--g-text-dim)] bg-transparent border-none cursor-pointer p-0 ml-1 leading-none"
					>
						<svg width={14} height={14} viewBox="0 0 14 14" fill="none"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
					</button>
				)}
			</div>

			{/* Overall progress bar */}
			<div className="h-0.5 bg-[var(--g-border)]">
				<div
					className="h-full bg-[var(--g-accent)] transition-all duration-300"
					style={{ width: `${active && running ? overallPct + (pct / specs.length) : overallPct}%` }}
				/>
			</div>

			{/* Spec list */}
			<div className="max-h-40 overflow-y-auto">
				{specs.map((sp) => (
					<div key={sp.name} className="flex items-center gap-2 px-3 py-1.5 text-[0.8125rem] border-t border-[var(--g-border)]">
						<span className="w-1.5 h-1.5 rounded-full shrink-0" style={{
							backgroundColor:
								sp.status === "done" ? "var(--g-green)" :
								sp.status === "error" ? "#F87171" :
								sp.status === "running" ? "var(--g-accent)" :
								"var(--g-text-dim)",
							opacity: sp.status === "pending" ? 0.4 : 1,
						}} />
						<span className={`font-medium truncate min-w-0 ${sp.status === "pending" ? "text-[var(--g-text-dim)]" : "text-[var(--g-text)]"}`}>
							{sp.name}
						</span>
						<span className="ml-auto text-xs text-[var(--g-text-dim)] whitespace-nowrap shrink-0">
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
	);
}
