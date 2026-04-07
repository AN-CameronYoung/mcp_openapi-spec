"use client";
import { cn } from "../lib/utils";
import { METHOD_COLORS } from "../lib/constants";
import { Badge } from "./ui/badge";

interface EpCardProps {
	method: string;
	path: string;
	api: string;
	description: string;
	warnings?: string;
	compact?: boolean;
	onClick?: () => void;
}

export default function EpCard({ method, path, api, description, warnings, compact, onClick }: EpCardProps) {
	const warningList = warnings ? warnings.split("|").filter(Boolean) : [];
	const m = METHOD_COLORS[method] ?? METHOD_COLORS.GET;
	return (
		<div
			onClick={onClick}
			className={cn(
				"bg-muted border border-border rounded-md transition-all duration-100",
				compact ? "px-1.5 py-[0.1875rem]" : "px-2 py-1",
				onClick ? "cursor-pointer hover:border-[var(--g-border-hover)]" : "cursor-default",
			)}
		>
			<div className="flex items-center gap-[0.3125rem]">
				<Badge
					variant="method"
					className="text-center"
					style={{
						background: m.bg,
						color: m.text,
						border: `1px solid ${m.border}`,
						minWidth: compact ? 30 : 34,
					}}
				>
					{method}
				</Badge>
				<code
					className={cn("font-mono text-foreground truncate flex-1", compact ? "text-[0.6875rem]" : "text-xs")}
				>
					{path}
				</code>
				<Badge variant="api">
					{api}
				</Badge>
			</div>
			<p
				className={cn(
					"text-[var(--g-text-dim)] mt-0.5 leading-[1.3] truncate",
					compact ? "text-[0.625rem] pl-[2.1875rem]" : "text-[0.6875rem] pl-10",
				)}
			>
				{description}
			</p>
			{!compact && warningList.length > 0 && (
				<div className="flex flex-wrap gap-[0.1875rem] mt-1 pl-10">
					{warningList.map((w, i) => (
						<span
							key={i}
							className="text-xs px-2 py-[0.1875rem] rounded bg-[var(--g-method-put-bg)] text-[var(--g-method-put-text)] border border-[var(--g-method-put-border)] leading-[1.5]"
						>
							⚠ {w}
						</span>
					))}
				</div>
			)}
		</div>
	);
}
