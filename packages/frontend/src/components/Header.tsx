import { C } from "../lib/constants";
import { Ic } from "../lib/icons";
import { useStore } from "../store/store";
import type { ThemePref } from "../store/store";

const THEME_OPTS: { value: ThemePref; label: string }[] = [
	{ value: "system", label: "Auto" },
	{ value: "light", label: "Light" },
	{ value: "dark", label: "Dark" },
];

function ThemeToggle() {
	const theme = useStore((s) => s.theme);
	const setTheme = useStore((s) => s.setTheme);

	return (
		<div style={{ display: "flex", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, overflow: "hidden" }}>
			{THEME_OPTS.map((o) => (
				<button
					key={o.value}
					onClick={() => setTheme(o.value)}
					style={{
						padding: "3px 8px",
						fontSize: 12,
						border: "none",
						cursor: "pointer",
						background: theme === o.value ? C.accentMuted : "transparent",
						color: theme === o.value ? C.accent : C.textDim,
						fontWeight: theme === o.value ? 600 : 400,
					}}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}

const TABS = [
	{ key: "greg" as const, label: "greg", icon: Ic.chat },
	{ key: "search" as const, label: "Semantic search", icon: Ic.search },
	{ key: "docs" as const, label: "API docs", icon: Ic.doc },
	{ key: "settings" as const, label: "Settings", icon: Ic.server },
];

export default function Header() {
	const page = useStore((s) => s.page);
	const setPage = useStore((s) => s.setPage);
	const apis = useStore((s) => s.apis);

	const totalEndpoints = apis.reduce((s, a) => s + a.endpoints, 0);

	return (
		<div
			style={{
				borderBottom: `1px solid ${C.border}`,
				padding: "0 20px",
				display: "flex",
				alignItems: "stretch",
				height: 56,
				flexShrink: 0,
			}}
		>
			{/* Logo */}
			<div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 22 }}>
				<div
					style={{
						width: 28,
						height: 28,
						borderRadius: 6,
						background: C.green,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<span style={{ fontFamily: "monospace", fontWeight: 800, color: "#0D0D10", fontSize: 15 }}>G</span>
				</div>
				<span style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em" }}>greg</span>
			</div>

			{/* Tabs */}
			{TABS.map((t) => (
				<button
					key={t.key}
					onClick={() => setPage(t.key)}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						padding: "0 14px",
						fontSize: 16,
						fontWeight: 500,
						border: "none",
						cursor: "pointer",
						background: "transparent",
						color: page === t.key ? C.accent : C.textDim,
						borderBottom: page === t.key ? `2px solid ${C.accent}` : "2px solid transparent",
						marginBottom: -1,
					}}
				>
					{t.icon()}
					{t.label}
				</button>
			))}

			{/* Stats + theme toggle */}
			<div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 11 }}>
				<span style={{ fontSize: 14, color: C.textDim, display: "flex", alignItems: "center", gap: 4 }}>
					{Ic.server()} {apis.length} APIs
				</span>
				<span style={{ fontSize: 14, color: C.textDim }}>{totalEndpoints} endpoints</span>
				<ThemeToggle />
			</div>
		</div>
	);
}
