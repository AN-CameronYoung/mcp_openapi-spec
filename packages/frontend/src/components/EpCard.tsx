import { C, METHOD_COLORS } from "../lib/constants";

interface EpCardProps {
	method: string;
	path: string;
	api: string;
	description: string;
	compact?: boolean;
	onClick?: () => void;
}

export default function EpCard({ method, path, api, description, compact, onClick }: EpCardProps) {
	const m = METHOD_COLORS[method] ?? METHOD_COLORS.GET;
	return (
		<div
			onClick={onClick}
			style={{
				background: C.surface,
				border: `1px solid ${C.border}`,
				borderRadius: 6,
				padding: compact ? "8px 11px" : "11px 14px",
				cursor: onClick ? "pointer" : "default",
				transition: "all 0.1s",
			}}
			onMouseEnter={(e) => {
				if (onClick) (e.currentTarget as HTMLElement).style.borderColor = C.borderHover;
			}}
			onMouseLeave={(e) => {
				(e.currentTarget as HTMLElement).style.borderColor = C.border;
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 7 }}>
				<span
					style={{
						fontSize: 13,
						fontWeight: 600,
						padding: "1px 7px",
						borderRadius: 4,
						fontFamily: "monospace",
						background: m.bg,
						color: m.text,
						border: `1px solid ${m.border}`,
						minWidth: compact ? 42 : 46,
						textAlign: "center",
					}}
				>
					{method}
				</span>
				<code
					style={{
						fontSize: compact ? 14 : 15,
						fontFamily: "monospace",
						color: C.text,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
						flex: 1,
					}}
				>
					{path}
				</code>
				<span
					style={{
						fontSize: 13,
						padding: "1px 7px",
						borderRadius: 4,
						background: C.accentDim,
						color: C.accent,
						fontWeight: 500,
						flexShrink: 0,
					}}
				>
					{api}
				</span>
			</div>
			<p
				style={{
					fontSize: compact ? 14 : 15,
					color: C.textDim,
					margin: "4px 0 0",
					lineHeight: 1.4,
					paddingLeft: compact ? 50 : 56,
					overflow: "hidden",
					textOverflow: "ellipsis",
					whiteSpace: "nowrap",
				}}
			>
				{description}
			</p>
		</div>
	);
}
