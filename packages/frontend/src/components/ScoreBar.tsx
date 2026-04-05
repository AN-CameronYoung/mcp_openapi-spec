import { C } from "../lib/constants";

export default function ScoreBar({ score }: { score: number }) {
	const p = Math.round(score * 100);
	return (
		<div style={{ display: "flex", alignItems: "center", gap: 6 }}>
			<div style={{ width: 34, height: 4, background: C.border, borderRadius: 2, overflow: "hidden" }}>
				<div style={{ width: `${p}%`, height: "100%", background: C.accent, borderRadius: 2 }} />
			</div>
			<span style={{ fontSize: 13, color: C.textDim, fontFamily: "monospace" }}>{p}%</span>
		</div>
	);
}
