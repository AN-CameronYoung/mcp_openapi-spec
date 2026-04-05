import { C } from "../lib/constants";
import { Ic } from "../lib/icons";
import { useStore } from "../store/store";

export default function IngestFloat() {
	const page = useStore((s) => s.page);
	const jobs = useStore((s) => s.ingestJobs);
	const setPage = useStore((s) => s.setPage);

	const activeJobs = jobs.filter((j) => j.status === "running" || j.status === "queued");

	// Only show when not on settings and there are active jobs
	if (page === "settings" || activeJobs.length === 0) return null;

	const running = activeJobs.find((j) => j.status === "running");
	const queued = activeJobs.filter((j) => j.status === "queued").length;
	const pct = running && running.total ? Math.round(((running.done ?? 0) / running.total) * 100) : 0;

	return (
		<div
			onClick={() => setPage("settings")}
			style={{
				position: "fixed",
				top: 64,
				left: "50%",
				transform: "translateX(-50%)",
				display: "flex",
				alignItems: "center",
				gap: 10,
				padding: "10px 14px",
				background: C.surface,
				border: `1px solid ${C.borderAccent}`,
				borderRadius: 10,
				cursor: "pointer",
				zIndex: 100,
				boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
			}}
		>
			{/* Progress circle */}
			<div style={{ position: "relative", width: 32, height: 32 }}>
				<svg width={32} height={32} viewBox="0 0 36 36" style={{ transform: "rotate(-90deg)" }}>
					<circle cx="18" cy="18" r="15" fill="none" stroke={C.border} strokeWidth="3" />
					<circle
						cx="18"
						cy="18"
						r="15"
						fill="none"
						stroke={C.accent}
						strokeWidth="3"
						strokeDasharray={`${pct * 0.942} 94.2`}
						strokeLinecap="round"
						style={{ transition: "stroke-dasharray 0.2s" }}
					/>
				</svg>
				<span
					style={{
						position: "absolute",
						inset: 0,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						fontSize: 9,
						fontWeight: 600,
						color: C.accent,
						fontFamily: "monospace",
					}}
				>
					{pct}%
				</span>
			</div>

			{/* Info */}
			<div style={{ minWidth: 0 }}>
				<div style={{ fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
					{running ? running.apiName : "Queued"}
				</div>
				<div style={{ fontSize: 11, color: C.textDim }}>
					{running?.message ?? "Waiting..."}
					{queued > 0 && ` +${queued} queued`}
				</div>
			</div>
		</div>
	);
}
