import { useState } from "react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("json", json);
import { C, METHOD_COLORS } from "../lib/constants";
import { Ic } from "../lib/icons";
import ScoreBar from "./ScoreBar";
import { useStore } from "../store/store";

interface DetailItem {
	method?: string;
	path?: string;
	name?: string;
	api: string;
	score?: number;
	description?: string;
	full_text?: string;
	response_schema?: string;
	operation_id?: string;
	tags?: string;
}

function PBadge({ type }: { type: string }) {
	const c = type === "path"
		? { bg: "rgba(251,191,36,0.08)", text: "#FBBF24" }
		: { bg: "rgba(129,140,248,0.08)", text: "#818CF8" };
	return (
		<span
			style={{
				fontSize: 11,
				padding: "1px 7px",
				borderRadius: 4,
				background: c.bg,
				color: c.text,
				fontFamily: "monospace",
				textTransform: "uppercase",
				letterSpacing: "0.05em",
			}}
		>
			{type}
		</span>
	);
}

function CodeBlock({ lines, nameColor }: { lines: string[]; nameColor: string }) {
	return (
		<div
			style={{
				fontFamily: "monospace",
				fontSize: 12,
				color: C.textMuted,
				background: C.bg,
				borderRadius: 4,
				padding: "8px 11px",
				lineHeight: 1.7,
				overflowX: "auto",
			}}
		>
			{"{"}
			<br />
			{lines.map((f, i) => {
				const colonIdx = f.indexOf(": ");
				const name = colonIdx >= 0 ? f.slice(0, colonIdx) : f;
				const type = colonIdx >= 0 ? f.slice(colonIdx) : "";
				return (
					<div key={i} style={{ paddingLeft: 20 }}>
						<span style={{ color: nameColor }}>{name}</span>
						<span style={{ color: C.textDim }}>{type}</span>
						{i < lines.length - 1 ? "," : ""}
					</div>
				);
			})}
			{"}"}
		</div>
	);
}

function CurlExample({ method, path, params }: {
	method: string;
	path: string;
	params: Array<{ name: string; in: string; type: string; required: boolean }>;
}) {
	const m = method.toUpperCase();
	// Replace path params with placeholder values
	let curlPath = path.replace(/\{([^}]+)\}/g, (_, name) => `{${name}}`);

	// Build query string from query params
	const queryParams = params.filter((p) => p.in === "query");
	const pathParams = params.filter((p) => p.in === "path");

	let url = `https://api.example.com${curlPath}`;
	if (queryParams.length > 0) {
		const qs = queryParams.map((p) => `${p.name}={${p.name}}`).join("&");
		url += `?${qs}`;
	}

	let curl = `curl -X ${m} '${url}'`;
	curl += ` \\\n  -H 'Content-Type: application/json'`;
	curl += ` \\\n  -H 'Authorization: Bearer {token}'`;

	if (["POST", "PUT", "PATCH"].includes(m)) {
		curl += ` \\\n  -d '{}'`;
	}

	return (
		<div>
			<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
				<div style={{ fontSize: 12, fontWeight: 600, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.06em" }}>
					Example
				</div>
				<button
					onClick={() => navigator.clipboard?.writeText(curl)}
					style={{ display: "flex", border: "none", cursor: "pointer", padding: 2, background: "transparent", color: C.textDim, borderRadius: 4, marginLeft: "auto" }}
				>
					{Ic.copy()}
				</button>
			</div>
			<SyntaxHighlighter style={oneDark} language="bash" PreTag="div" wrapLongLines customStyle={{ margin: 0, borderRadius: 4, fontSize: 11, background: C.bg }} codeTagProps={{ style: { background: C.bg } }}>
				{curl}
			</SyntaxHighlighter>
		</div>
	);
}

function ResponseDropdown({ content }: { content: string }) {
	const [open, setOpen] = useState(false);
	const isJson = content.trimStart().startsWith("{") || content.trimStart().startsWith("[");

	return (
		<div style={{ marginBottom: 14 }}>
			<button
				onClick={() => setOpen(!open)}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 6,
					fontSize: 12,
					fontWeight: 600,
					color: C.textDim,
					background: "transparent",
					border: "none",
					cursor: "pointer",
					padding: 0,
					textTransform: "uppercase",
					letterSpacing: "0.06em",
				}}
			>
				Response
				<span style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s", display: "flex" }}>
					<svg width={10} height={10} viewBox="0 0 10 10" fill="none">
						<path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</span>
			</button>
			{open && (
				<div style={{ marginTop: 6 }}>
					<SyntaxHighlighter
						style={oneDark}
						language={isJson ? "json" : "text"}
						PreTag="div"
						wrapLongLines
						customStyle={{ margin: 0, borderRadius: 4, fontSize: 11, background: C.bg }}
						codeTagProps={{ style: { background: C.bg } }}
					>
						{content}
					</SyntaxHighlighter>
				</div>
			)}
		</div>
	);
}

// Parse the full_text into structured sections
function parseFullText(text: string) {
	const params: Array<{ name: string; in: string; type: string; required: boolean; desc: string }> = [];
	const bodyFields: string[] = [];
	const responseFields: string[] = [];
	let responseType = "";

	const lines = text.split("\n");
	for (const line of lines) {
		const paramMatch = line.match(/^\s*-\s*\[(\w+)\]\s+(\w+)\s+\((\w+)(?:,\s*required)?\)(?:\s*[:-]\s*(.*))?/);
		if (paramMatch) {
			params.push({
				in: paramMatch[1],
				name: paramMatch[2],
				type: paramMatch[3],
				required: line.includes("required"),
				desc: paramMatch[4]?.trim() ?? "",
			});
		}

		if (line.includes("Request body") || line.includes("request body")) {
			// Next lines might have fields
		}

		const fieldMatch = line.match(/^\s{2,}(\w+):\s*(.+)/);
		if (fieldMatch && !line.startsWith("  -")) {
			// Could be body or response field based on context
		}
	}

	// Simple heuristic: extract fields from response_schema
	return { params, bodyFields, responseFields, responseType };
}

export default function DetailPanel({
	item,
	type,
	onClose,
}: {
	item: DetailItem;
	type: "endpoints" | "schemas";
	onClose: () => void;
}) {
	const viewDocs = useStore((s) => s.viewDocs);
	const isEp = type === "endpoints";
	const m = isEp ? METHOD_COLORS[item.method ?? "GET"] ?? METHOD_COLORS.GET : null;

	// Format response schema — now stored as JSON from chunker
	let responseDisplay = "";
	if (item.response_schema) {
		try {
			const parsed = JSON.parse(item.response_schema);
			responseDisplay = JSON.stringify(parsed, null, 2);
		} catch {
			responseDisplay = item.response_schema.trim();
		}
	}

	// Extract a meaningful description from full_text
	let fullDescription = item.description ?? "";
	if (item.full_text) {
		const lines = item.full_text.split("\n");
		const descLines: string[] = [];
		let pastHeader = false;
		for (const line of lines) {
			const t = line.trim();
			if (!t) { if (pastHeader) break; continue; }
			if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//.test(t)) { pastHeader = true; continue; }
			if (/^(Summary|Tags?|Parameters?|Request body|Responses?):/i.test(t)) break;
			if (/^param:\s*\[/.test(t)) break;
			if (pastHeader && t.length > 5) descLines.push(t);
		}
		if (descLines.length > 0) fullDescription = descLines.join(" ");
	}

	// Parse params from full_text
	const params: Array<{ name: string; in: string; type: string; required: boolean; desc: string }> = [];
	if (item.full_text) {
		for (const line of item.full_text.split("\n")) {
			const m2 = line.match(
				/param:\s*\[(\w+)\]\s+(\S+)\s+\((\w+)(?:,\s*required)?\)/,
			);
			if (m2) {
				params.push({
					in: m2[1],
					name: m2[2],
					type: m2[3],
					required: line.includes("required"),
					desc: "",
				});
			}
		}
	}

	return (
		<div style={{ background: C.surface, borderRadius: 6, border: `1px solid ${C.borderAccent}` }}>
			{/* Header */}
			<div
				style={{
					padding: "11px 14px",
					borderBottom: `1px solid ${C.border}`,
					display: "flex",
					alignItems: "center",
					gap: 8,
				}}
			>
				<span
					style={{
						fontSize: 12,
						fontWeight: 600,
						color: C.textDim,
						textTransform: "uppercase",
						letterSpacing: "0.05em",
					}}
				>
					{isEp ? "Endpoint" : "Schema"}
				</span>
				<span style={{ flex: 1 }} />
				{isEp && (
					<button
						onClick={() => viewDocs(item.api, item.method ?? "GET", item.path ?? "", item.operation_id, item.tags?.split(",")[0]?.trim())}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 4,
							fontSize: 12,
							fontWeight: 500,
							border: "none",
							cursor: "pointer",
							padding: "4px 10px",
							borderRadius: 4,
							background: C.accentMuted,
							color: C.accent,
						}}
					>
						{Ic.doc(14)} Docs {Ic.arr(13)}
					</button>
				)}
				<button
					onClick={onClose}
					style={{
						display: "flex",
						border: "none",
						cursor: "pointer",
						padding: 3,
						background: "transparent",
						color: C.textDim,
						borderRadius: 4,
					}}
				>
					{Ic.x()}
				</button>
			</div>

			{/* Body */}
			<div style={{ padding: 14 }}>
				{isEp ? (
					<>
						{/* Method + API + Score */}
						<div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8, flexWrap: "wrap" }}>
							<span
								style={{
									fontSize: 12,
									fontWeight: 600,
									padding: "1px 8px",
									borderRadius: 4,
									fontFamily: "monospace",
									background: m!.bg,
									color: m!.text,
									border: `1px solid ${m!.border}`,
								}}
							>
								{item.method}
							</span>
							<span
								style={{
									fontSize: 12,
									padding: "1px 7px",
									borderRadius: 4,
									background: C.accentDim,
									color: C.accent,
									fontWeight: 500,
									display: "flex",
									alignItems: "center",
									gap: 3,
								}}
							>
								<span style={{ opacity: 0.5, display: "flex" }}>{Ic.tag()}</span>
								{item.api}
							</span>
							{item.score != null && <ScoreBar score={item.score} />}
						</div>

						{/* Path */}
						<div
							style={{
								background: C.bg,
								borderRadius: 4,
								padding: "7px 11px",
								marginBottom: 11,
								display: "flex",
								alignItems: "center",
								gap: 6,
							}}
						>
							<code style={{ fontSize: 12, fontFamily: "monospace", color: C.text, flex: 1, wordBreak: "break-all" }}>
								{item.path}
							</code>
							<button
								onClick={() => navigator.clipboard?.writeText(item.path ?? "")}
								style={{
									display: "flex",
									border: "none",
									cursor: "pointer",
									padding: 3,
									background: "transparent",
									color: C.textDim,
									borderRadius: 4,
									flexShrink: 0,
								}}
							>
								{Ic.copy()}
							</button>
						</div>

						{/* Description */}
						{fullDescription && (
							<p style={{ fontSize: 12, color: C.textMuted, margin: "0 0 14px", lineHeight: 1.5 }}>
								{fullDescription}
							</p>
						)}

						{/* Parameters */}
						{params.length > 0 && (
							<div style={{ marginBottom: 14 }}>
								<div
									style={{
										fontSize: 12,
										fontWeight: 600,
										color: C.textDim,
										textTransform: "uppercase",
										letterSpacing: "0.06em",
										marginBottom: 6,
									}}
								>
									Parameters
								</div>
								{params.map((p, j) => (
									<div
										key={j}
										style={{
											display: "flex",
											alignItems: "center",
											gap: 7,
											fontSize: 12,
											padding: "6px 8px",
											background: j % 2 === 0 ? C.bg : "transparent",
											borderRadius: 4,
										}}
									>
										<PBadge type={p.in} />
										<code style={{ fontFamily: "monospace", color: C.text, fontWeight: 500 }}>{p.name}</code>
										<span style={{ color: C.textDim, fontSize: 14 }}>{p.type}</span>
										{p.required && <span style={{ fontSize: 11, color: "#F87171" }}>req</span>}
										<span style={{ color: C.textDim, marginLeft: "auto", fontSize: 14 }}>{p.desc}</span>
									</div>
								))}
							</div>
						)}

						{/* Response (collapsible) */}
						{responseDisplay && <ResponseDropdown content={responseDisplay} />}

					</>
				) : (
					<>
						{/* Schema header */}
						<div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
							<span style={{ display: "flex", color: C.accent, opacity: 0.5 }}>{Ic.cube(18)}</span>
							<span style={{ fontSize: 14, fontWeight: 600, fontFamily: "monospace", color: C.text }}>
								{item.name}
							</span>
							<span
								style={{
									fontSize: 12,
									padding: "1px 7px",
									borderRadius: 4,
									background: C.accentDim,
									color: C.accent,
									fontWeight: 500,
									display: "flex",
									alignItems: "center",
									gap: 3,
								}}
							>
								<span style={{ opacity: 0.5, display: "flex" }}>{Ic.tag()}</span>
								{item.api}
							</span>
							{item.score != null && <ScoreBar score={item.score} />}
						</div>

						{/* Description */}
						<p style={{ fontSize: 12, color: C.textMuted, margin: "0 0 14px", lineHeight: 1.5 }}>
							{item.description}
						</p>

						{/* Full text */}
						{item.full_text && (
							<div
								style={{
									fontFamily: "monospace",
									fontSize: 12,
									color: C.textMuted,
									background: C.bg,
									borderRadius: 4,
									padding: "11px 14px",
									lineHeight: 1.7,
									whiteSpace: "pre-wrap",
									maxHeight: 300,
									overflow: "auto",
								}}
							>
								{item.full_text}
							</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}
