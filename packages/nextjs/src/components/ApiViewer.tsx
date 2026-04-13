"use client";

import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import ReactMarkdown from "react-markdown";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";

import { METHOD_COLORS } from "@/lib/constants";
import { useStore } from "@/store/store";
import { cn } from "@/lib/utils";
import MermaidDiagram from "./MermaidDiagram";

SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("javascript", typescript);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("sh", bash);
SyntaxHighlighter.registerLanguage("shell", bash);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("yaml", yaml);
SyntaxHighlighter.registerLanguage("yml", yaml);

// ---------------------------------------------------------------------------
// Types (mirrored from /openapi/specs/[apiName]/route.ts — keep in sync)
// ---------------------------------------------------------------------------

interface OASchemaNode {
	type?: string;
	format?: string;
	title?: string;
	description?: string;
	nullable?: boolean;
	required?: string[];
	enum?: unknown[];
	properties?: Record<string, OASchemaNode>;
	items?: OASchemaNode;
	allOf?: OASchemaNode[];
	oneOf?: OASchemaNode[];
	anyOf?: OASchemaNode[];
	example?: unknown;
	default?: unknown;
}

interface OAParameter {
	name: string;
	in: "path" | "query" | "header" | "cookie";
	required: boolean;
	description?: string;
	schema?: OASchemaNode;
}

interface OARequestBody {
	description?: string;
	required: boolean;
	contentType: string;
	schema?: OASchemaNode;
	example?: unknown;
}

interface OAResponse {
	statusCode: string;
	description?: string;
	contentType?: string;
	schema?: OASchemaNode;
	example?: unknown;
}

interface OAOperation {
	method: string;
	path: string;
	operationId?: string;
	summary?: string;
	description?: string;
	tags: string[];
	deprecated: boolean;
	parameters: OAParameter[];
	requestBody?: OARequestBody;
	responses: OAResponse[];
	scopes?: string[];
}

interface OAGroup {
	tag: string;
	ops: OAOperation[];
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ApiViewerProps {
	apiName: string;
	anchor?: { method: string; path: string } | null;
	searchQuery?: string;
	zoom?: number;
	className?: string;
}

// ---------------------------------------------------------------------------
// JSON syntax highlighting (inline spans, no extra deps)
// ---------------------------------------------------------------------------

function escHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tokenizeJson(text: string): string {
	const re =
		/("(?:\\[\s\S]|[^"\\])*")([ \t]*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)/g;
	let last = 0;
	let out = "";
	let m: RegExpExecArray | null;
	while ((m = re.exec(text)) !== null) {
		if (m.index > last) out += escHtml(text.slice(last, m.index));
		const [, str, colon, num, kw] = m;
		if (str !== undefined) {
			const color = colon !== undefined ? "var(--g-accent)" : "var(--g-method-post-text)";
			out += `<span style="color:${color}">${escHtml(str)}</span>`;
			if (colon !== undefined) out += escHtml(colon);
		} else if (num !== undefined) {
			out += `<span style="color:var(--g-green)">${escHtml(num)}</span>`;
		} else if (kw !== undefined) {
			out += `<span style="color:var(--g-accent)">${escHtml(kw)}</span>`;
		}
		last = m.index + m[0]!.length;
	}
	if (last < text.length) out += escHtml(text.slice(last));
	return out;
}

// ---------------------------------------------------------------------------
// SchemaNode — recursive schema display
// ---------------------------------------------------------------------------

const SchemaNode = ({
	schema,
	depth = 0,
	requiredKeys,
}: {
	schema: OASchemaNode;
	depth?: number;
	requiredKeys?: string[];
}): JSX.Element => {
	if (depth > 4) return <span className="text-(--g-text-dim) text-xs">…</span>;

	// Combinator: allOf / oneOf / anyOf
	const combinator = schema.allOf ? "allOf" : schema.oneOf ? "oneOf" : schema.anyOf ? "anyOf" : null;
	const variants = schema.allOf ?? schema.oneOf ?? schema.anyOf;
	if (combinator && variants?.length) {
		return (
			<div className="space-y-1">
				<span className="text-[0.625rem] text-(--g-text-dim) uppercase tracking-wide">{combinator}</span>
				{variants.map((v, i) => (
					<div key={i} className="ml-3 border-l border-(--g-border) pl-2">
						<SchemaNode schema={v} depth={depth + 1} />
					</div>
				))}
			</div>
		);
	}

	// Object
	if (schema.type === "object" || schema.properties) {
		const props = Object.entries(schema.properties ?? {});
		if (!props.length) {
			return <span className="text-xs font-mono text-(--g-text-dim)">object</span>;
		}
		return (
			<div className="font-mono text-xs space-y-0.5">
				{props.map(([key, val]) => {
					const isRequired = (schema.required ?? requiredKeys ?? []).includes(key);
					return (
						<div key={key} className="flex items-start gap-1.5">
							<span style={{ color: "var(--g-accent)" }} className="shrink-0">{key}</span>
							{isRequired && <span className="text-[0.5rem] text-(--g-danger) shrink-0 mt-px">*</span>}
							<span className="text-(--g-text-dim) shrink-0">:</span>
							<SchemaNode schema={val} depth={depth + 1} />
						</div>
					);
				})}
			</div>
		);
	}

	// Array
	if (schema.type === "array" && schema.items) {
		const itemsIsComplex =
			schema.items.type === "object" ||
			!!schema.items.properties ||
			!!schema.items.allOf?.length ||
			!!schema.items.oneOf?.length ||
			!!schema.items.anyOf?.length;
		if (itemsIsComplex) {
			return (
				<div className="text-xs font-mono">
					<span className="text-(--g-text-dim)">array&lt;</span>
					<div className="ml-3 border-l border-(--g-border) pl-2 mt-0.5 mb-0.5">
						<SchemaNode schema={schema.items} depth={depth + 1} />
					</div>
					<span className="text-(--g-text-dim)">&gt;</span>
				</div>
			);
		}
		return (
			<span className="text-xs">
				<span className="text-(--g-text-dim) font-mono">array&lt;</span>
				<SchemaNode schema={schema.items} depth={depth + 1} />
				<span className="text-(--g-text-dim) font-mono">&gt;</span>
			</span>
		);
	}

	// Enum
	if (schema.enum?.length) {
		return (
			<span className="text-xs font-mono">
				<span className="text-(--g-accent)">{schema.type ?? "enum"}</span>
				<span className="text-(--g-text-dim)">
					{" "}({schema.enum.map((e) => JSON.stringify(e)).join(" | ")})
				</span>
			</span>
		);
	}

	// Primitive / fallback
	const typeStr = schema.type ?? "any";
	const formatStr = schema.format ? `<${schema.format}>` : "";
	return (
		<span className="text-xs font-mono">
			<span className="text-(--g-accent)">{typeStr}</span>
			{formatStr && <span className="text-(--g-text-dim)">{formatStr}</span>}
			{schema.description && (
				<span className="text-(--g-text-dim) font-sans ml-1.5 text-[0.6875rem]">
					— {schema.description}
				</span>
			)}
		</span>
	);
};

// ---------------------------------------------------------------------------
// ExampleBlock — JSON example with syntax highlighting
// ---------------------------------------------------------------------------

const ExampleBlock = ({ example }: { example: unknown }): JSX.Element => {
	let text: string;
	try {
		text = JSON.stringify(example, null, 2);
	} catch {
		text = String(example);
	}
	return (
		<pre
			className="overflow-x-auto rounded bg-(--g-bg) p-2 text-xs leading-relaxed text-(--g-text-muted)"
			// Safe: tokenizeJson only produces colored spans from JSON data — no user HTML
			// eslint-disable-next-line react/no-danger
			dangerouslySetInnerHTML={{ __html: tokenizeJson(text) }}
		/>
	);
};

// ---------------------------------------------------------------------------
// Markdown — shared renderer for all description fields in the spec
// ---------------------------------------------------------------------------

const stripMarkup = (text: string | undefined): string =>
	(text ?? "").replace(/<[^>]+>/g, "").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();

const renderPath = (path: string): JSX.Element[] => {
	const parts = path.split(/(\{[^}]+\})/);
	return parts.map((part, i) =>
		part.startsWith("{") && part.endsWith("}") ? (
			<span key={i} className="text-(--g-method-put-text)">{part}</span>
		) : (
			<span key={i}>{part}</span>
		),
	);
};

const MD_CLASSES = "[&_p]:my-0 [&_p+p]:mt-1.5 [&_a]:text-(--g-accent) [&_a]:underline [&_a:hover]:opacity-80 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.8em] [&_:not(pre)>code]:text-(--g-inline-code-text) [&_:not(pre)>code]:bg-(--g-surface) [&_:not(pre)>code]:rounded [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-px [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:my-1 [&_li]:my-0.5 [&_strong]:text-(--g-text) [&_strong]:font-semibold [&_em]:italic [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-(--g-text) [&_h1]:mt-3 [&_h1]:mb-1.5 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-(--g-text) [&_h2]:mt-2.5 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-(--g-text) [&_h3]:mt-2 [&_h3]:mb-1 [&_blockquote]:border-l-2 [&_blockquote]:border-(--g-border) [&_blockquote]:pl-2 [&_blockquote]:text-(--g-text-dim) [&_table]:w-full [&_table]:border-collapse [&_table]:my-2 [&_th]:text-left [&_th]:font-semibold [&_th]:text-(--g-text) [&_th]:px-2 [&_th]:py-1 [&_th]:border-b [&_th]:border-(--g-border) [&_td]:px-2 [&_td]:py-1 [&_td]:border-b [&_td]:border-(--g-border) [&_td]:text-(--g-text-muted)";

const LANG_ALIASES: Record<string, string> = {
	ts: "typescript",
	js: "javascript",
	py: "python",
	sh: "bash",
	shell: "bash",
	yml: "yaml",
};

const Markdown = ({ children, className }: { children: string; className?: string }): JSX.Element => {
	const theme = useStore((s) => s.theme);
	const isDark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
	const syntaxStyle = isDark ? oneDark : oneLight;

	const components = useMemo(() => ({
		code({ className: cls, children: kids }: { className?: string; children?: React.ReactNode }) {
			const match = /language-(\w+)/.exec(cls ?? "");
			const code = String(kids ?? "").replace(/\n$/, "");
			if (match || code.includes("\n")) {
				const rawLang = match?.[1] ?? "text";
				if (rawLang === "mermaid") return <MermaidDiagram code={code} isDark={isDark} />;
				const lang = LANG_ALIASES[rawLang] ?? rawLang;
				return (
					<SyntaxHighlighter
						style={syntaxStyle}
						language={lang}
						PreTag="div"
						customStyle={{ background: "var(--g-bg)", borderRadius: 6, fontSize: 12, lineHeight: 1.5, padding: "8px 12px", overflowX: "auto", margin: "6px 0" }}
						codeTagProps={{ style: { background: "var(--g-bg)", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre" } }}
					>
						{code}
					</SyntaxHighlighter>
				);
			}
			return <code className={cls}>{kids}</code>;
		},
		pre({ children: kids }: { children?: React.ReactNode }) {
			return <>{kids}</>;
		},
	}), [syntaxStyle, isDark]);

	return (
		<div className={cn("leading-relaxed", MD_CLASSES, className)}>
			<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={components as never}>
				{children}
			</ReactMarkdown>
		</div>
	);
};

// ---------------------------------------------------------------------------
// ParamTable — parameter list
// ---------------------------------------------------------------------------

const IN_BADGE: Record<string, string> = {
	path:   "bg-(--g-method-put-bg) text-(--g-method-put-text)",
	query:  "bg-(--g-accent-muted) text-(--g-accent)",
	header: "bg-(--g-surface) text-(--g-text-dim)",
	cookie: "bg-(--g-surface) text-(--g-text-dim)",
};

const ParamRow = ({ p }: { p: OAParameter }): JSX.Element => (
	<div className="rounded px-2 py-1.5 text-xs odd:bg-(--g-surface)">
		<div className="flex flex-wrap items-center gap-1.5">
			<span className={cn("px-1.5 py-0.5 rounded font-mono text-[0.625rem] uppercase tracking-wide shrink-0", IN_BADGE[p.in] ?? "")}>
				{p.in}
			</span>
			<code className="font-mono font-medium text-(--g-text) shrink-0">{p.name}</code>
			{p.required && (
				<span className="text-[0.625rem] text-(--g-danger) shrink-0">required</span>
			)}
			{p.schema?.type && (
				<span className="font-mono text-(--g-text-dim) text-[0.6875rem] shrink-0">
					{p.schema.type}{p.schema.format ? `<${p.schema.format}>` : ""}
				</span>
			)}
		</div>
		{p.description && (
			<Markdown className="text-(--g-text-dim) text-[0.6875rem] mt-1">{p.description}</Markdown>
		)}
	</div>
);

const CompactParamRow = ({ p }: { p: OAParameter }): JSX.Element => {
	const typeStr = p.schema?.type
		? `${p.schema.type}${p.schema.format ? `<${p.schema.format}>` : ""}`
		: "";
	return (
		<div className="flex items-baseline gap-2 px-2 py-1 text-xs odd:bg-(--g-surface) rounded">
			<span className="font-mono text-(--g-text) shrink-0">
				<span className="font-medium">{p.name}</span>
				{typeStr && (
					<>
						<span className="text-(--g-text-dim)">: </span>
						<span className="text-(--g-text-dim) text-[0.6875rem]">{typeStr}</span>
					</>
				)}
			</span>
			{p.required && (
				<span className="text-[0.625rem] text-(--g-danger) shrink-0">required</span>
			)}
			{p.description && (
				<Markdown className="text-(--g-text-dim) text-[0.6875rem] ml-auto text-right min-w-0 flex-1">
					{p.description}
				</Markdown>
			)}
		</div>
	);
};

const ParamGroup = ({ label, group, params }: { label: string; group: string; params: OAParameter[] }): JSX.Element => {
	const [open, setOpen] = useState(true);
	return (
		<div className="rounded border border-(--g-border) overflow-hidden">
			<button
				onClick={() => setOpen((v) => !v)}
				className="flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-left hover:bg-(--g-surface-hover) cursor-pointer"
			>
				<span className={cn("px-1.5 py-0.5 rounded font-mono text-[0.625rem] uppercase tracking-wide shrink-0", IN_BADGE[group] ?? "")}>
					{label}
				</span>
				<span className="text-(--g-text-muted) shrink-0">{params.length} parameter{params.length === 1 ? "" : "s"}</span>
				{params.some((p) => p.required) && (
					<span className="text-[0.625rem] text-(--g-danger) shrink-0">required</span>
				)}
				<span className={cn("flex text-(--g-text-dim) shrink-0 transition-transform duration-150 ml-auto", open ? "rotate-180" : "")}>
					<svg width={8} height={8} viewBox="0 0 10 10" fill="none">
						<path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</span>
			</button>
			{open && (
				<div className="px-2 py-1.5 border-t border-(--g-border) space-y-0.5">
					{params.map((p) => (
						<CompactParamRow key={`${p.in}:${p.name}`} p={p} />
					))}
				</div>
			)}
		</div>
	);
};

const ParamTable = ({ params }: { params: OAParameter[] }): JSX.Element => {
	const pathParams = params.filter((p) => p.in === "path");
	const queryParams = params.filter((p) => p.in === "query");
	const headerParams = params.filter((p) => p.in === "header");
	const otherParams = params.filter((p) => p.in !== "path" && p.in !== "query" && p.in !== "header");

	return (
		<div className="space-y-1">
			{pathParams.length > 0 && <ParamGroup label="path" group="path" params={pathParams} />}
			{queryParams.length > 0 && <ParamGroup label="query" group="query" params={queryParams} />}
			{headerParams.length > 0 && <ParamGroup label="header" group="header" params={headerParams} />}
			{otherParams.map((p) => (
				<ParamRow key={`${p.in}:${p.name}`} p={p} />
			))}
		</div>
	);
};

// ---------------------------------------------------------------------------
// schemaToJson — generate a representative JSON value from a schema node
// ---------------------------------------------------------------------------

function schemaToJson(schema: OASchemaNode, depth = 0): unknown {
	if (depth > 5) return "...";
	if (schema.example !== undefined) return schema.example;

	const variants = schema.allOf ?? schema.oneOf ?? schema.anyOf;
	if (variants?.length) return schemaToJson(variants[0]!, depth);

	if (schema.type === "object" || schema.properties) {
		const obj: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(schema.properties ?? {})) {
			obj[key] = schemaToJson(val, depth + 1);
		}
		return obj;
	}

	if (schema.type === "array") {
		return schema.items ? [schemaToJson(schema.items, depth + 1)] : [];
	}

	if (schema.enum?.length) return schema.enum[0];

	switch (schema.type) {
		case "string":
			return schema.format === "date-time"
				? "2024-01-01T00:00:00Z"
				: schema.format === "uuid"
					? "00000000-0000-0000-0000-000000000000"
					: schema.description?.toLowerCase().includes("id") ? "string_id" : "string";
		case "integer":
		case "number":
			return 0;
		case "boolean":
			return true;
		default:
			return null;
	}
}

// ---------------------------------------------------------------------------
// RequestBodySection
// ---------------------------------------------------------------------------

const RequestBodySection = ({ body }: { body: OARequestBody }): JSX.Element => {
	const preview = body.example ?? (body.schema ? schemaToJson(body.schema) : null);
	const [open, setOpen] = useState(true);
	return (
		<div className="rounded border border-(--g-border) overflow-hidden">
			<button
				onClick={() => setOpen((v) => !v)}
				className="flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-left hover:bg-(--g-surface-hover) cursor-pointer"
			>
				<span className="font-mono px-1.5 py-0.5 rounded bg-(--g-surface) text-(--g-text-dim) text-[0.625rem]">
					{body.contentType}
				</span>
				{body.required && (
					<span className="text-[0.625rem] text-(--g-danger)">required</span>
				)}
				<span className={cn("flex text-(--g-text-dim) shrink-0 transition-transform duration-150 ml-auto", open ? "rotate-180" : "")}>
					<svg width={8} height={8} viewBox="0 0 10 10" fill="none">
						<path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</span>
			</button>
			{open && preview != null && (
				<div className="px-2.5 pb-2.5 pt-1 border-t border-(--g-border)">
					<div className="overflow-y-auto max-h-[calc(20*1.375rem)] rounded">
						<ExampleBlock example={preview} />
					</div>
				</div>
			)}
		</div>
	);
};

// ---------------------------------------------------------------------------
// ResponsesSection
// ---------------------------------------------------------------------------

function statusColor(code: string): string {
	if (code.startsWith("2")) return "bg-emerald-500/10 text-emerald-500";
	if (code.startsWith("3")) return "bg-blue-400/10 text-blue-400";
	if (code.startsWith("4")) return "bg-(--g-danger-muted) text-(--g-danger)";
	if (code.startsWith("5")) return "bg-orange-400/10 text-orange-400";
	return "bg-(--g-surface) text-(--g-text-dim)";
}

const isEmptyPreview = (value: unknown): boolean => {
	if (value == null) return true;
	if (typeof value === "string") return value.length === 0;
	if (Array.isArray(value)) return value.length === 0;
	if (typeof value === "object") return Object.keys(value as object).length === 0;
	return false;
};

const ResponsesSection = ({ responses }: { responses: OAResponse[] }): JSX.Element => {
	const previews = useMemo(
		() =>
			new Map(
				responses.map((r) => [r.statusCode, r.example ?? (r.schema ? schemaToJson(r.schema) : null)] as const),
			),
		[responses],
	);

	const [open, setOpen] = useState<Set<string>>(
		() => new Set(responses.filter((r) => !isEmptyPreview(previews.get(r.statusCode))).map((r) => r.statusCode)),
	);

	const toggle = (code: string): void =>
		setOpen((prev) => {
			const next = new Set(prev);
			if (next.has(code)) next.delete(code); else next.add(code);
			return next;
		});

	return (
		<div className="space-y-1">
			{responses.map((r) => {
				const isOpen = open.has(r.statusCode);
				const preview = previews.get(r.statusCode);
				const hasDetail = !isEmptyPreview(preview);
				return (
					<div key={r.statusCode} className="rounded border border-(--g-border) overflow-hidden">
						<button
							onClick={() => hasDetail && toggle(r.statusCode)}
							className={cn(
								"flex items-center gap-2 w-full px-2.5 py-1.5 text-xs text-left",
								hasDetail ? "hover:bg-(--g-surface-hover) cursor-pointer" : "cursor-default",
							)}
						>
							<span className={cn("px-1.5 py-0.5 rounded font-mono font-bold text-[0.625rem] shrink-0", statusColor(r.statusCode))}>
								{r.statusCode}
							</span>
							<span className="text-(--g-text-muted) flex-1 min-w-0 truncate">{stripMarkup(r.description)}</span>
							{r.contentType && (
								<span className="font-mono text-[0.5625rem] text-(--g-text-dim) shrink-0">{r.contentType}</span>
							)}
							{hasDetail && (
								<span className={cn("flex text-(--g-text-dim) shrink-0 transition-transform duration-150", isOpen ? "rotate-180" : "")}>
									<svg width={8} height={8} viewBox="0 0 10 10" fill="none">
										<path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
									</svg>
								</span>
							)}
						</button>
						{isOpen && hasDetail && (
							<div className="px-2.5 pb-2.5 pt-1 border-t border-(--g-border)">
								<div className="overflow-y-auto max-h-[calc(20*1.375rem)] rounded">
									<ExampleBlock example={preview} />
								</div>
							</div>
						)}
					</div>
				);
			})}
		</div>
	);
};

// ---------------------------------------------------------------------------
// OpDetail — expanded operation detail panel
// ---------------------------------------------------------------------------

const OpDetail = ({ op }: { op: OAOperation }): JSX.Element => (
	<div className="border-t border-(--g-border) px-3.5 py-3 space-y-4">
		<div className="flex items-baseline gap-2 font-mono text-[0.75rem] leading-snug">
			<span className="font-semibold shrink-0 text-(--g-text-dim)">URI:</span>
			<code className="text-(--g-text) break-all min-w-0">{renderPath(op.path)}</code>
		</div>
		{op.description && (
			<Markdown className="text-xs text-(--g-text-muted)">{op.description}</Markdown>
		)}
		{op.parameters.length > 0 && (
			<div>
				<div className="text-[0.625rem] font-semibold text-(--g-text-dim) uppercase tracking-widest mb-1.5">
					Inputs
				</div>
				<ParamTable params={op.parameters} />
			</div>
		)}
		{op.requestBody && (
			<div>
				<div className="text-[0.625rem] font-semibold text-(--g-text-dim) uppercase tracking-widest mb-1.5">
					Request Body
				</div>
				<RequestBodySection body={op.requestBody} />
			</div>
		)}
		{op.responses.length > 0 && (
			<div>
				<div className="text-[0.625rem] font-semibold text-(--g-text-dim) uppercase tracking-widest mb-1.5">
					Responses
				</div>
				<ResponsesSection responses={op.responses} />
			</div>
		)}
		{op.scopes && op.scopes.length > 0 && (
			<div>
				<div className="text-[0.625rem] font-semibold text-(--g-text-dim) uppercase tracking-widest mb-1.5">
					Required scopes
				</div>
				<div className="flex flex-wrap gap-1.5">
					{op.scopes.map((scope) => (
						<code
							key={scope}
							className="font-mono text-xs px-1.5 py-0.5 rounded bg-(--g-surface) border border-(--g-border) text-(--g-accent)"
						>
							{scope}
						</code>
					))}
				</div>
			</div>
		)}
		{!op.description && !op.parameters.length && !op.requestBody && !op.responses.length && !op.scopes?.length && (
			<p className="text-xs text-(--g-text-dim)">No additional details.</p>
		)}
	</div>
);

// ---------------------------------------------------------------------------
// OpRow — one HTTP operation (collapsed summary + optional detail)
// ---------------------------------------------------------------------------

const Chevron = ({ open }: { open: boolean }): JSX.Element => (
	<span className={cn("flex text-(--g-text-dim) shrink-0 transition-transform duration-150", open ? "rotate-180" : "")}>
		<svg width={9} height={9} viewBox="0 0 10 10" fill="none">
			<path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
		</svg>
	</span>
);

const OpRow = ({
	op,
	isExpanded,
	isAnchor,
	onToggle,
}: {
	op: OAOperation;
	isExpanded: boolean;
	isAnchor: boolean;
	onToggle: () => void;
}): JSX.Element => {
	const key = `${op.method.toUpperCase()}:${op.path}`;
	const m = METHOD_COLORS[op.method] ?? METHOD_COLORS["GET"]!;

	return (
		<div
			id={`op-${CSS.escape(key)}`}
			className={cn(
				"border-b border-(--g-border) last:border-0",
				isAnchor && "bg-(--g-accent-dim)",
			)}
		>
			<button
				onClick={onToggle}
				className="flex items-center gap-2 w-full px-3.5 py-2.5 text-left hover:bg-(--g-surface-hover) transition-colors"
			>
				<span
					className="method-badge shrink-0 w-[3.75rem] text-center"
					style={{ background: m.bg, color: m.text, border: `1px solid ${m.border}` }}
				>
					{op.method}
				</span>
				<code className="font-mono text-[0.8125rem] text-(--g-text) flex-1 min-w-0 truncate">
					{renderPath(op.path)}
				</code>
				{op.deprecated && (
					<span className="text-[0.5625rem] text-(--g-danger) border border-(--g-danger)/50 px-1 rounded shrink-0">
						deprecated
					</span>
				)}
				{op.summary && (
					<span className="text-xs text-(--g-text-dim) truncate max-w-[35%] hidden sm:block shrink-0">
						{op.summary}
					</span>
				)}
				<Chevron open={isExpanded} />
			</button>
			{isExpanded && <OpDetail op={op} />}
		</div>
	);
};

// ---------------------------------------------------------------------------
// TagGroup — collapsible group of operations under one tag
// ---------------------------------------------------------------------------

const TagGroup = ({
	group,
	anchor,
	expandedOps,
	isExpanded,
	onToggleTag,
	onToggleOp,
}: {
	group: OAGroup;
	anchor?: { method: string; path: string } | null;
	expandedOps: Set<string>;
	isExpanded: boolean;
	onToggleTag: () => void;
	onToggleOp: (key: string) => void;
}): JSX.Element => (
	<div className="rounded-md border border-(--g-border) mb-2 overflow-hidden">
		<button
			onClick={onToggleTag}
			className="flex items-center gap-2.5 w-full px-3.5 py-2.5 text-left bg-(--g-surface) hover:bg-(--g-surface-hover) transition-colors"
		>
			<span className={cn("flex text-(--g-text-dim) shrink-0 transition-transform duration-150", isExpanded ? "rotate-0" : "-rotate-90")}>
				<svg width={9} height={9} viewBox="0 0 10 10" fill="none">
					<path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			</span>
			<span className="font-semibold text-sm text-(--g-text)">{group.tag}</span>
			<span className="text-xs text-(--g-text-dim)">{group.ops.length}</span>
		</button>
		{isExpanded && (
			<div>
				{group.ops.map((op) => {
					const key = `${op.method.toUpperCase()}:${op.path}`;
					const isAnchor = Boolean(
						anchor &&
						op.method.toUpperCase() === anchor.method.toUpperCase() &&
						op.path === anchor.path,
					);
					return (
						<OpRow
							key={key}
							op={op}
							isExpanded={expandedOps.has(key)}
							isAnchor={isAnchor}
							onToggle={() => onToggleOp(key)}
						/>
					);
				})}
			</div>
		)}
	</div>
);

// ---------------------------------------------------------------------------
// Main ApiViewer
// ---------------------------------------------------------------------------

type InfoMsg = { type: "info"; title: string; version: string; description?: string };
type GroupMsg = { type: "group"; tag: string; ops: OAOperation[] };

const ApiViewer = ({
	apiName,
	anchor,
	searchQuery = "",
	zoom = 1,
	className,
}: ApiViewerProps): JSX.Element => {
	const [info, setInfo] = useState<Omit<InfoMsg, "type"> | null>(null);
	const [groups, setGroups] = useState<OAGroup[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set());
	const [expandedOps, setExpandedOps] = useState<Set<string>>(new Set());

	// Stream spec groups from the server
	useEffect(() => {
		if (!apiName) return;
		let cancelled = false;

		setLoading(true);
		setInfo(null);
		setGroups([]);
		setError(null);
		setExpandedTags(new Set());
		setExpandedOps(new Set());

		void (async () => {
			try {
				const res = await fetch(`/openapi/specs/${encodeURIComponent(apiName)}`);
				if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

				const reader = res.body.getReader();
				const dec = new TextDecoder();
				let buf = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					buf += dec.decode(value, { stream: true });
					const lines = buf.split("\n");
					buf = lines.pop() ?? "";
					for (const line of lines) {
						if (!line.trim() || cancelled) continue;
						try {
							const msg: InfoMsg | GroupMsg = JSON.parse(line) as InfoMsg | GroupMsg;
							if (msg.type === "info") setInfo({ title: msg.title, version: msg.version, description: msg.description });
							if (msg.type === "group") setGroups((prev) => [...prev, { tag: msg.tag, ops: msg.ops }]);
						} catch {
							// skip malformed line
						}
					}
				}
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : String(e));
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();

		return () => { cancelled = true; };
	}, [apiName]);

	// Anchor: expand tag + op as soon as the relevant group arrives mid-stream
	useEffect(() => {
		if (!anchor || !groups.length) return;
		const key = `${anchor.method.toUpperCase()}:${anchor.path}`;
		const group = groups.find((g) =>
			g.ops.some(
				(o) =>
					o.method.toUpperCase() === anchor.method.toUpperCase() &&
					o.path === anchor.path,
			),
		);
		if (!group) return;

		setExpandedTags((prev) => new Set([...prev, group.tag]));
		setExpandedOps((prev) => new Set([...prev, key]));

		// Two-frame delay: first RAF yields to React's commit, second ensures layout is ready
		requestAnimationFrame(() => requestAnimationFrame(() => {
			const el = document.getElementById(`op-${CSS.escape(key)}`);
			el?.scrollIntoView({ behavior: "smooth", block: "start" });
		}));
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [anchor?.method, anchor?.path, groups]);

	// Search: filter already-arrived groups (works during streaming too)
	const q = searchQuery.toLowerCase().trim();
	const visibleGroups = useMemo(
		() =>
			groups
				.map((g) => ({
					...g,
					ops: q
						? g.ops.filter(
								(op) =>
									op.path.toLowerCase().includes(q) ||
									op.method.toLowerCase() === q ||
									(op.summary ?? "").toLowerCase().includes(q) ||
									(op.description ?? "").toLowerCase().includes(q) ||
									op.tags.some((t) => t.toLowerCase().includes(q)),
							)
						: g.ops,
				}))
				.filter((g) => g.ops.length > 0),
		[groups, q],
	);

	const toggleTag = useCallback((tag: string) => {
		setExpandedTags((prev) => {
			const next = new Set(prev);
			if (next.has(tag)) next.delete(tag); else next.add(tag);
			return next;
		});
	}, []);

	const toggleOp = useCallback((key: string) => {
		setExpandedOps((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key); else next.add(key);
			return next;
		});
	}, []);

	return (
		<div
			// CSS zoom applied to the entire viewer — resize handle mutates the parent
			// container's width directly (no React state), so this component never
			// re-renders from panel resize events.
			style={zoom !== 1 ? { zoom } : undefined}
			className={cn("h-full w-full overflow-y-auto overflow-x-hidden p-3", className)}
		>
			{/* Spec header */}
			{info && (
				<div className="mb-5 px-0.5">
					<div className="flex items-baseline gap-2.5 flex-wrap">
						<h1 className="text-xl font-semibold text-(--g-text)">{info.title}</h1>
						{info.version && (
							<span className="text-sm text-(--g-text-dim) font-mono">{info.version}</span>
						)}
					</div>
					{info.description && (
						<Markdown className="text-sm text-(--g-text-muted) mt-2">{info.description}</Markdown>
					)}
				</div>
			)}

			{/* Loading skeleton — shown during initial stream before first group arrives */}
			{loading && !info && (
				<div className="flex items-center justify-center py-16 text-(--g-text-dim) text-sm">
					<span className="animate-pulse">Loading…</span>
				</div>
			)}

			{/* Error */}
			{error && (
				<div className="rounded border border-(--g-danger)/30 bg-(--g-danger-muted) px-3 py-2 text-xs text-(--g-danger)">
					{error}
				</div>
			)}

			{/* Tag groups — render progressively as they stream in */}
			{visibleGroups.map((g) => (
				<TagGroup
					key={g.tag}
					group={g}
					anchor={anchor}
					expandedOps={expandedOps}
					isExpanded={expandedTags.has(g.tag)}
					onToggleTag={() => toggleTag(g.tag)}
					onToggleOp={toggleOp}
				/>
			))}

			{/* Empty search state */}
			{!loading && q && visibleGroups.length === 0 && groups.length > 0 && (
				<div className="text-xs text-(--g-text-dim) py-6 text-center">
					No endpoints match &ldquo;{searchQuery}&rdquo;
				</div>
			)}

			{/* Streaming indicator — shown while more groups are arriving */}
			{loading && groups.length > 0 && (
				<div className="flex justify-center py-2">
					<span className="text-[0.625rem] text-(--g-text-dim) animate-pulse">loading more…</span>
				</div>
			)}
		</div>
	);
};

export default ApiViewer;
