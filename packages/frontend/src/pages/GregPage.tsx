import { useState, useRef, useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { C } from "../lib/constants";
import { Ic } from "../lib/icons";
import { streamChat } from "../lib/api";
import type { EndpointCard } from "../lib/api";
import { useStore } from "../store/store";
import EpCard from "../components/EpCard";
import DetailPanel from "../components/DetailPanel";

function cleanText(raw: string): string {
	const text = raw
		.replace(/<endpoint[^>]*\/?>/g, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim();

	// Convert single newlines to double (markdown paragraph breaks)
	// but preserve: code blocks, tables, list items, headings
	const parts = text.split(/(```[\s\S]*?```)/);
	return parts.map((part, i) => {
		if (i % 2 === 1) return part; // code block
		return part.replace(/([^\n])\n([^\n])/g, (_, before, after) => {
			const prevLine = before.split("\n").pop() ?? before;
			// Don't double-space if either line is a table row, list item, or heading
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
				position: "absolute",
				top: 6,
				right: 6,
				display: "flex",
				border: "none",
				cursor: "pointer",
				padding: 4,
				borderRadius: 4,
				background: C.surfaceHover,
				color: copied ? C.green : C.textDim,
				opacity: copied ? 1 : 0.6,
				zIndex: 1,
				transition: "color 0.15s, opacity 0.15s",
			}}
		>
			{copied ? (
				<svg width={11} height={11} viewBox="0 0 12 12" fill="none">
					<path d="M2 6.5l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			) : (
				Ic.copy()
			)}
		</button>
	);
}

function GregMarkdown({ text }: { text: string }) {
	const langMap: Record<string, string> = { ts: "typescript", js: "javascript", py: "python", sh: "bash", yml: "yaml" };

	return (
		<ReactMarkdown
			remarkPlugins={[remarkGfm]}
			components={{
				code({ className, children }) {
					const match = /language-(\w+)/.exec(String(className ?? ""));
					const code = String(children ?? "").replace(/\n$/, "");

					if (match || code.includes("\n")) {
						const rawLang = match?.[1] ?? "text";
						const lang = langMap[rawLang] ?? rawLang;
						return (
							<div style={{ position: "relative" }}>
								<CopyBtn text={code} />
								<SyntaxHighlighter style={oneDark} language={lang} PreTag="div" wrapLongLines customStyle={{ background: C.bg, borderRadius: 4 }} codeTagProps={{ style: { background: C.bg } }}>
									{code}
								</SyntaxHighlighter>
							</div>
						);
					}

					return (
						<code style={{ background: C.bg, padding: "1px 5px", borderRadius: 4, fontFamily: "monospace", fontSize: "0.9em", color: C.accent }}>
							{children as React.ReactNode}
						</code>
					);
				},
				pre({ children }) {
					return <>{children as React.ReactNode}</>;
				},
				p({ children }) {
					return <p style={{ margin: "4px 0" }}>{children as React.ReactNode}</p>;
				},
				ul({ children }) {
					return <ul style={{ margin: "4px 0", paddingLeft: 18 }}>{children as React.ReactNode}</ul>;
				},
				ol({ children }) {
					return <ol style={{ margin: "4px 0", paddingLeft: 18 }}>{children as React.ReactNode}</ol>;
				},
				a({ href, children }) {
					return <a href={String(href)} style={{ color: C.accent }} target="_blank" rel="noopener noreferrer">{children as React.ReactNode}</a>;
				},
				img({ src, alt }) {
					return <img src={String(src)} alt={String(alt ?? "")} style={{ maxWidth: "100%", maxHeight: 200, borderRadius: 6, marginTop: 4 }} />;
				},
				table({ children }) {
					return <table style={{ borderCollapse: "collapse", width: "100%", margin: "6px 0", fontSize: 14 }}>{children as React.ReactNode}</table>;
				},
				thead({ children }) {
					return <thead style={{ borderBottom: `1px solid ${C.border}` }}>{children as React.ReactNode}</thead>;
				},
				th({ children }) {
					return <th style={{ textAlign: "left", padding: "4px 8px", color: C.text, fontWeight: 600 }}>{children as React.ReactNode}</th>;
				},
				td({ children }) {
					return <td style={{ padding: "4px 8px", borderTop: `1px solid ${C.border}`, color: C.textMuted }}>{children as React.ReactNode}</td>;
				},
			}}
		>
			{text}
		</ReactMarkdown>
	);
}

function EndpointDropdown({ endpoints, onSelect }: { endpoints: EndpointCard[]; onSelect: (ep: EndpointCard) => void }) {
	const [open, setOpen] = useState(false);
	const METHOD_COLORS: Record<string, { bg: string; text: string; border: string }> = {
		GET: { bg: "rgba(52,211,153,0.08)", text: "#34D399", border: "rgba(52,211,153,0.18)" },
		POST: { bg: "rgba(96,165,250,0.08)", text: "#60A5FA", border: "rgba(96,165,250,0.18)" },
		PUT: { bg: "rgba(251,191,36,0.08)", text: "#FBBF24", border: "rgba(251,191,36,0.18)" },
		DELETE: { bg: "rgba(248,113,113,0.08)", text: "#F87171", border: "rgba(248,113,113,0.18)" },
		PATCH: { bg: "rgba(192,132,252,0.08)", text: "#C084FC", border: "rgba(192,132,252,0.18)" },
	};

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
					{endpoints.length} endpoint{endpoints.length !== 1 ? "s" : ""} found
				</span>
				<span style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s", display: "flex" }}>
					<svg width={10} height={10} viewBox="0 0 10 10" fill="none">
						<path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
					</svg>
				</span>
			</button>
			{open && (
				<div style={{ marginTop: 3, display: "flex", flexDirection: "column", gap: 2, maxHeight: 200, overflow: "auto" }}>
					{[...endpoints].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((ep, j) => {
						const mc = METHOD_COLORS[ep.method] ?? METHOD_COLORS.GET;
						return (
							<div
								key={j}
								onClick={() => onSelect(ep)}
								style={{
									display: "flex",
									alignItems: "center",
									gap: 6,
									padding: "4px 8px",
									borderRadius: 4,
									cursor: "pointer",
									background: C.surface,
									border: `1px solid ${C.border}`,
								}}
								onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.borderHover; }}
								onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.border; }}
							>
								<span style={{ fontSize: 11, fontWeight: 600, padding: "1px 5px", borderRadius: 3, fontFamily: "monospace", background: mc.bg, color: mc.text, border: `1px solid ${mc.border}`, minWidth: 36, textAlign: "center" }}>
									{ep.method}
								</span>
								<code style={{ fontSize: 13, fontFamily: "monospace", color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
									{ep.path}
								</code>
								<span style={{ fontSize: 11, padding: "1px 5px", borderRadius: 3, background: C.accentDim, color: C.accent, fontWeight: 500, flexShrink: 0 }}>
									{ep.api}
								</span>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

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
		clearChat,
		detailItem,
		detailType,
		setDetail,
		customGregPrompt,
		customProPrompt,
	} = useStore();

	const [greetingGif, setGreetingGif] = useState<string | null>(null);
	useEffect(() => {
		if (!gregMode) return;
		fetch("/api/greeting-gif").then((r) => r.json()).then((d) => setGreetingGif(d.url)).catch(() => {});
	}, [gregMode]);

	const [input, setInput] = useState("");
	const messagesEndRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [chatMessages]);

	const handleSend = async () => {
		const text = input.trim();
		if (!text || chatLoading) return;

		setInput("");
		addChatMessage({ role: "user", text });
		addChatMessage({ role: "assistant", text: "", streaming: true });
		setChatLoading(true);

		const history = [
			...chatMessages.map((m) => ({ role: m.role, content: m.text })),
			{ role: "user" as const, content: text },
		];

		let accumulated = "";
		let endpoints: EndpointCard[] = [];

		try {
			const customPrompt = gregMode ? customGregPrompt : customProPrompt;
			for await (const event of streamChat(history, gregMode ? "greg" : "professional", customPrompt || undefined)) {
				switch (event.type) {
					case "text":
						accumulated += event.text ?? "";
						updateLastAssistant((m) => ({ ...m, text: accumulated }));
						break;
					case "endpoints":
						// Collect but don't show yet — wait for done
						endpoints = [...endpoints, ...(event.data ?? [])];
						break;
					case "error":
						accumulated += `\n[error: ${event.error}]`;
						updateLastAssistant((m) => ({ ...m, text: accumulated }));
						break;
					case "done":
						break;
				}
			}
		} catch (err) {
			accumulated += `\n[connection error]`;
			updateLastAssistant((m) => ({ ...m, text: accumulated }));
		}

		updateLastAssistant((m) => ({ ...m, streaming: false, endpoints: endpoints.length > 0 ? endpoints : undefined }));
		setChatLoading(false);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	return (
		<div style={{ padding: "14px 16px", height: "calc(100% - 56px)", display: "flex", flexDirection: "column" }}>
			{/* Chat header */}
			<div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 14, flexShrink: 0 }}>
				<div
					style={{
						width: 38,
						height: 38,
						borderRadius: 6,
						background: C.gregBg,
						border: `1px solid ${C.border}`,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<span style={{ fontFamily: "monospace", fontWeight: 700, color: C.green, fontSize: 16 }}>G</span>
				</div>
				<span style={{ fontSize: 16, fontWeight: 600, color: C.text }}>greg</span>
				<span style={{ fontSize: 14, color: C.textDim }}>knows ur apis</span>
				<span style={{ flex: 1 }} />

				{/* Personality toggle */}
				<div
					onClick={() => setGregMode(!gregMode)}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 7,
						cursor: "pointer",
						fontSize: 14,
						color: C.textDim,
						padding: "4px 11px",
						borderRadius: 6,
						background: C.surface,
						border: `1px solid ${C.border}`,
					}}
				>
					<div
						style={{
							width: 30,
							height: 17,
							borderRadius: 6,
							background: gregMode ? "rgba(52,211,153,0.3)" : C.border,
							position: "relative",
							transition: "background 0.15s",
						}}
					>
						<div
							style={{
								width: 11,
								height: 11,
								borderRadius: 6,
								background: gregMode ? C.green : C.textDim,
								position: "absolute",
								top: 3,
								left: gregMode ? 16 : 3,
								transition: "left 0.15s",
							}}
						/>
					</div>
					{gregMode ? "greg mode" : "professional"}
				</div>

				{/* New chat */}
				<button
					onClick={clearChat}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 4,
						fontSize: 14,
						border: `1px solid ${C.border}`,
						cursor: "pointer",
						padding: "4px 10px",
						borderRadius: 4,
						background: C.surface,
						color: C.textDim,
					}}
				>
					{Ic.plus(14)} new chat
				</button>
			</div>

			{/* Main area */}
			<div style={{ display: "flex", gap: 14, flex: 1, minHeight: 0 }}>
				{/* Messages */}
				<div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
					<div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
						{chatMessages.length === 0 && (
							<div
								style={{
									flex: 1,
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									flexDirection: "column",
									gap: 11,
									color: C.textDim,
								}}
							>
								<div
									style={{
										width: 54,
										height: 54,
										borderRadius: 8,
										background: C.gregBg,
										border: `1px solid ${C.border}`,
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
									}}
								>
									<span style={{ fontFamily: "monospace", fontWeight: 700, color: C.green, fontSize: 25 }}>G</span>
								</div>
								{gregMode && greetingGif && (
									<img src={greetingGif} alt="greg" style={{ maxHeight: 180, borderRadius: 8 }} />
								)}
								<span style={{ fontSize: 16 }}>
									{getGreeting(gregMode)}
								</span>
							</div>
						)}
						{chatMessages.map((msg, i) => (
							<div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
								<div style={{ maxWidth: "85%" }}>
									{msg.role === "assistant" && (
										<div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
											<span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 600, color: C.green }}>
												greg
											</span>
										</div>
									)}
									<div
										style={{
											padding: "10px 14px",
											borderRadius: 6,
											fontSize: 16,
											lineHeight: 1.5,
											background: msg.role === "user" ? C.userBg : C.gregBg,
											border: `1px solid ${msg.role === "user" ? C.borderAccent : C.border}`,
											color: msg.role === "user" ? C.text : C.textMuted,
										}}
									>
										{msg.role === "user" ? (
											msg.text
										) : msg.streaming ? (
											<span style={{ whiteSpace: "pre-wrap" }}>{cleanText(msg.text) || "..."}</span>
										) : (
											<GregMarkdown text={cleanText(msg.text)} />
										)}
									</div>
									{msg.endpoints && msg.endpoints.length > 0 && (
										<EndpointDropdown endpoints={msg.endpoints} onSelect={(ep) => setDetail(ep, "endpoints")} />
									)}
								</div>
							</div>
						))}
						<div ref={messagesEndRef} />
					</div>

					{/* Input */}
					<div style={{ display: "flex", gap: 8, marginTop: 17, flexShrink: 0 }}>
						<input
							type="text"
							placeholder={gregMode ? "talk to greg..." : "Search API documentation..."}
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={handleKeyDown}
							style={{
								flex: 1,
								height: 46,
								padding: "0 14px",
								background: C.surface,
								border: `1px solid ${C.border}`,
								borderRadius: 6,
								fontSize: 16,
								color: C.text,
								outline: "none",
							}}
							onFocus={(e) => ((e.target as HTMLElement).style.borderColor = "rgba(129,140,248,0.4)")}
							onBlur={(e) => ((e.target as HTMLElement).style.borderColor = C.border)}
						/>
						<button
							onClick={handleSend}
							disabled={chatLoading}
							style={{
								width: 46,
								height: 46,
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								background: C.accentMuted,
								border: "none",
								borderRadius: 6,
								cursor: chatLoading ? "not-allowed" : "pointer",
								color: C.accent,
								opacity: chatLoading ? 0.5 : 1,
							}}
						>
							{Ic.send()}
						</button>
					</div>
				</div>

				{/* Detail panel */}
				{detailItem && (
					<div style={{ width: 430, flexShrink: 0 }}>
						<DetailPanel item={detailItem as never} type={detailType} onClose={() => setDetail(null)} />
					</div>
				)}
			</div>
		</div>
	);
}
