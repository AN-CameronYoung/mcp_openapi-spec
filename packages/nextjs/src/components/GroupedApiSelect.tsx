"use client";
import { useState, useMemo, useRef, useEffect } from "react";
import { cn } from "../lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Button } from "./ui/button";
import { ChevronsUpDown, Check, ChevronRight } from "lucide-react";
import type { ApiInfo } from "../lib/api";

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

interface ApiGroup {
	type: "group";
	name: string;
	children: ApiInfo[];
}
interface ApiSingle {
	type: "single";
	api: ApiInfo;
}
type GroupedEntry = ApiGroup | ApiSingle;

function groupApis(apis: ApiInfo[]): GroupedEntry[] {
	const prefixToApis = new Map<string, ApiInfo[]>();

	for (const api of apis) {
		const idx = api.name.indexOf("-");
		if (idx > 0) {
			const prefix = api.name.slice(0, idx);
			if (!prefixToApis.has(prefix)) prefixToApis.set(prefix, []);
			prefixToApis.get(prefix)!.push(api);
		}
	}

	const result: GroupedEntry[] = [];
	const seenPrefixes = new Set<string>();

	for (const api of apis) {
		const idx = api.name.indexOf("-");
		const prefix = idx > 0 ? api.name.slice(0, idx) : null;

		if (prefix && (prefixToApis.get(prefix)?.length ?? 0) >= 2) {
			if (!seenPrefixes.has(prefix)) {
				seenPrefixes.add(prefix);
				result.push({ type: "group", name: prefix, children: prefixToApis.get(prefix)! });
			}
		} else {
			result.push({ type: "single", api });
		}
	}

	return result;
}

// ---------------------------------------------------------------------------
// Menu item (shared)
// ---------------------------------------------------------------------------

function MenuItem({
	label,
	detail,
	selected,
	onClick,
	className,
	children,
}: {
	label: string;
	detail?: React.ReactNode;
	selected?: boolean;
	onClick?: () => void;
	className?: string;
	children?: React.ReactNode;
}) {
	return (
		<div
			onClick={onClick}
			className={cn(
				"flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer hover:bg-muted",
				selected && "bg-accent",
				className,
			)}
		>
			<span className="flex-1 truncate">{label}</span>
			{detail}
			{selected && <Check className="size-3.5 shrink-0" />}
			{children}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Flyout group — sub-menu rendered via fixed positioning to escape scroll clip
// ---------------------------------------------------------------------------

function FlyoutGroup({
	entry,
	value,
	onSelect,
}: {
	entry: ApiGroup;
	value: string;
	onSelect: (v: string) => void;
}) {
	const [hovered, setHovered] = useState(false);
	const rowRef = useRef<HTMLDivElement>(null);
	const [flyoutStyle, setFlyoutStyle] = useState<React.CSSProperties>({});
	const hasSelected = entry.children.some((c) => c.name === value);

	useEffect(() => {
		if (hovered && rowRef.current) {
			const rect = rowRef.current.getBoundingClientRect();
			setFlyoutStyle({
				position: "fixed",
				top: rect.top,
				left: rect.right + 6,
				zIndex: 200,
			});
		}
	}, [hovered]);

	return (
		<div
			ref={rowRef}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
		>
			<div
				className={cn(
					"flex items-center gap-2 px-2 py-1.5 rounded-md text-sm cursor-pointer hover:bg-muted",
					(hovered || hasSelected) && "bg-muted",
				)}
			>
				<span className="flex-1 truncate font-medium">{entry.name}</span>
				<span className="text-xs text-muted-foreground">{entry.children.length}</span>
				<ChevronRight className="size-3.5 opacity-50 shrink-0" />
			</div>

			{hovered && (
				<div style={flyoutStyle} className="min-w-48 rounded-lg border border-border bg-popover p-1 shadow-md">
					{/* Arrow */}
					<div className="absolute -left-[5px] top-2.5 size-2.5 rotate-45 border-l border-b border-border bg-popover" />
					{entry.children.map((child) => (
						<MenuItem
							key={child.name}
							label={child.name}
							detail={<span className="text-xs text-muted-foreground">{child.endpoints}</span>}
							selected={value === child.name}
							onClick={() => onSelect(child.name)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface GroupedApiSelectProps {
	apis: ApiInfo[];
	value: string;
	onChange: (value: string) => void;
	allLabel?: string;
	height?: number;
	fontSize?: number;
	minWidth?: number;
	color?: string;
	withIcon?: boolean;
}

export default function GroupedApiSelect({
	apis,
	value,
	onChange,
	allLabel,
	height = 44,
	fontSize = 15,
	minWidth = 140,
	color,
	withIcon = false,
}: GroupedApiSelectProps) {
	const [open, setOpen] = useState(false);
	const [filter, setFilter] = useState("");
	const filterRef = useRef<HTMLInputElement>(null);
	const entries = useMemo(() => groupApis(apis), [apis]);

	const displayLabel = value === "all" ? (allLabel ?? "All APIs") : value;

	const select = (v: string) => {
		onChange(v);
		setOpen(false);
	};

	// Reset filter and focus input when popover opens
	useEffect(() => {
		if (open) {
			setFilter("");
			requestAnimationFrame(() => filterRef.current?.focus());
		}
	}, [open]);

	// Filter entries
	const q = filter.toLowerCase();
	const filtered = q
		? entries.reduce<GroupedEntry[]>((acc, entry) => {
				if (entry.type === "single") {
					if (entry.api.name.toLowerCase().includes(q)) acc.push(entry);
				} else {
					const kids = entry.children.filter((c) => c.name.toLowerCase().includes(q));
					if (entry.name.toLowerCase().includes(q)) acc.push(entry);
					else if (kids.length > 0) acc.push({ ...entry, children: kids });
				}
				return acc;
			}, [])
		: entries;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="outline"
					role="combobox"
					aria-expanded={open}
					className="justify-between gap-1.5 font-normal"
					style={{ height, fontSize, minWidth, color: color ?? undefined }}
				>
					<span className="truncate">{displayLabel}</span>
					<ChevronsUpDown className="opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="p-1" style={{ minWidth: Math.max(minWidth, 200) }} align="start">
				{/* Search filter */}
				<div className="px-1 pb-1">
					<input
						ref={filterRef}
						value={filter}
						onChange={(e) => setFilter(e.target.value)}
						placeholder="Search APIs..."
						className="w-full px-2 py-1.5 text-sm bg-transparent border-b border-border outline-none placeholder:text-muted-foreground"
					/>
				</div>
				<div className="max-h-64 overflow-y-auto">
					{allLabel && (
						<>
							<MenuItem
								label={allLabel}
								selected={value === "all"}
								onClick={() => select("all")}
							/>
							<div className="my-1 h-px bg-border" />
						</>
					)}
					{filtered.length === 0 && (
						<div className="px-2 py-3 text-sm text-muted-foreground text-center">No APIs found.</div>
					)}
					{filtered.map((entry) => {
						if (entry.type === "single") {
							return (
								<MenuItem
									key={entry.api.name}
									label={entry.api.name}
									detail={<span className="text-xs text-muted-foreground">{entry.api.endpoints}</span>}
									selected={value === entry.api.name}
									onClick={() => select(entry.api.name)}
								/>
							);
						}
						return (
							<FlyoutGroup
								key={entry.name}
								entry={entry}
								value={value}
								onSelect={select}
							/>
						);
					})}
				</div>
			</PopoverContent>
		</Popover>
	);
}
