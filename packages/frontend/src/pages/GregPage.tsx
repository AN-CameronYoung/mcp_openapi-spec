import React, { useState, useRef, useEffect, useMemo, memo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("javascript", typescript);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("yaml", yaml);
import { C, METHOD_COLORS } from "../lib/constants";
import { Ic } from "../lib/icons";
import { streamChat, listModels, fetchSuggestions } from "../lib/api";
import type { EndpointCard } from "../lib/api";
import { useStore } from "../store/store";
import type { ChatMsg } from "../store/store";
import EpCard from "../components/EpCard";
import DetailPanel from "../components/DetailPanel";

// Per-million-token pricing for Anthropic models (input, output)
const ANTHROPIC_PRICING: Record<string, [number, number]> = {
	"claude-opus-4": [15, 75],
	"claude-sonnet-4": [3, 15],
	"claude-haiku-4-5": [0.80, 4],
	"claude-3-5-sonnet": [3, 15],
	"claude-3-5-haiku": [0.80, 4],
	"claude-3-opus": [15, 75],
};

function estimateCost(model: string | undefined, usage: { input: number; output: number }): string | null {
	if (!model || !model.startsWith("claude")) return null;
	const key = Object.keys(ANTHROPIC_PRICING).sort((a, b) => b.length - a.length).find((k) => model.startsWith(k));
	if (!key) return null;
	const [inp, out] = ANTHROPIC_PRICING[key];
	const cost = (usage.input * inp + usage.output * out) / 1_000_000;
	if (cost === 0) return "0.000000";
	// Show enough significant figures: always at least 4 sig figs after the leading zeros
	const magnitude = Math.floor(Math.log10(cost));
	const decimals = Math.max(2, 2 - magnitude + 3);
	return cost.toFixed(Math.min(decimals, 8));
}

function cleanText(raw: string): string {
	const text = raw
		.replace(/<endpoint[^>]*\/?>/g, "")
		.replace(/\n{3,}/g, "\n\n")
		// Break when colon is immediately followed by a capital letter (no space/newline)
		.replace(/:([A-Z])/g, ":\n\n$1")
		// Break before labeled sections ("Proxmox workflow:", "Darktrace workflow:") after sentence end
		.replace(/([.!?)])\s+([A-Z][a-z]+ \w+:)/g, "$1\n\n$2")
		.trim();

	// Convert single newlines to double (markdown paragraph breaks)
	// but preserve: code blocks, tables, list items, headings
	// Also collapse blank lines inside code blocks (LLMs often add them despite instructions)
	const parts = text.split(/(```[\s\S]*?```)/);
	return parts.map((part, i) => {
		if (i % 2 === 1) {
			// Code block — pass through unchanged, blank lines are intentional
			return part;
		}
		return part.replace(/([^\n])\n([^\n])/g, (_, before, after) => {
			const prevLine = before.split("\n").pop() ?? before;
			if (prevLine.trimStart().startsWith("|") || after.trimStart().startsWith("|")) return `${before}\n${after}`;
			if (/^[-*\d#>]/.test(after.trimStart())) return `${before}\n${after}`;
			if (prevLine.trimStart().startsWith("|---")) return `${before}\n${after}`;
			return `${before}\n\n${after}`;
		});
	}).join("");
}

function CopyBtn({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout>>();

	const handleClick = () => {
		navigator.clipboard?.writeText(text);
		setCopied(true);
		clearTimeout(timer.current);
	};

	const handleLeave = () => {
		if (!copied) return;
		timer.current = setTimeout(() => setCopied(false), 1000);
	};

	const handleEnter = () => {
		clearTimeout(timer.current);
	};

	return (
		<button
			onClick={handleClick}
			onMouseEnter={handleEnter}
			onMouseLeave={handleLeave}
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				border: "none",
				cursor: "pointer",
				padding: 8,
				borderRadius: 6,
				background: C.surfaceHover,
				color: copied ? C.green : C.textDim,
				opacity: copied ? 1 : 0.7,
				flexShrink: 0,
				transition: "color 0.15s, opacity 0.15s",
				width: 34,
				height: 34,
			}}
		>
			{copied ? (
				<svg width={18} height={18} viewBox="0 0 12 12" fill="none">
					<path d="M2 6.5l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			) : (
				Ic.copy(18)
			)}
		</button>
	);
}

function InputBoxWrapper({ children }: { children: React.ReactNode }) {
	const [focused, setFocused] = useState(false);
	return (
		<div
			onFocusCapture={() => setFocused(true)}
			onBlurCapture={() => setFocused(false)}
			style={{
				display: "flex",
				alignItems: "center",
				gap: 8,
				background: C.surface,
				border: `1px solid ${focused ? C.borderAccent : C.border}`,
				borderRadius: 10,
				padding: "8px 10px",
				transition: "border-color 0.15s",
			}}
		>
			{children}
		</div>
	);
}

function CodeDropdown({ code, lang, lineCount, blockKey }: { code: string; lang: string; lineCount: number; blockKey: string }) {
	const open = useStore((s) => !!s.openCodeBlocks[blockKey]);
	const toggle = useStore((s) => s.toggleCodeBlock);

	return (
		<div style={{ margin: "6px 0" }}>
			<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
				<button
					onClick={() => toggle(blockKey)}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						fontSize: 14,
						color: C.accent,
						background: C.accentDim,
						border: `1px solid ${C.borderAccent}`,
						borderRadius: 6,
						padding: "4px 12px",
						cursor: "pointer",
						flex: 1,
						textAlign: "left",
					}}
				>
					<span style={{ fontFamily: "monospace", fontWeight: 500 }}>code: {lineCount} lines</span>
					<span style={{ marginLeft: "auto", transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s", display: "flex" }}>
						<svg width={10} height={10} viewBox="0 0 10 10" fill="none">
							<path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
					</span>
				</button>
				<CopyBtn text={code} />
			</div>
			{open && (
				<div style={{ marginTop: 4 }}>
					<SyntaxHighlighter style={oneDark} language={lang} PreTag="div" customStyle={{ background: C.bg, borderRadius: 6, fontSize: 13, lineHeight: 1.5, padding: "8px 12px", overflowX: "auto" }} codeTagProps={{ style: { background: C.bg, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre" } }}>
						{code}
					</SyntaxHighlighter>
				</div>
			)}
		</div>
	);
}

function StreamingText({ text }: { text: string }) {
	const cleaned = cleanText(text);
	if (!cleaned) return (
		<span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 0" }}>
			{[0, 1, 2].map((i) => (
				<span key={i} style={{
					width: 6, height: 6, borderRadius: "50%",
					background: "var(--g-green)",
					display: "inline-block",
					animation: `greg-bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
				}} />
			))}
		</span>
	);
	// Check for an unclosed code block (streaming in progress)
	const openFences = (cleaned.match(/```/g) || []).length;
	const hasUnclosedCode = openFences % 2 === 1;
	if (hasUnclosedCode) {
		// Show text before the code block + "coding..." spinner
		const lastFence = cleaned.lastIndexOf("```");
		const before = cleaned.slice(0, lastFence).trim();
		return (
			<>
				{before && <span style={{ whiteSpace: "pre-wrap" }}>{before}</span>}
				<div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", color: C.textDim }}>
					<span style={{ animation: "spin 1s linear infinite", display: "inline-block", width: 14, height: 14 }}>
						<svg width={14} height={14} viewBox="0 0 14 14" fill="none">
							<circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20 12" />
						</svg>
					</span>
					<span style={{ fontSize: 14, fontStyle: "italic" }}>coding...</span>
				</div>
			</>
		);
	}
	return <span style={{ whiteSpace: "pre-wrap" }}>{cleaned}</span>;
}

const METHOD_RE = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/\S*|$)/;
const PARAM_RE = /(\{[a-zA-Z_][a-zA-Z0-9_]*\}|<[a-zA-Z][a-zA-Z0-9_-]*>)/g;
const PARAM_TEST = /\{[a-zA-Z_][a-zA-Z0-9_]*\}|<[a-zA-Z][a-zA-Z0-9_-]*>/;

function ApiPathCode({ code }: { code: string }) {
	const methodMatch = METHOD_RE.exec(code);
	const method = methodMatch?.[1];
	const path = method ? code.slice(methodMatch![0].length - methodMatch![2].length) : code;
	const mc = method ? (METHOD_COLORS[method] ?? METHOD_COLORS.GET) : null;

	const renderPath = (p: string) => {
		const parts = p.split(PARAM_RE);
		return parts.map((part, i) =>
			PARAM_TEST.test(part)
				? <span key={i} style={{ color: "#C084FC" }}>{part}</span>
				: <span key={i} style={{ color: C.accent }}>{part}</span>
		);
	};

	return (
		<code style={{ background: C.bg, padding: "1px 5px", borderRadius: 4, fontFamily: "monospace", fontSize: "0.9em" }}>
			{mc && (
				<span style={{ color: mc.text, fontWeight: 700, marginRight: 5 }}>{method}</span>
			)}
			{renderPath(path)}
		</code>
	);
}

function isApiPath(code: string): boolean {
	if (METHOD_RE.test(code)) return true;
	if (code.startsWith("/") && PARAM_TEST.test(code)) return true;
	return false;
}

function stableKey(s: string): string {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
	return String(h >>> 0);
}

const mdComponents = (msgKey: number, langMap: Record<string, string>) => ({
	code({ className, children }: { className?: string; children?: React.ReactNode }) {
		const match = /language-(\w+)/.exec(String(className ?? ""));
		const code = String(children ?? "").replace(/\n$/, "");
		if (match || code.includes("\n")) {
			const rawLang = match?.[1] ?? "text";
			const lang = langMap[rawLang] ?? rawLang;
			const lineCount = code.split("\n").length;
			const key = `msg-${msgKey}-${stableKey(code)}`;
			return <CodeDropdown code={code} lang={lang} lineCount={lineCount} blockKey={key} />;
		}
		if (isApiPath(code)) return <ApiPathCode code={code} />;
		return (
			<code style={{ background: C.bg, padding: "1px 5px", borderRadius: 4, fontFamily: "monospace", fontSize: "0.9em", color: C.accent }}>
				{children as React.ReactNode}
			</code>
		);
	},
	pre({ children }: { children?: React.ReactNode }) { return <>{children as React.ReactNode}</>; },
	p({ children }: { children?: React.ReactNode }) { return <p style={{ margin: "10px 0" }}>{children as React.ReactNode}</p>; },
	ul({ children }: { children?: React.ReactNode }) { return <ul style={{ margin: "4px 0", paddingLeft: 18 }}>{children as React.ReactNode}</ul>; },
	ol({ children, node }: { children?: React.ReactNode; node?: { children?: unknown[] } }) {
		const liCount = node?.children?.filter((c: unknown) => c && typeof c === "object" && (c as { tagName?: string }).tagName === "li").length ?? 0;
		if (liCount < 3) return <ol style={{ margin: "4px 0", paddingLeft: 18 }}>{children as React.ReactNode}</ol>;
		// Wrap each li child in a LiDropdown
		let idx = 0;
		const wrapped = React.Children.map(children, (child) => {
			if (child && typeof child === "object" && "type" in (child as React.ReactElement) && (child as React.ReactElement).type === "li") {
				return <LiDropdown index={idx++}>{(child as React.ReactElement).props.children}</LiDropdown>;
			}
			return child;
		});
		return <ol style={{ margin: "4px 0", paddingLeft: 0, listStyle: "none" }}>{wrapped}</ol>;
	},
	a({ href, children }: { href?: string; children?: React.ReactNode }) { return <a href={String(href)} style={{ color: C.accent }} target="_blank" rel="noopener noreferrer">{children as React.ReactNode}</a>; },
	img({ src, alt }: { src?: string; alt?: string }) { return <img src={String(src)} alt={String(alt ?? "")} style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 10, marginTop: 6 }} />; },
	table({ children }: { children?: React.ReactNode }) { return <div style={{ overflowX: "auto", margin: "6px 0" }}><table style={{ borderCollapse: "collapse", minWidth: "100%", fontSize: 14 }}>{children as React.ReactNode}</table></div>; },
	thead({ children }: { children?: React.ReactNode }) { return <thead style={{ borderBottom: `1px solid ${C.border}` }}>{children as React.ReactNode}</thead>; },
	th({ children }: { children?: React.ReactNode }) { return <th style={{ textAlign: "left", padding: "4px 8px", color: C.text, fontWeight: 600 }}>{children as React.ReactNode}</th>; },
	td({ children }: { children?: React.ReactNode }) { return <td style={{ padding: "4px 8px", borderTop: `1px solid ${C.border}`, color: C.textMuted }}>{children as React.ReactNode}</td>; },
});

function LiDropdown({ children, index }: { children?: React.ReactNode; index: number }) {
	const [open, setOpen] = useState(false);
	// Extract first line of text as the summary
	const text = String(
		Array.isArray(children)
			? (typeof children[0] === "string" ? children[0] : children.find((c) => typeof c === "string") ?? "")
			: typeof children === "string" ? children : ""
	).split("\n")[0].slice(0, 80) || `Step ${index + 1}`;
	return (
		<li style={{ listStyle: "none", marginBottom: 4 }}>
			<button
				onClick={() => setOpen(!open)}
				style={{
					background: "none", border: "none", cursor: "pointer", padding: "2px 0",
					display: "flex", alignItems: "center", gap: 6, textAlign: "left",
				}}
			>
				<span style={{ color: C.textDim, fontSize: 12, transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>▶</span>
				<span style={{ color: C.text, fontSize: 15 }}><strong>{index + 1}.</strong> {text}</span>
			</button>
			{open && <div style={{ paddingLeft: 22, fontSize: 14, color: C.textMuted }}>{children as React.ReactNode}</div>}
		</li>
	);
}

function SectionDropdown({ title, body, msgKey, langMap, defaultOpen }: { title: string; body: string; msgKey: number; langMap: Record<string, string>; defaultOpen: boolean }) {
	const [open, setOpen] = useState(defaultOpen);
	return (
		<div style={{ marginBottom: 6 }}>
			<button
				onClick={() => setOpen(!open)}
				style={{
					background: "none", border: "none", cursor: "pointer", padding: "4px 0",
					display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left",
				}}
			>
				<span style={{ color: C.textDim, fontSize: 16, transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "rotate(0deg)", display: "inline-block" }}>▶</span>
				<span style={{ color: C.text, fontWeight: 600, fontSize: 20 }}>{title}</span>
			</button>
			{open && (
				<div style={{ paddingLeft: 18, fontSize: 14 }}>
					<ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents(msgKey, langMap) as never}>{body}</ReactMarkdown>
				</div>
			)}
		</div>
	);
}

function GregMarkdown({ text, msgKey }: { text: string; msgKey: number }) {
	const langMap: Record<string, string> = { ts: "typescript", js: "javascript", py: "python", sh: "bash", yml: "yaml" };

	// Split into sections by headings — only use dropdowns if 2+ headings
	// Replace code block content with spaces (preserving length) so # comments inside don't match as headings
	const textForScan = text.replace(/```[\s\S]*?```/g, (m) => " ".repeat(m.length));
	const sectionRegex = /^(#{1,3})\s+(.+)$/gm;
	const headings = [...textForScan.matchAll(sectionRegex)];

	if (headings.length >= 2) {
		const sections: { preamble?: string; items: { title: string; body: string }[] } = { items: [] };
		const firstIdx = headings[0].index!;
		if (firstIdx > 0) sections.preamble = text.slice(0, firstIdx).trim();

		for (let i = 0; i < headings.length; i++) {
			const start = headings[i].index! + headings[i][0].length;
			const end = i + 1 < headings.length ? headings[i + 1].index! : text.length;
			sections.items.push({ title: headings[i][2], body: text.slice(start, end).trim() });
		}

		return (
			<>
				{sections.preamble && (
					<ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents(msgKey, langMap) as never}>{sections.preamble}</ReactMarkdown>
				)}
				{sections.items.map((s, i) => (
					<SectionDropdown key={i} title={s.title} body={s.body} msgKey={msgKey} langMap={langMap} defaultOpen={i === 0} />
				))}
			</>
		);
	}

	return (
		<ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents(msgKey, langMap) as never}>
			{text}
		</ReactMarkdown>
	);
}

function EndpointDropdown({ endpoints, onSelect }: { endpoints: EndpointCard[]; onSelect: (ep: EndpointCard) => void }) {
	const [open, setOpen] = useState(false);

	return (
		<div style={{ marginTop: 6 }}>
			<button
				onClick={() => setOpen(!open)}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					fontSize: 13,
					color: C.accent,
					background: C.accentDim,
					border: `1px solid ${C.borderAccent}`,
					borderRadius: 4,
					padding: "4px 10px",
					cursor: "pointer",
					width: "100%",
				}}
			>
				<span style={{ flex: 1, textAlign: "left" }}>
					{`${endpoints.length} endpoint${endpoints.length !== 1 ? "s" : ""} found`}
				</span>
				<span style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s", display: "flex" }}>
					<svg width={10} height={10} viewBox="0 0 10 10" fill="none">
						<path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</span>
			</button>
			{open && (
				<div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 3, maxHeight: 300, overflow: "auto" }}>
					{[...endpoints].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((ep, j) => (
						<EpCard
							key={j}
							method={ep.method}
							path={ep.path}
							api={ep.api}
							description={ep.description}
							warnings={ep.warnings}
							onClick={() => onSelect(ep)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function DebugPanel({ entries, model, onClose }: { entries: Record<string, unknown>[]; model?: string; onClose: () => void }) {
	const rounds = entries.filter((e) => (e as { event: string }).event === "round");
	const lastRound = rounds[rounds.length - 1] as { totalInput?: number; totalOutput?: number } | undefined;
	const totalTokens = lastRound ? ((lastRound.totalInput ?? 0) + (lastRound.totalOutput ?? 0)) : 0;
	const toolCallCount = entries.filter((e) => (e as { event: string }).event === "tool_call").length;
	const cost = estimateCost(model, {
		input: (lastRound?.totalInput ?? 0),
		output: (lastRound?.totalOutput ?? 0),
	});

	return (
		<div style={{ width: 300, flexShrink: 0, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", background: C.surface }}>
			{/* Header */}
			<div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", background: C.bg, flexShrink: 0 }}>
				<span style={{ fontSize: 12, fontWeight: 500, color: C.textMuted, flex: 1 }}>Debug trace</span>
				<span style={{ fontSize: 10, color: C.textDim, marginRight: 8, fontFamily: "monospace" }}>{entries.length} events</span>
				<button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.textDim, display: "flex", padding: 2 }}>{Ic.x(12)}</button>
			</div>

			{/* Scroll area */}
			<div style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column" }}>
				{entries.length === 0 ? (
					<div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.textDim, fontSize: 12 }}>
						No debug data yet
					</div>
				) : (
					<DebugPanelEntries entries={entries} />
				)}
			</div>

			{/* Token bar */}
			<div style={{ padding: "7px 12px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 14, background: C.bg, flexShrink: 0 }}>
				<span style={{ fontSize: 10, color: C.textDim, fontFamily: "monospace" }}>
					<span style={{ color: C.textMuted }}>{totalTokens.toLocaleString()}</span> tokens
				</span>
				<span style={{ fontSize: 10, color: C.textDim, fontFamily: "monospace" }}>
					<span style={{ color: C.textMuted }}>{toolCallCount}</span> tool calls
				</span>
				{cost && (
					<span style={{ fontSize: 10, color: C.textDim, fontFamily: "monospace" }}>
						<span style={{ color: C.textMuted }}>${cost}</span>
					</span>
				)}
			</div>
		</div>
	);
}

function DebugPanelEntries({ entries }: { entries: Record<string, unknown>[] }) {
	const [expandedIdx, setExpandedIdx] = useState<Set<number>>(new Set());

	const toggleExpand = (i: number) => {
		setExpandedIdx((prev) => {
			const next = new Set(prev);
			if (next.has(i)) next.delete(i); else next.add(i);
			return next;
		});
	};

	const rows: React.ReactNode[] = [];
	let currentGroup = "";
	let roundNum = 0;

	for (let i = 0; i < entries.length; i++) {
		const e = entries[i] as Record<string, unknown>;
		const ev = e.event as string;

		if (ev === "round") {
			roundNum++;
			const group = `round ${roundNum}`;
			if (group !== currentGroup) {
				currentGroup = group;
				rows.push(
					<div key={`grp-${i}`} style={{ fontSize: 10, color: C.textDim, padding: "8px 0 3px", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.06em" }}>
						{group}
					</div>
				);
			}
			const inTok = (e.inputTokens as number ?? 0).toLocaleString();
			const outTok = (e.outputTokens as number ?? 0).toLocaleString();
			const stop = e.stopReason as string ?? "";
			rows.push(
				<div key={`r-${i}`} style={{ fontFamily: "monospace", fontSize: 11, lineHeight: 1.65, color: C.accent, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
					in:{inTok} out:{outTok} stop:{stop}
				</div>
			);
			continue;
		}

		if (ev === "tool_call") {
			const name = e.name as string;
			const inputStr = JSON.stringify(e.input);
			const full = `${name}(${inputStr})`;
			const truncated = full.length > 80;
			const preview = truncated ? full.slice(0, 80) + "…" : full;
			const expanded = expandedIdx.has(i);
			rows.push(
				<div key={`tc-${i}`} style={{ fontFamily: "monospace", fontSize: 11, lineHeight: 1.65 }}>
					<span style={{ color: C.accent }}>→ </span>
					<span style={{ color: C.green }}>{expanded ? full : preview}</span>
					{truncated && (
						<button onClick={() => toggleExpand(i)} style={{ fontSize: 10, color: C.accent, background: "none", border: "none", cursor: "pointer", padding: "0 0 0 4px", fontFamily: "monospace" }}>
							{expanded ? "less" : "more"}
						</button>
					)}
				</div>
			);
			continue;
		}

		if (ev === "tool_result") {
			const name = e.name as string;
			const len = (e.resultLength as number ?? 0).toLocaleString();
			const count = e.endpointCount as number ?? 0;
			const resultText = e.resultText as string ?? "";
			const preview = resultText.slice(0, 200);
			const truncated = resultText.length > 200;
			const expanded = expandedIdx.has(i);
			rows.push(
				<div key={`tr-${i}`} style={{ fontFamily: "monospace", fontSize: 11, lineHeight: 1.65, marginLeft: 8 }}>
					<span style={{ color: C.textMuted }}>← {name}: {len} chars, {count} cards</span>
					<div style={{ color: C.textDim, whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 10, marginTop: 1 }}>
						{expanded ? resultText : preview}{truncated && !expanded && "…"}
					</div>
					{truncated && (
						<button onClick={() => toggleExpand(i)} style={{ fontSize: 10, color: C.accent, background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "monospace" }}>
							{expanded ? "show less" : `show all (${(e.resultLength as number ?? 0).toLocaleString()} chars)`}
						</button>
					)}
				</div>
			);
			continue;
		}

		// Fallback for other event types
		rows.push(
			<div key={`oth-${i}`} style={{ fontFamily: "monospace", fontSize: 11, lineHeight: 1.65, color: C.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
				{JSON.stringify(e)}
			</div>
		);
	}

	return <>{rows}</>;
}

const ChatMessage = memo(function ChatMessage({ msg, i, onSelectEndpoint, onShowDebug, loadingGif }: {
	msg: ChatMsg;
	i: number;
	onSelectEndpoint: (ep: EndpointCard) => void;
	onShowDebug: (idx: number) => void;
	loadingGif?: string | null;
}) {
	return (
		<div style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
			<div style={{ maxWidth: "85%" }}>
				{msg.role === "assistant" && (
					<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
						<span style={{ fontSize: 13, fontWeight: 500, color: C.green }}>greg</span>
						{msg.model && !msg.streaming && (
							<span style={{ fontSize: 11, color: C.textDim, fontFamily: "monospace" }}>{msg.model}</span>
						)}
						{msg.debug && msg.debug.length > 0 && !msg.streaming && (
							<button
								onClick={() => onShowDebug(i)}
								title="Debug trace"
								style={{ display: "flex", alignItems: "center", border: "none", background: "none", cursor: "pointer", color: C.textDim, padding: "1px 3px", borderRadius: 4, marginLeft: 2, opacity: 0.6 }}
								onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; (e.currentTarget as HTMLElement).style.color = C.accent; }}
								onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.opacity = "0.6"; (e.currentTarget as HTMLElement).style.color = C.textDim; }}
							>
								{Ic.bug(12)}
							</button>
						)}
					</div>
				)}
				<div
					style={{
						padding: "12px 14px",
						borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : 10,
						fontSize: 14,
						lineHeight: 1.6,
						background: msg.role === "user" ? C.userBg : C.gregBg,
						border: `1px solid ${msg.role === "user" ? C.borderAccent : C.border}`,
						color: msg.role === "user" ? C.text : C.textMuted,
					}}
				>
					{msg.role === "user" ? (
						msg.text
					) : msg.streaming ? (
						<>
							{loadingGif && !msg.text && (
								<img src={loadingGif} alt="greg thinking" style={{ maxHeight: 180, maxWidth: "100%", borderRadius: 8, marginBottom: 6, display: "block" }} />
							)}
							<StreamingText text={msg.text} />
						</>
					) : (
						<GregMarkdown text={cleanText(msg.text)} msgKey={i} />
					)}
				</div>
				{msg.endpoints && msg.endpoints.length > 0 && (
					<EndpointDropdown endpoints={msg.endpoints} onSelect={onSelectEndpoint} />
				)}
			</div>
		</div>
	);
});

const GREG_GREETINGS = [
	"greg here. what api u need",
	"yo. greg ready. ask greg thing",
	"greg online. u need endpoint or what",
	"greg awake. what u looking for",
	"sup. greg know ur apis. ask",
	"greg here. tell greg what u need",
	"ok greg ready. go",
];

function getGreeting(isGreg: boolean): string {
	if (!isGreg) return "How can I help you with your API documentation?";
	return GREG_GREETINGS[Math.floor(Math.random() * GREG_GREETINGS.length)];
}

export default function GregPage() {
	const {
		chatMessages,
		gregMode,
		chatLoading,
		addChatMessage,
		updateLastAssistant,
		setGregMode,
		setChatLoading,
		detailItem,
		detailType,
		setDetail,
		customGregPrompt,
		customProPrompt,
		selectedModel,
		selectedProvider,
		setModel,
		chatHistory,
		newChat,
		loadChat,
		deleteChat,
		saveChat,
	} = useStore();

	const [greetingGif, setGreetingGif] = useState<string | null>(null);
	const [loadingGif, setLoadingGif] = useState<string | null>(null);
	const [greeting, setGreetingText] = useState(() => getGreeting(gregMode));
	const [models, setModels] = useState<Array<{ id: string; name: string; provider: string }>>([]);
	const [sidebarOpen, setSidebarOpen] = useState(true);
	const [debugMsgIdx, setDebugMsgIdx] = useState<number | null>(null);
	const [suggestions, setSuggestions] = useState<string[]>([]);
	const abortRef = useRef<AbortController | null>(null);

	useEffect(() => { listModels().then(setModels).catch(() => {}); }, []);
	useEffect(() => { fetchSuggestions().then(setSuggestions).catch(() => {}); }, []);
	useEffect(() => { setGreetingText(getGreeting(gregMode)); }, [gregMode]);
	useEffect(() => {
		if (!gregMode) return;
		fetch("/api/greeting-gif").then((r) => r.json()).then((d) => setGreetingGif(d.url)).catch(() => {});
	}, []);

	const handleSelectEndpoint = useCallback((ep: EndpointCard) => setDetail(ep, "endpoints"), [setDetail]);
	const [input, setInput] = useState("");
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const scrollContainerRef = useRef<HTMLDivElement>(null);
	const [userScrolled, setUserScrolled] = useState(false);
	const userScrolledRef = useRef(false);

	// Check if user has scrolled up — use ref to avoid re-render storms
	const handleScroll = useCallback(() => {
		const el = scrollContainerRef.current;
		if (!el) return;
		const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
		if (userScrolledRef.current !== !atBottom) {
			userScrolledRef.current = !atBottom;
			setUserScrolled(!atBottom);
		}
	}, []);

	// Auto-scroll only if user hasn't scrolled up
	useEffect(() => {
		if (!userScrolledRef.current) {
			messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
		}
	}, [chatMessages]);

	const scrollToBottom = () => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
		userScrolledRef.current = false;
		setUserScrolled(false);
	};

	const handleSend = async (overrideText?: string) => {
		const text = (overrideText ?? input).trim();
		if (!text || chatLoading) return;

		setInput("");
		setUserScrolled(false);
		setLoadingGif(null);
		addChatMessage({ role: "user", text });
		addChatMessage({ role: "assistant", text: "", streaming: true });
		setChatLoading(true);
		if (gregMode) {
			fetch("/api/greeting-gif").then((r) => r.json()).then((d) => setLoadingGif(d.url ?? null)).catch(() => {});
		}

		const history = [
			...chatMessages.map((m) => ({ role: m.role, content: m.text })),
			{ role: "user" as const, content: text },
		];

		let accumulated = "";
		let doneModel: string | undefined;
		let doneUsage: { input: number; output: number; toolCalls: number } | undefined;
		const endpointMap = new Map<string, EndpointCard>();
		const debugLog: Record<string, unknown>[] = [];

		try {
			const customPrompt = gregMode ? customGregPrompt : customProPrompt;
			const abort = new AbortController();
			abortRef.current = abort;
			for await (const event of streamChat(
				history,
				gregMode ? "greg" : "professional",
				{ systemPrompt: customPrompt || undefined, model: selectedModel || undefined, provider: selectedProvider || undefined },
				abort.signal,
			)) {
				switch (event.type) {
					case "text":
						accumulated += event.text ?? "";
						updateLastAssistant((m) => ({ ...m, text: accumulated }));
						break;
					case "endpoints":
						// Deduplicate by method+path, keep highest score
						for (const ep of event.data ?? []) {
							const key = `${ep.method}:${ep.path}:${ep.api}`;
							const existing = endpointMap.get(key);
							if (!existing || (ep.score ?? 0) > (existing.score ?? 0)) {
								endpointMap.set(key, ep);
							}
						}
						break;
					case "error":
						accumulated += `\n[error: ${event.error}]`;
						updateLastAssistant((m) => ({ ...m, text: accumulated }));
						break;
					case "debug":
						debugLog.push(event);
						break;
					case "done":
						doneModel = event.model;
						doneUsage = event.usage ? { ...event.usage, toolCalls: (event.usage as { toolCalls?: number }).toolCalls ?? 0 } : undefined;
						break;
				}
			}
		} catch (err) {
			accumulated += `\n[connection error]`;
			updateLastAssistant((m) => ({ ...m, text: accumulated }));
		}

		abortRef.current = null;
		const dedupedEndpoints = [...endpointMap.values()];
		updateLastAssistant((m) => ({
			...m,
			streaming: false,
			endpoints: dedupedEndpoints.length > 0 ? dedupedEndpoints : undefined,
			model: doneModel,
			usage: doneUsage,
			debug: debugLog.length > 0 ? debugLog : undefined,
		}));
		saveChat();
		setChatLoading(false);
	};

	const handleSuggestion = (q: string) => { handleSend(q); };

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	return (
		<div style={{ padding: "20px 24px", height: "calc(100% - 56px)", display: "flex", flexDirection: "column" }}>
			{/* Chat header */}
			<div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20, flexShrink: 0 }}>
				<div
					style={{
						width: 42,
						height: 42,
						borderRadius: 10,
						background: C.green,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						flexShrink: 0,
					}}
				>
					<svg width={26} height={26} viewBox="0 0 20 20" fill="none">
						<circle cx="7" cy="8" r="1.4" fill="white"/>
						<circle cx="13" cy="8" r="1.4" fill="white"/>
						<path d="M6.5 13.5h7" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
					</svg>
				</div>
				<span style={{ fontSize: 22, fontWeight: 600, color: C.text }}>greg</span>
				<span style={{ fontSize: 14, color: C.textDim }}>{gregMode ? "knows ur apis" : "API Documentation Assistant"}</span>
				<span style={{ flex: 1 }} />

				{/* Personality toggle */}
				<div
					onClick={() => setGregMode(!gregMode)}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						cursor: "pointer",
						fontSize: 14,
						color: C.textDim,
						height: 36,
						padding: "0 12px",
						borderRadius: 8,
						background: C.surface,
						border: `1px solid ${C.border}`,
					}}
				>
					<div
						style={{
							width: 32,
							height: 18,
							borderRadius: 9,
							background: gregMode ? "rgba(52,211,153,0.3)" : C.border,
							position: "relative",
							transition: "background 0.15s",
							flexShrink: 0,
						}}
					>
						<div
							style={{
								width: 12,
								height: 12,
								borderRadius: 6,
								background: gregMode ? C.green : C.textDim,
								position: "absolute",
								top: 3,
								left: gregMode ? 17 : 3,
								transition: "left 0.15s",
							}}
						/>
					</div>
					{gregMode ? "greg" : "professional"}
				</div>

				{/* Model picker */}
				<select
					value={selectedModel || ""}
					onChange={(e) => {
						const m = models.find((x) => x.id === e.target.value);
						if (m) setModel(m.id, m.provider);
					}}
					style={{
						height: 36,
						padding: "0 10px",
						background: C.surface,
						border: `1px solid ${C.border}`,
						borderRadius: 8,
						fontSize: 14,
						color: C.textMuted,
					}}
				>
					<option value="">Default model</option>
					{models.filter((m) => m.provider === "anthropic").length > 0 && (
						<optgroup label="Anthropic">
							{models.filter((m) => m.provider === "anthropic").map((m) => (
								<option key={m.id} value={m.id}>{m.name}</option>
							))}
						</optgroup>
					)}
					{models.filter((m) => m.provider === "ollama").length > 0 && (
						<optgroup label="Ollama">
							{models.filter((m) => m.provider === "ollama").map((m) => (
								<option key={m.id} value={m.id}>{m.name}</option>
							))}
						</optgroup>
					)}
				</select>

				{/* History */}
				<button
					onClick={() => setSidebarOpen(!sidebarOpen)}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						fontSize: 16,
						border: `1px solid ${C.border}`,
						cursor: "pointer",
						padding: "6px 12px",
						borderRadius: 8,
						background: C.surface,
						color: C.textDim,
					}}
				>
					{Ic.doc(16)}
				</button>

				{/* New chat */}
				<button
					onClick={newChat}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						fontSize: 20,
						border: `1px solid ${C.border}`,
						cursor: "pointer",
						padding: "6px 16px",
						borderRadius: 8,
						background: C.surface,
						color: C.textDim,
					}}
				>
					{Ic.plus(18)}
				</button>

				{/* Debug panel toggle — opens last message with debug data */}
				<button
					onClick={() => {
						if (debugMsgIdx !== null) { setDebugMsgIdx(null); return; }
						const lastIdx = [...chatMessages].map((m, idx) => ({ m, idx })).reverse().find(({ m }) => m.debug && m.debug.length > 0)?.idx ?? null;
						setDebugMsgIdx(lastIdx);
					}}
					title="Debug trace"
					style={{
						display: "flex",
						alignItems: "center",
						gap: 6,
						border: `1px solid ${debugMsgIdx !== null ? C.borderAccent : C.border}`,
						cursor: "pointer",
						padding: "6px 10px",
						borderRadius: 8,
						background: debugMsgIdx !== null ? C.accentDim : C.surface,
						color: debugMsgIdx !== null ? C.accent : C.textDim,
					}}
				>
					{Ic.bug(16)}
				</button>
			</div>

			{/* Main layout: sidebar + chat */}
			<div style={{ display: "flex", flex: 1, minHeight: 0 }}>

			{/* Chat history sidebar */}
			{sidebarOpen && (
				<div style={{
					width: 260, flexShrink: 0, background: C.surface,
					borderRight: `1px solid ${C.border}`, overflow: "auto", padding: "12px 10px",
				}}>
					<div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
						<span style={{ fontSize: 15, fontWeight: 600, color: C.text, flex: 1 }}>History</span>
						<button onClick={newChat} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.accent, display: "flex", padding: 4 }} title="New chat">
							{Ic.plus(14)}
						</button>
						<button onClick={() => setSidebarOpen(false)} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.textDim, display: "flex", padding: 4 }}>
							{Ic.x(14)}
						</button>
					</div>
					{chatHistory.length === 0 && (
						<span style={{ fontSize: 13, color: C.textDim }}>No chats yet</span>
					)}
					{chatHistory.map((chat) => {
						const isActive = chat.id === useStore.getState().activeChatId;
						return (
							<div
								key={chat.id}
								onClick={() => loadChat(chat.id)}
								style={{
									display: "flex", alignItems: "center", gap: 6, padding: "6px 8px",
									borderRadius: 6, cursor: "pointer", marginBottom: 2,
									background: isActive ? C.surfaceActive : "transparent",
									borderLeft: isActive ? `2px solid ${C.accent}` : "2px solid transparent",
								}}
								onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = C.surfaceHover; }}
								onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
							>
								<span style={{ fontSize: 13, color: C.text, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
									{chat.title}
								</span>
								<button
									onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }}
									style={{ border: "none", background: "transparent", cursor: "pointer", color: C.textDim, display: "flex", flexShrink: 0, padding: 2, opacity: 0.5 }}
								>
									{Ic.x(11)}
								</button>
							</div>
						);
					})}
				</div>
			)}

			{/* Main area */}
			<div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: "0 20px" }}>
			<div style={{ display: "flex", gap: 20, flex: 1, minHeight: 0 }}>
				{/* Messages */}
				<div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", position: "relative" }}>
					<div ref={scrollContainerRef} onScroll={handleScroll} style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 12, position: "relative" }}>
						{chatMessages.length === 0 && (
							<div
								style={{
									flex: 1,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									flexDirection: "column",
									gap: 16,
									color: C.textDim,
								}}
							>
								<div
									style={{
										width: 80,
										height: 80,
										borderRadius: 16,
										background: C.green,
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
									}}
								>
									<svg width={50} height={50} viewBox="0 0 20 20" fill="none">
										<circle cx="7" cy="8" r="1.4" fill="white"/>
										<circle cx="13" cy="8" r="1.4" fill="white"/>
										<path d="M6.5 13.5h7" stroke="white" strokeWidth="1.8" strokeLinecap="round"/>
									</svg>
								</div>
								{gregMode && greetingGif && (
									<img src={greetingGif} alt="greg" style={{ maxHeight: 720, borderRadius: 12 }} />
								)}
								<span style={{ fontSize: 24 }}>
									{greeting}
								</span>
								{suggestions.length > 0 && (
									<div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center", maxWidth: 560 }}>
										{suggestions.map((s, i) => (
											<button
												key={i}
												onClick={() => handleSuggestion(s)}
												style={{
													fontSize: 13,
													color: C.textMuted,
													background: C.surface,
													border: `1px solid ${C.border}`,
													borderRadius: 20,
													padding: "6px 14px",
													cursor: "pointer",
													transition: "border-color 0.15s, color 0.15s",
												}}
												onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.borderAccent; (e.currentTarget as HTMLElement).style.color = C.text; }}
												onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.border; (e.currentTarget as HTMLElement).style.color = C.textMuted; }}
											>
												{s}
											</button>
										))}
									</div>
								)}
							</div>
						)}
						{chatMessages.map((msg, i) => (
							<ChatMessage key={i} msg={msg} i={i} onSelectEndpoint={handleSelectEndpoint} onShowDebug={setDebugMsgIdx} loadingGif={msg.streaming ? loadingGif : null} />
						))}
						<div ref={messagesEndRef} />
					</div>

					{/* Scroll to bottom button */}
					{userScrolled && (
						<button
							onClick={scrollToBottom}
							style={{
								position: "absolute",
								bottom: 90,
								left: "50%",
								transform: "translateX(-50%)",
								display: "flex",
								alignItems: "center",
								gap: 6,
								padding: "8px 16px",
								borderRadius: 20,
								border: `1px solid ${C.borderAccent}`,
								background: C.surface,
								color: C.accent,
								cursor: "pointer",
								fontSize: 14,
								boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
								zIndex: 10,
							}}
						>
							<svg width={14} height={14} viewBox="0 0 14 14" fill="none">
								<path d="M3 5.5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
							</svg>
							Scroll to bottom
						</button>
					)}

					{/* Input */}
					<div style={{ marginTop: 12, flexShrink: 0 }}>
						<InputBoxWrapper>
						<textarea
							rows={1}
							placeholder={gregMode ? "talk to greg..." : "Search API documentation..."}
							value={input}
							onChange={(e) => { setInput(e.target.value); const t = e.target; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px"; }}
							onKeyDown={handleKeyDown}
							style={{
								flex: 1,
								background: "none",
								border: "none",
								outline: "none",
								fontSize: 13,
								color: C.text,
								resize: "none",
								fontFamily: "inherit",
								lineHeight: 1.5,
								minHeight: 20,
								padding: 0,
							}}
						/>
						{chatLoading ? (
							<button
								onClick={() => { abortRef.current?.abort(); abortRef.current = null; setChatLoading(false); updateLastAssistant((m) => ({ ...m, streaming: false })); saveChat(); }}
								style={{
									width: 28,
									height: 28,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									background: "rgba(248,113,113,0.1)",
									border: "none",
									borderRadius: 7,
									cursor: "pointer",
									color: "#F87171",
									flexShrink: 0,
								}}
							>
								<svg width={14} height={14} viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="2" /></svg>
							</button>
						) : (
							<button
								onClick={() => handleSend()}
								style={{
									width: 28,
									height: 28,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									background: C.accentMuted,
									border: "none",
									borderRadius: 7,
									cursor: "pointer",
									color: C.accent,
									flexShrink: 0,
								}}
							>
								{Ic.send(14)}
							</button>
						)}
					</InputBoxWrapper>
					</div>
				</div>

				{/* Detail panel */}
				{detailItem && (
					<div style={{ width: 340, flexShrink: 0 }}>
						<DetailPanel item={detailItem as never} type={detailType} onClose={() => setDetail(null)} />
					</div>
				)}
			</div>
			</div>

			{/* Debug panel — sibling to main area, right edge of the top-level flex row */}
			{debugMsgIdx !== null && (() => {
				const msg = chatMessages[debugMsgIdx];
				return msg ? <DebugPanel entries={msg.debug ?? []} model={msg.model} onClose={() => setDebugMsgIdx(null)} /> : null;
			})()}
			</div>
		</div>
	);
}
