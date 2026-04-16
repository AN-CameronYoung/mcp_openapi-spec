"use client";

import React, { useState, useRef, useEffect, useLayoutEffect, memo, useCallback, useMemo } from "react";
import { useGroupRef } from "react-resizable-panels";
import type { Layout } from "react-resizable-panels";
import { useShallow } from "zustand/react/shallow";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";

import { METHOD_COLORS } from "../lib/constants";
import { Ic } from "../lib/icons";
import { streamChat, listModels, fetchSuggestions, generateFollowUpSuggestions, getEndpoint, getDocContent } from "../lib/api";
import type { EndpointCard, DocCard, Personality } from "../lib/api";
import ApiViewer from "../components/ApiViewer";
import GroupedApiSelect from "../components/GroupedApiSelect";
import GroupedDocSelect from "../components/GroupedDocSelect";
import MarkdownContent from "../components/MarkdownContent";
import MermaidDiagram from "../components/MermaidDiagram";
import { cn } from "../lib/utils";
import { useStore, pageFromHash, chatIdFromHash, getActiveConversation } from "../store/store";
import type { ChatMsg } from "../store/store";
import EpCard from "../components/EpCard";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { splitIntoPages, PAGE_LIMIT } from "../lib/docPagination";
import { TabBar } from "../components/chat/TabBar";
import { ForkButton } from "../components/chat/ForkButton";
import { ForkContext } from "../components/chat/ForkContext";
import { usePanelRef } from "react-resizable-panels";

import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "../components/ui/resizable";

SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("javascript", typescript);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("yaml", yaml);

// Detect field-sizing: content support once at module load (Chrome 123+, Firefox 136+).
// Browsers that support it resize the textarea natively with no JS layout reflow.
const supportsFieldSizing =
  typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  CSS.supports("field-sizing", "content");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatListItem =
  | { kind: "message"; msg: ChatMsg; msgIndex: number }
  | { kind: "boundary" };

interface CopyBtnProps {
  text: string;
}

interface InputBoxWrapperProps {
  children: React.ReactNode;
}

interface CodeDropdownProps {
  code: string;
  lang: string;
  lineCount: number;
  blockKey: string;
}

interface StreamingTextProps {
  text: string;
  personality?: Personality;
  msgKey: number | string;
}

interface ApiPathCodeProps {
  code: string;
}

interface LiDropdownProps {
  children?: React.ReactNode;
  index: number;
}

interface SectionDropdownProps {
  title: string;
  body: string;
  msgKey: number | string;
  langMap: Record<string, string>;
  defaultOpen: boolean;
  isDark: boolean;
}

interface GregMarkdownProps {
  text: string;
  msgKey: number | string;
}

interface EndpointDropdownProps {
  endpoints: EndpointCard[];
  onSelect: (ep: EndpointCard) => void;
}

interface DebugPanelProps {
  entries: Record<string, unknown>[];
  model?: string;
  compactedTokens?: number;
  compactedHistory?: Array<{ role: string; content: string }>;
  onClose: () => void;
}

interface DebugPanelEntriesProps {
  entries: Record<string, unknown>[];
}

interface VerificationBadgeProps {
  text: string;
  usage?: { input: number; output: number };
  msgKey: number | string;
  streaming?: boolean;
}

interface ChatMessageProps {
  msg: ChatMsg;
  i: number;
  onSelectEndpoint: (ep: EndpointCard) => void;
  onSelectDoc: (dc: DocCard) => void;
  onShowDebug: (idx: number) => void;
  onRetry: (idx: number) => void;
  onQuickAction: (msgIdx: number, action: "diagram" | "code", diagramType?: string) => void;
  onFork?: (msgIdx: number) => void;
  onDelete: (idx: number) => void;
  loadingGif?: string | null;
}

interface SwaggerPanelProps {
  anchor: { api: string; method?: string; path?: string } | null;
  onClose: () => void;
}

interface HeadingSection {
  preamble?: string;
  items: {
    title: string;
    body: string;
  }[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const collapseBtn = "flex items-center gap-1.5 border-none cursor-pointer bg-transparent";
const debugEntry = "font-mono text-[0.6875rem] leading-[1.65]";
const debugGroupLabel = "text-[0.625rem] text-(--g-text-dim) py-2 pb-[0.1875rem] font-mono uppercase tracking-[0.06em]";
const EMPTY_DEBUG: Record<string, unknown>[] = [];

// Per-million-token pricing for Anthropic models (input, output)
const ANTHROPIC_PRICING: Record<string, [number, number]> = {
  "claude-opus-4-6": [15, 75],
  "claude-sonnet-4-6": [3, 15],
  "claude-haiku-4-5": [0.80, 4],
  "claude-opus-4": [15, 75],
  "claude-sonnet-4": [3, 15],
  "claude-3-5-sonnet": [3, 15],
  "claude-3-5-haiku": [0.80, 4],
  "claude-3-opus": [15, 75],
};

const PERSONALITY_COLOR: Record<Personality, string> = {
  greg: "var(--g-green)",
  explanatory: "var(--g-method-put-text)",
  quick: "var(--g-method-post)",
  casual: "var(--g-method-patch)",
};

const BUBBLE_STYLES: Record<Personality, { bg: string; border: string }> = {
  greg: { bg: "color-mix(in srgb, var(--g-green) 6%, transparent)", border: "color-mix(in srgb, var(--g-green) 20%, transparent)" },
  explanatory: { bg: "color-mix(in srgb, var(--g-method-put) 6%, transparent)", border: "color-mix(in srgb, var(--g-method-put) 20%, transparent)" },
  quick: { bg: "color-mix(in srgb, var(--g-method-post) 6%, transparent)", border: "color-mix(in srgb, var(--g-method-post) 20%, transparent)" },
  casual: { bg: "color-mix(in srgb, var(--g-method-patch) 6%, transparent)", border: "color-mix(in srgb, var(--g-method-patch) 20%, transparent)" },
};

const METHOD_RE = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/\S*|$)/;
const PARAM_RE = /(\{[a-zA-Z_][a-zA-Z0-9_]*\}|<[a-zA-Z][a-zA-Z0-9_-]*>)/g;
const PARAM_TEST = /\{[a-zA-Z_][a-zA-Z0-9_]*\}|<[a-zA-Z][a-zA-Z0-9_-]*>/;

// Minimum semantic-search score (0–1) for a search-returned endpoint to render
// as a card. Exact-match lookups (get_endpoint, inline route mentions) always
// bypass this threshold.
const CARD_SCORE_THRESHOLD = 0.6;

const relevantEndpoints = (eps: EndpointCard[]): EndpointCard[] =>
  eps.filter((ep) => (ep.score ?? 0) >= CARD_SCORE_THRESHOLD);

const GREG_GREETINGS = [
  "greg here. what api u need",
  "yo. greg ready. ask greg thing",
  "greg online. u need endpoint or what",
  "greg awake. what u looking for",
  "sup. greg know ur apis. ask",
  "greg here. tell greg what u need",
  "ok greg ready. go",
];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Returns a formatted USD cost string for a Claude API call, or null if the model is unrecognised.
 *
 * @param model - The model ID string
 * @param usage - Input and output token counts
 */
const estimateCost = (model: string | undefined, usage: { input: number; output: number }): string | null => {
  if (!model || !model.startsWith("claude")) return null;

  // Match longest key first so "claude-3-5-sonnet" beats "claude-3"
  const key = Object.keys(ANTHROPIC_PRICING)
    .sort((a, b) => b.length - a.length)
    .find((k) => model.startsWith(k));
  if (!key) return null;

  const [inputRate, outputRate] = ANTHROPIC_PRICING[key]!;
  const cost = (usage.input * inputRate + usage.output * outputRate) / 1_000_000;

  if (cost === 0) return "0.000000";

  // Show 4 significant figures after any leading zeros
  const magnitude = Math.floor(Math.log10(cost));
  const decimals = Math.min(Math.max(2, 2 - magnitude + 3), 8);

  return cost.toFixed(decimals);
};

/**
 * Normalises raw LLM output: strips endpoint tags, unwraps markdown tables from code fences,
 * and converts single newlines to paragraph breaks while preserving code blocks and list structure.
 *
 * @param raw - The raw LLM text string
 */
// Split text on fenced code blocks AND inline backtick spans, yielding
// alternating [prose, code, prose, code, …] segments. Used to protect any
// code content from regex transforms meant only for prose.
const splitOnCode = (text: string): string[] =>
  text.split(/(```[\s\S]*?```|`[^`\n]*`)/);

// Streaming-time stripper: just drop inline control tags so they don't flash
// visibly mid-stream. Avoids the full cleanText regex pipeline running per token
// on ever-growing text.
const stripStreamTags = (raw: string): string =>
  raw
    .replace(/<endpoint[^>]*\/?>/g, "")
    .replace(/<quickActions[^>]*\/?>/g, "")
    .replace(/<followups>[\s\S]*?<\/followups>/g, "")
    .replace(/^(#{1,6}|[-*+]) \*\*(.*?)\*\*/gm, "$1 $2");

const cleanText = (raw: string): string => {
  // First pass: strip <endpoint/> tags and unwrap fake table code blocks.
  // These operate on fenced blocks themselves, so they have to run first.
  const pre = raw
    .replace(/<endpoint[^>]*\/?>/g, "")
    .replace(/<quickActions[^>]*\/?>/g, "")
    // Safety net: the server stripper handles <followups> during streaming,
    // but older persisted history or an interrupted stream could still carry
    // the tag through. Drop it (and its payload) before markdown parsing.
    .replace(/<followups>[\s\S]*?<\/followups>/g, "")
    .replace(/```[^\n]*\n([\s\S]*?)```/g, (match, inner: string) => {
      const lines = inner.trim().split("\n").filter((l: string) => l.trim());
      const isTable = lines.length >= 2 && lines.every((l: string) => l.trimStart().startsWith("|"));
      return isTable ? inner.trim() : match;
    });

  // Prose-only transforms: apply only to segments OUTSIDE code blocks/inline code.
  const proseTransform = (s: string): string =>
    s
      .replace(/\n{3,}/g, "\n\n")
      // Strip ** from heading and bullet lines (LLM sometimes redundantly bolds them)
      .replace(/^(#{1,6}|[-*+]) \*\*(.*?)\*\*/gm, "$1 $2")
      // Break when colon is immediately followed by a capital letter (no space/newline)
      .replace(/:([A-Z])/g, ":\n\n$1")
      // Break before labeled sections ("Proxmox workflow:", "Darktrace workflow:") after sentence end
      .replace(/([.!?)])\s+([A-Z][a-z]+ \w+:)/g, "$1\n\n$2");

  const text = splitOnCode(pre)
    .map((part, i) => (i % 2 === 1 ? part : proseTransform(part)))
    .join("")
    .trim();

  // Second pass: convert single newlines to double (markdown paragraph breaks)
  // in prose segments only; preserve tables, list items, headings, and code.
  return splitOnCode(text)
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(/([^\n])\n([^\n])/g, (_, before, after) => {
        const prevLine = before.split("\n").pop() ?? before;
        if (prevLine.trimStart().startsWith("|") || after.trimStart().startsWith("|")) return `${before}\n${after}`;
        if (/^[-*\d#>]/.test(after.trimStart())) return `${before}\n${after}`;
        if (prevLine.trimStart().startsWith("|---")) return `${before}\n${after}`;
        return `${before}\n\n${after}`;
      });
    })
    .join("");
};

/**
 * Returns the first string child from a React node array.
 *
 * @param children - React children to inspect
 */
const getTextFromChildren = (children: React.ReactNode): string => {
  const nodes = Array.isArray(children) ? children : [children];
  return nodes.find((c) => typeof c === "string") ?? "";
};

/**
 * Returns a stable numeric hash string for the given string, for use as a React key.
 *
 * @param s - The string to hash
 */
const stableKey = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
};

/**
 * Returns true if the given inline code string looks like an API path.
 *
 * @param code - The inline code text
 */
const isApiPath = (code: string): boolean => {
  if (METHOD_RE.test(code)) return true;
  if (code.startsWith("/") && PARAM_TEST.test(code)) return true;
  return false;
};

/**
 * Returns the appropriate greeting string for the active personality.
 *
 * @param personality - The active chat personality
 */
const getGreeting = (personality: Personality): string => {
  if (personality === "explanatory") return "Ready to explain your APIs in depth. What would you like to understand?";
  if (personality === "quick") return "What can I help you with?";
  if (personality === "casual") return "ok";
  return GREG_GREETINGS[Math.floor(Math.random() * GREG_GREETINGS.length)]!;
};

// ---------------------------------------------------------------------------
// Small UI components
// ---------------------------------------------------------------------------

/**
 * Icon button that copies text to the clipboard and briefly shows a checkmark on success.
 */
const CopyBtn = ({ text }: CopyBtnProps): JSX.Element => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const handleClick = () => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    clearTimeout(timer.current);
  };

  const handleMouseLeave = () => {
    if (!copied) return;
    timer.current = setTimeout(() => setCopied(false), 1000);
  };

  const handleMouseEnter = () => {
    clearTimeout(timer.current);
  };

  return (
    <button
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "flex items-center justify-center w-[2.125rem] h-[2.125rem] shrink-0 rounded-md border-none cursor-pointer p-2 transition-[color,opacity] duration-150 bg-(--g-surface-hover)",
        copied ? "opacity-100 text-(--g-green)" : "opacity-70 text-(--g-text-dim)",
      )}
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
};

const ENDPOINT_RE = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[^\s\n`'")\]]+)/g;

const stripCodeBlocks = (text: string): string =>
  text
    .replace(/```[\s\S]*?```/g, (block) => {
      // Preserve any API endpoint references found inside the block
      const endpoints = [...block.matchAll(ENDPOINT_RE)].map((m) => `\`${m[1]} ${m[2]}\``);
      return endpoints.length > 0 ? `(${endpoints.join(", ")})` : "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// Max chars to keep per assistant message in auto-compact mode
const AUTO_COMPACT_MAX_CHARS = 800;

/**
 * Aggressively compacts an assistant message for inclusion in API history.
 * Strips code blocks first, then truncates long prose to AUTO_COMPACT_MAX_CHARS.
 */
const compactMessage = (text: string): string => {
  const stripped = stripCodeBlocks(text);
  if (stripped.length <= AUTO_COMPACT_MAX_CHARS) return stripped;
  // Truncate at a word boundary near the limit
  const cutoff = stripped.lastIndexOf(" ", AUTO_COMPACT_MAX_CHARS);
  return stripped.slice(0, cutoff > 0 ? cutoff : AUTO_COMPACT_MAX_CHARS) + "\n[…]";
};

/**
 * Token counter with color-coded context health, an info popover, and a compact button at red.
 */
const TokenCounter = ({ chatMessages, provider, onCompact }: { chatMessages: ChatMsg[]; provider?: string; onCompact: () => void }): JSX.Element | null => {
  const [showInfo, setShowInfo] = useState(false);
  const msgsWithUsage = chatMessages.filter((m) => m.role === "assistant" && m.usage);
  if (chatMessages.length === 0) return null;

  const isOllama = provider === "ollama";
  const warnAt = isOllama ? 60_000 : 100_000;
  const redAt  = isOllama ? 100_000 : 150_000;

  // Context size = last assistant's input tokens (that's what the model actually received)
  // Summing all turns' usage.input overcounts since each turn includes the full prior history.
  const lastAsst = msgsWithUsage[msgsWithUsage.length - 1];
  const lastIn   = lastAsst?.usage?.input ?? 0;
  const lastOut  = lastAsst?.usage?.output ?? 0;
  const total = lastAsst
    ? lastIn + lastOut
    : chatMessages.reduce((s, m) => s + Math.ceil(m.text.length / 4), 0);

  const isRed = total >= redAt;
  // Lerp from yellow (#CA8A04) to red (#DC2626) between warnAt and redAt
  const lerpColor = (): string => {
    if (total < warnAt) return "var(--g-text-dim)";
    const t = Math.min(1, (total - warnAt) / (redAt - warnAt));
    // yellow: [202, 138, 4]  red: [220, 38, 38]
    const r = Math.round(202 + (220 - 202) * t);
    const g = Math.round(138 + (38  - 138) * t);
    const b = Math.round(4   + (38  - 4)   * t);
    return `rgb(${r},${g},${b})`;
  };
  const color = lerpColor();
  const fmt   = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : String(total);

  return (
    <div className="relative flex items-center gap-1">
      <span className="font-mono text-[0.625rem] tabular-nums" style={{ color }}>
        {fmt}
      </span>
      <button
        onMouseEnter={() => setShowInfo(true)}
        onMouseLeave={() => setShowInfo(false)}
        className="flex items-center justify-center w-3.5 h-3.5 rounded-full text-[0.5625rem] font-bold border cursor-default select-none leading-none"
        style={{ color: "var(--g-text-dim)", borderColor: "var(--g-border-hover)" }}
      >
        i
      </button>
      {isRed && (
        <button
          onClick={onCompact}
          className="flex items-center gap-0.5 h-[1.125rem] px-1.5 rounded text-[0.5625rem] font-medium border cursor-pointer transition-colors hover:bg-(--g-danger-muted)"
          style={{ color: "var(--g-danger)", borderColor: "color-mix(in srgb, var(--g-danger) 30%, transparent)" }}
          title="Remove code blocks and endpoint cards from chat history to free up context"
        >
          compact
        </button>
      )}
      {showInfo && (
        <div className="absolute bottom-full left-0 mb-2 w-72 rounded-lg border border-(--g-border-hover) bg-(--g-surface) shadow-lg p-4 z-50 text-xs leading-[1.55] text-(--g-text-muted)">
          <div className="text-sm font-semibold text-(--g-text) mb-2">Context window usage</div>
          <p className="mb-2">
            <span className="font-mono text-(--g-text)">{lastIn.toLocaleString()}</span> in &nbsp;·&nbsp; <span className="font-mono text-(--g-text)">{lastOut.toLocaleString()}</span> out
          </p>
          <p className="mb-2.5">Tracks the last turn's actual token count — what the model received in its most recent call. As the conversation grows this number increases; once the context fills, earlier instructions get ignored.</p>
          <div className="flex flex-col gap-1 border-t border-(--g-border) pt-2">
            <span style={{ color: "var(--g-text-dim)" }}>● Gray — healthy</span>
            <span style={{ color: "#CA8A04" }}>● Yellow — getting full, consider a new chat ({warnAt / 1000}k+)</span>
            <span style={{ color: "var(--g-danger)" }}>● Red — degradation likely ({redAt / 1000}k+)</span>
          </div>
          <p className="mt-2 text-[0.6875rem] text-(--g-text-dim)">{isOllama ? "Thresholds adjusted for local models." : "Thresholds for Claude models."}</p>
        </div>
      )}
    </div>
  );
};

/**
 * Styled container for the chat input area; border colour changes on focus and is tinted by the active personality.
 */
const InputBoxWrapper = ({ children }: InputBoxWrapperProps): JSX.Element => {
  const [focused, setFocused] = useState(false);

  return (
    <div
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={() => setFocused(false)}
      className="flex flex-col rounded-xl px-3.5 pt-3.5 pb-2.5 transition-[border-color,background] duration-150"
      style={{
        background: "var(--g-surface)",
        border: `1px solid ${focused ? "var(--g-accent)" : "var(--g-border)"}`,
      }}
    >
      {children}
    </div>
  );
};

/**
 * Collapsible code block with syntax highlighting and a copy button.
 */
const CodeDropdown = ({ code, lang, lineCount, blockKey }: CodeDropdownProps): JSX.Element => {
  const { open, toggle, theme } = useStore(useShallow((s) => ({ open: !!s.openCodeBlocks[blockKey], toggle: s.toggleCodeBlock, theme: s.theme })));
  const isDark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const syntaxStyle = isDark ? oneDark : oneLight;

  return (
    <div className="my-1.5">
      <div className="flex items-center gap-2">
        <button
          onClick={() => toggle(blockKey)}
          className={cn(collapseBtn, "flex-1 text-left rounded-md border border-(--g-border-accent) px-3 py-1 text-sm text-(--g-accent) bg-(--g-accent-dim)")}
        >
          <span className="font-mono font-medium">code: {lineCount} lines</span>
          <span className={cn("ml-auto flex transition-transform duration-150", open ? "rotate-180" : "rotate-0")}>
            <svg width={10} height={10} viewBox="0 0 10 10" fill="none">
              <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
        <CopyBtn text={code} />
      </div>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="mt-1">
            <SyntaxHighlighter showLineNumbers style={syntaxStyle} language={lang} PreTag="div" customStyle={{ background: "var(--g-code-bg)", color: "var(--g-inline-code-text)", borderRadius: 6, fontSize: 13, lineHeight: 1.5, padding: "8px 12px", overflowX: "auto" }} codeTagProps={{ style: { background: "var(--g-code-bg)", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre" } }} lineNumberStyle={{ color: "color-mix(in srgb, var(--g-text-dim) 60%, transparent)", minWidth: "2em", paddingRight: "1em", userSelect: "none", fontStyle: "normal" }}>
              {code}
            </SyntaxHighlighter>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Renders streaming assistant text with a loading animation when empty,
 * and a "coding..." spinner when a code block is mid-stream.
 */
const StreamingText = ({ text, personality, msgKey }: StreamingTextProps): JSX.Element => {
  const dotColor = PERSONALITY_COLOR[personality ?? "greg"] ?? "var(--g-green)";
  const theme = useStore((s) => s.theme);
  const isDark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const components = useMemo(() => mdComponents(msgKey, LANG_MAP, isDark), [msgKey, isDark]);
  const cleaned = stripStreamTags(text);

  if (!cleaned) return (
    <span className="inline-flex items-center gap-1 py-px">
      {[0, 1, 2].map((i) => (
        <span key={i} className="inline-block w-1.5 h-1.5 rounded-full" style={{
          background: dotColor,
          animation: `greg-bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </span>
  );

  // Check for an unclosed code block (streaming in progress)
  const openFences = (cleaned.match(/```/g) || []).length;
  const hasUnclosedCode = openFences % 2 === 1;

  if (hasUnclosedCode) {
    // Render text before the unclosed code block through markdown, then show "coding..." spinner
    const lastFence = cleaned.lastIndexOf("```");
    const before = cleaned.slice(0, lastFence).trim();
    return (
      <>
        {before && (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as never}>{before}</ReactMarkdown>
        )}
        <div className="flex items-center gap-2 py-2 text-(--g-text-dim)">
          <svg className="animate-spin inline-block w-3.5 h-3.5" width={14} height={14} viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20 12" />
          </svg>
          <span className="text-sm italic">coding...</span>
        </div>
      </>
    );
  }

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as never}>{cleaned}</ReactMarkdown>
  );
};

/**
 * Renders an API path (with optional HTTP method prefix) with colour-coded method and path params.
 */
const ApiPathCode = ({ code }: ApiPathCodeProps): JSX.Element => {
  const methodMatch = METHOD_RE.exec(code);
  const method = methodMatch?.[1];
  const path = method ? code.slice(methodMatch![0]!.length - methodMatch![2]!.length) : code;
  const mc = method ? (METHOD_COLORS[method] ?? METHOD_COLORS.GET) : null;

  const renderPath = (p: string): React.ReactNode[] => {
    const parts = p.split(PARAM_RE);
    return parts.map((part, i) =>
      PARAM_TEST.test(part)
        ? <span key={i} className="text-(--g-method-patch-text)">{part}</span>
        : <span key={i} className="text-(--g-accent)">{part}</span>,
    );
  };

  return (
    <code className="rounded bg-(--g-code-bg) py-px px-[0.3125rem] font-mono text-[0.9em]">
      {mc && (
        <span className="font-bold mr-[0.3125rem]" style={{ color: mc.text }}>{method}</span>
      )}
      {renderPath(path)}
    </code>
  );
};

// ---------------------------------------------------------------------------
// Markdown component map
// ---------------------------------------------------------------------------

// Hoisted so its identity is stable across renders — used as a `useMemo` dep
// key when building the react-markdown components map. A new object each render
// would invalidate the memo and remount every child (including MermaidDiagram),
// which wiped the rendered SVG on any post-stream update.
const LANG_MAP: Record<string, string> = { ts: "typescript", js: "javascript", py: "python", sh: "bash", yml: "yaml" };

/**
 * Builds the react-markdown component map for a given message key and language alias map.
 *
 * @param msgKey - Unique key for the message (for stable code block keys)
 * @param langMap - Map of language aliases to canonical language names
 */
const mdComponents = (msgKey: number | string, langMap: Record<string, string>, isDark: boolean) => ({
  code({ className, children }: { className?: string; children?: React.ReactNode }) {
    const match = /language-(\w+)/.exec(String(className ?? ""));
    const code = String(children ?? "").replace(/\n$/, "");
    const DATA_LANGS = new Set(["json", "md", "markdown", "text"]);
    const syntaxStyle = isDark ? oneDark : oneLight;

    if (match || code.includes("\n")) {
      const rawLang = match?.[1] ?? "text";
      if (rawLang === "mermaid") return <MermaidDiagram code={code} isDark={isDark} />;
      const lang = langMap[rawLang] ?? rawLang;
      const trimmed = code.trimStart();
      const looksLikeJson = !match && (trimmed.startsWith("{") || trimmed.startsWith("["));
      if (DATA_LANGS.has(lang) || looksLikeJson) {
        const renderLang = looksLikeJson ? "json" : (lang === "md" || lang === "markdown" ? "text" : lang);
        return (
          <SyntaxHighlighter style={syntaxStyle} language={renderLang} PreTag="div" customStyle={{ background: "var(--g-code-bg)", color: "var(--g-inline-code-text)", borderRadius: 6, fontSize: 13, lineHeight: 1.5, padding: "8px 12px", overflowX: "auto", margin: "6px 0" }} codeTagProps={{ style: { background: "var(--g-code-bg)", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre" } }}>
            {code}
          </SyntaxHighlighter>
        );
      }
      const lineCount = code.split("\n").length;
      if (lineCount <= 30) {
        return (
          <div className="relative my-1.5 group">
            <div className="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              <CopyBtn text={code} />
            </div>
            <SyntaxHighlighter showLineNumbers style={syntaxStyle} language={lang} PreTag="div" customStyle={{ background: "var(--g-code-bg)", color: "var(--g-inline-code-text)", borderRadius: 6, fontSize: 13, lineHeight: 1.5, padding: "8px 12px", overflowX: "auto" }} codeTagProps={{ style: { background: "var(--g-code-bg)", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre" } }} lineNumberStyle={{ color: "color-mix(in srgb, var(--g-text-dim) 60%, transparent)", minWidth: "2em", paddingRight: "1em", userSelect: "none", fontStyle: "normal" }}>
              {code}
            </SyntaxHighlighter>
          </div>
        );
      }
      const key = `msg-${msgKey}-${stableKey(code)}`;
      return <CodeDropdown code={code} lang={lang} lineCount={lineCount} blockKey={key} />;
    }

    if (isApiPath(code)) return <ApiPathCode code={code} />;
    return (
      <code className="rounded bg-(--g-code-bg) py-px px-[0.3125rem] font-mono text-[0.9em]" style={{ color: "var(--g-inline-code-text)" }}>
        {children as React.ReactNode}
      </code>
    );
  },
  pre({ children }: { children?: React.ReactNode }) { return <>{children as React.ReactNode}</>; },
  p({ children }: { children?: React.ReactNode }) { return <p className="my-[0.625rem]">{children as React.ReactNode}</p>; },
  ul({ children }: { children?: React.ReactNode }) { return <ul className="my-1 pl-[1.125rem]">{children as React.ReactNode}</ul>; },
  ol({ children, node }: { children?: React.ReactNode; node?: { children?: unknown[] } }) {
    const liCount = node?.children?.filter((c: unknown) => c && typeof c === "object" && (c as { tagName?: string }).tagName === "li").length ?? 0;
    if (liCount < 3) return <ol className="my-1 pl-[1.125rem]">{children as React.ReactNode}</ol>;
    // Wrap each li child in a LiDropdown
    let idx = 0;
    const wrapped = React.Children.map(children, (child) => {
      if (child && typeof child === "object" && "type" in (child as React.ReactElement) && (child as React.ReactElement).type === "li") {
        return <LiDropdown index={idx++}>{(child as React.ReactElement).props.children}</LiDropdown>;
      }
      return child;
    });
    return <ol className="my-1 pl-0 list-none">{wrapped}</ol>;
  },
  a({ href, children }: { href?: string; children?: React.ReactNode }) { return <a href={String(href)} className="text-(--g-accent)" target="_blank" rel="noopener noreferrer">{children as React.ReactNode}</a>; },
  img({ src, alt }: { src?: string; alt?: string }) { return <img src={String(src)} alt={String(alt ?? "")} className="block max-w-full max-h-[18.75rem] rounded-[0.625rem] mt-1.5" />; },
  table({ children }: { children?: React.ReactNode }) { return <div className="overflow-x-auto my-1.5"><table className="border-collapse min-w-full text-sm">{children as React.ReactNode}</table></div>; },
  thead({ children }: { children?: React.ReactNode }) { return <thead className="border-b border-(--g-border)">{children as React.ReactNode}</thead>; },
  th({ children }: { children?: React.ReactNode }) { return <th className="py-1 px-2 text-left font-semibold text-(--g-text)">{children as React.ReactNode}</th>; },
  td({ children }: { children?: React.ReactNode }) { return <td className="py-1 px-2 border-t border-(--g-border) text-(--g-text-muted)">{children as React.ReactNode}</td>; },
  h1({ children }: { children?: React.ReactNode }) { return <h1 className="text-xl font-bold text-(--g-text) mt-4 mb-1.5 leading-snug">{children as React.ReactNode}</h1>; },
  h2({ children }: { children?: React.ReactNode }) { return <h2 className="text-lg font-semibold text-(--g-text) mt-3.5 mb-1 leading-snug">{children as React.ReactNode}</h2>; },
  h3({ children }: { children?: React.ReactNode }) { return <h3 className="text-base font-semibold text-(--g-text) mt-3 mb-1 leading-snug">{children as React.ReactNode}</h3>; },
  h4({ children }: { children?: React.ReactNode }) { return <h4 className="text-sm font-semibold text-(--g-text) mt-2.5 mb-0.5 leading-snug">{children as React.ReactNode}</h4>; },
  h5({ children }: { children?: React.ReactNode }) { return <h5 className="text-sm font-semibold text-(--g-text-muted) mt-2 mb-0.5">{children as React.ReactNode}</h5>; },
  h6({ children }: { children?: React.ReactNode }) { return <h6 className="text-xs font-semibold text-(--g-text-muted) mt-2 mb-0.5 uppercase tracking-wide">{children as React.ReactNode}</h6>; },
  strong({ children }: { children?: React.ReactNode }) { return <strong className="font-semibold text-(--g-text)">{children as React.ReactNode}</strong>; },
  em({ children }: { children?: React.ReactNode }) { return <em className="italic">{children as React.ReactNode}</em>; },
  blockquote({ children }: { children?: React.ReactNode }) { return <blockquote className="my-2 pl-3 border-l-2 border-(--g-border-accent) text-(--g-text-muted) italic">{children as React.ReactNode}</blockquote>; },
  hr() { return <hr className="my-3 border-none border-t border-(--g-border)" />; },
  li({ children }: { children?: React.ReactNode }) { return <li className="my-0.5">{children as React.ReactNode}</li>; },
});

// ---------------------------------------------------------------------------
// LiDropdown
// ---------------------------------------------------------------------------

/**
 * Returns true if children contain any block-level element (paragraph, list, etc.)
 * indicating there is sub-content worth collapsing.
 */
const hasSubContent = (children: React.ReactNode): boolean => {
  const BLOCK = new Set(["p", "ul", "ol", "blockquote", "pre", "table", "div"]);
  const nodes = Array.isArray(children) ? children : [children];
  return nodes.some((c) => c && typeof c === "object" && "type" in (c as React.ReactElement) && BLOCK.has((c as React.ReactElement).type as string));
};

/**
 * Collapsible list item — shows a summary line, expands to reveal full content on click.
 * Renders as a plain list item when there is no block-level sub-content.
 */
const LiDropdown = ({ children, index }: LiDropdownProps): JSX.Element => {
  const [open, setOpen] = useState(false);

  if (!hasSubContent(children)) {
    return <li className="list-decimal ml-[1.125rem] mb-0.5">{children as React.ReactNode}</li>;
  }

  const text = (
    getTextFromChildren(children).split("\n")[0] ?? ""
  ).slice(0, 80) ?? `Step ${index + 1}`;

  const handleToggle = () => setOpen(!open);

  return (
    <li className="list-none mb-1">
      <button
        onClick={handleToggle}
        className={cn(collapseBtn, "py-px text-left bg-none")}
      >
        <span className={cn(
          "inline-block text-xs transition-transform duration-150 text-(--g-text-dim)",
          open ? "rotate-90" : "rotate-0")
        }>▶</span>
        <span className="text-[0.9375rem] text-(--g-text)"><strong>{index + 1}.</strong> {text}</span>
      </button>
      {open &&
        <div className="pl-[1.375rem] text-sm text-(--g-text-muted)">
          {children as React.ReactNode}
        </div>
      }
    </li>
  );
};

// ---------------------------------------------------------------------------
// SectionDropdown
// ---------------------------------------------------------------------------

/**
 * Collapsible markdown section triggered by a heading line.
 */
const SectionDropdown = ({ title, body, msgKey, langMap, defaultOpen, isDark }: SectionDropdownProps): JSX.Element => {
  const [open, setOpen] = useState(defaultOpen);
  const components = useMemo(() => mdComponents(msgKey, langMap, isDark), [msgKey, langMap, isDark]);

  if (!body.trim()) {
    return <div className="mb-1.5"><span className="text-xl font-semibold text-(--g-text)">{title}</span></div>;
  }

  const handleToggle = () => setOpen(!open);

  return (
    <div className="mb-1.5">
      <button
        onClick={handleToggle}
        className={cn(collapseBtn, "w-full py-1 text-left bg-none")}
      >
        <span className={cn(
          "inline-block text-base transition-transform duration-150 text-(--g-text-dim)",
          open ? "rotate-90" : "rotate-0")
        }>▶</span>
        <span className="text-xl font-semibold text-(--g-text)">{title}</span>
      </button>
      {open && (
        <div className="pl-[1.125rem] text-sm">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as never}>{body}</ReactMarkdown>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// GregMarkdown
// ---------------------------------------------------------------------------

/**
 * Renders assistant markdown, splitting into collapsible section dropdowns when 2+ headings are present.
 */
const GregMarkdown = ({ text, msgKey }: GregMarkdownProps): JSX.Element => {
  const langMap = LANG_MAP;
  const theme = useStore((s) => s.theme);
  const isDark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const components = useMemo(() => mdComponents(msgKey, langMap, isDark), [msgKey, langMap, isDark]);

  // Split into sections by headings — only use dropdowns if 2+ headings
  // Replace code block content with spaces (preserving length) so # comments inside don't match as headings
  const textForScan = text.replace(/```[\s\S]*?```/g, (m) => " ".repeat(m.length));
  const sectionRegex = /^(#{1,3})\s+(.+)$/gm;
  const headings = [...textForScan.matchAll(sectionRegex)];

  // When there are multiple sections, show them in dropdowns.
  // If there's just one section, show it expanded by default without a dropdown (since there's no choice to be made)
  if (headings.length >= 2) {
    const sections: HeadingSection = { items: [] };

    const firstIdx = headings[0]!.index!;
    if (firstIdx > 0) sections.preamble = text.slice(0, firstIdx).trim();

    for (let i = 0; i < headings.length; i++) {
      const h = headings[i]!;
      const start = h.index! + h[0]!.length;
      const end = i + 1 < headings.length ? headings[i + 1]!.index! : text.length;
      sections.items.push({
        title: h[2]!,
        body: text.slice(start, end).trim(),
      });
    }

    return (
      <>
        {sections.preamble && (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as never}>{sections.preamble}</ReactMarkdown>
        )}
        {sections.items.map((s, i) => (
          <SectionDropdown key={i} title={s.title} body={s.body} msgKey={msgKey} langMap={langMap} defaultOpen={true} isDark={isDark} />
        ))}
      </>
    );
  }

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as never}>
      {text}
    </ReactMarkdown>
  );
};

// ---------------------------------------------------------------------------
// EndpointDropdown
// ---------------------------------------------------------------------------

/**
 * Collapsible list of retrieved endpoint cards, sorted by score descending.
 */
const EndpointDropdown = ({ endpoints, onSelect }: EndpointDropdownProps): JSX.Element => {
  const [open, setOpen] = useState(false);

  const handleToggle = () => setOpen(!open);

  return (
    <div>
      <button
        onClick={handleToggle}
        className={cn(collapseBtn, "w-full rounded border border-(--g-border-accent) px-2.5 py-1 text-[0.8125rem] text-(--g-accent) bg-(--g-accent-dim)")}
      >
        <span className="flex items-center gap-1.5 flex-1 text-left">
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          <span className="font-semibold">{endpoints.length}</span>
          {` endpoint${endpoints.length !== 1 ? "s" : ""}`}
        </span>
        <span className={cn("flex transition-transform duration-150", open ? "rotate-180" : "rotate-0")}>
          <svg width={10} height={10} viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="tree-children flex flex-col gap-[0.1875rem] mt-1 max-h-[18.75rem] overflow-auto">
            {[...endpoints].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((ep, j) => (
              <div key={j} className="tree-item">
                <EpCard
                  method={ep.method}
                  path={ep.path}
                  api={ep.api}
                  description={ep.description}
                  {... (ep.warnings !== undefined && { warnings: ep.warnings })}
                  onClick={() => onSelect(ep)}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// DocDropdown
// ---------------------------------------------------------------------------

const DOC_CARD_SCORE_THRESHOLD = 0.72;

interface DocDropdownProps {
  docs: DocCard[];
  onSelect: (dc: DocCard) => void;
}

const chevronSvg = (
  <svg width={10} height={10} viewBox="0 0 10 10" fill="none">
    <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const DocDropdown = ({ docs, onSelect }: DocDropdownProps): JSX.Element => {
  const [open, setOpen] = useState(false);
  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());
  const filtered = docs.filter((d) => (d.score ?? 0) >= DOC_CARD_SCORE_THRESHOLD);
  if (filtered.length === 0) return <></>;

  // Group by doc_name, preserving best-score order
  const grouped = filtered.reduce<Map<string, DocCard[]>>((acc, dc) => {
    const existing = acc.get(dc.doc_name);
    if (existing) existing.push(dc);
    else acc.set(dc.doc_name, [dc]);
    return acc;
  }, new Map());
  const uniqueDocCount = grouped.size;

  const toggleDoc = (name: string) =>
    setExpandedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(collapseBtn, "w-full rounded border border-(--g-border) px-2.5 py-1 text-[0.8125rem] text-(--g-text-muted) bg-(--g-surface)")}
      >
        <span className="flex items-center gap-1.5 flex-1 text-left">
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-70">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <span className="font-semibold">{uniqueDocCount}</span>
          {` doc${uniqueDocCount !== 1 ? "s" : ""}`}
        </span>
        <span className={cn("flex transition-transform duration-150", open ? "rotate-180" : "rotate-0")}>
          {chevronSvg}
        </span>
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="tree-children flex flex-col gap-[0.1875rem] mt-1 max-h-[14rem] overflow-auto">
            {[...grouped.entries()].map(([docName, cards]) => {
              const isExpanded = expandedDocs.has(docName);
              const sorted = [...cards].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
              return (
                <div key={docName} className="tree-item">
                <div className="rounded border border-(--g-border) overflow-hidden">
                  <button
                    onClick={() => toggleDoc(docName)}
                    className="flex items-center gap-1.5 w-full text-left px-2.5 py-1.5 bg-(--g-surface) hover:bg-(--g-surface-raised) transition-colors cursor-pointer"
                  >
                    {Ic.doc(12)}
                    <span className="font-mono text-xs text-(--g-text) truncate flex-1">{docName}</span>
                    {cards[0]?.project && <Badge variant="api" className="shrink-0">{cards[0].project}</Badge>}
                    <span className="text-[0.6875rem] text-(--g-text-dim) shrink-0 mr-1">{cards.length}</span>
                    <span className={cn("flex shrink-0 transition-transform duration-150", isExpanded ? "rotate-180" : "rotate-0")}>
                      {chevronSvg}
                    </span>
                  </button>
                  <div
                    className="grid transition-[grid-template-rows] duration-150 ease-out"
                    style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
                  >
                    <div className="overflow-hidden">
                      <div className="flex flex-col border-t border-(--g-border)">
                        {sorted.map((dc, j) => (
                          <button
                            key={j}
                            onClick={() => onSelect(dc)}
                            className="flex items-center gap-1.5 w-full text-left px-6 py-1 text-[0.75rem] text-(--g-text-muted) hover:text-(--g-text) hover:bg-(--g-surface-raised) transition-colors border-b border-(--g-border) last:border-b-0 cursor-pointer"
                          >
                            <span className="shrink-0 mr-1">•</span>
                            <span className="truncate prose prose-sm prose-neutral dark:prose-invert max-w-none [&>*]:inline [&>p]:m-0">
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{dc.heading || dc.heading_path || "—"}</ReactMarkdown>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// DebugPanelEntries
// ---------------------------------------------------------------------------

/**
 * Renders the list of debug trace entries inside the debug panel.
 */
const DebugPanelEntries = ({ entries }: DebugPanelEntriesProps): JSX.Element => {
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
          <div key={`grp-${i}`} className={debugGroupLabel}>
            {group}
          </div>,
        );
      }
      const inTok = (e.inputTokens as number ?? 0).toLocaleString();
      const outTok = (e.outputTokens as number ?? 0).toLocaleString();
      const stop = e.stopReason as string ?? "";
      rows.push(
        <div key={`r-${i}`} className={cn(debugEntry, "font-medium truncate text-(--g-accent)")}>
          in:{inTok} out:{outTok} stop:{stop}
        </div>,
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
        <div key={`tc-${i}`} className={debugEntry}>
          <span className="text-(--g-accent)">→ </span>
          <span className="text-(--g-green)">{expanded ? full : preview}</span>
          {truncated && (
            <button onClick={() => toggleExpand(i)} className="pl-1 border-none bg-transparent cursor-pointer font-mono text-[0.625rem] text-(--g-accent)">
              {expanded ? "less" : "more"}
            </button>
          )}
        </div>,
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
        <div key={`tr-${i}`} className={cn(debugEntry, "ml-2")}>
          <span className="text-(--g-text-muted)">← {name}: {len} chars, {count} cards</span>
          <div className="mt-px text-[0.625rem] text-(--g-text-dim) whitespace-pre-wrap wrap-break-word">
            {expanded ? resultText : preview}{truncated && !expanded && "…"}
          </div>
          {truncated && (
            <button onClick={() => toggleExpand(i)} className="pl-0 border-none bg-transparent cursor-pointer font-mono text-[0.625rem] text-(--g-accent)">
              {expanded ? "show less" : `show all (${(e.resultLength as number ?? 0).toLocaleString()} chars)`}
            </button>
          )}
        </div>,
      );
      continue;
    }

    // Fallback for other event types
    rows.push(
      <div key={`oth-${i}`} className={cn(debugEntry, "truncate text-(--g-text-dim)")}>
        {JSON.stringify(e)}
      </div>,
    );
  }

  return <>{rows}</>;
};

// ---------------------------------------------------------------------------
// DebugPanel
// ---------------------------------------------------------------------------

/**
 * Side panel showing the full debug trace for a completed assistant message.
 */
const DebugPanel = memo(({ entries, model, compactedTokens, compactedHistory, onClose }: DebugPanelProps): JSX.Element => {
  const [showHistory, setShowHistory] = useState(true);

  const rounds = entries.filter((e) => (e as { event: string }).event === "round");
  const lastRound = rounds[rounds.length - 1] as { totalInput?: number; totalOutput?: number; inputTokens?: number; outputTokens?: number } | undefined;
  const primaryTokens = lastRound ? ((lastRound.totalInput ?? lastRound.inputTokens ?? 0) + (lastRound.totalOutput ?? lastRound.outputTokens ?? 0)) : 0;
  const toolCallCount = entries.filter((e) => (e as { event: string }).event === "tool_call").length;

  // Verification tokens
  const verifyEntry = entries.find((e) => (e as { event: string }).event === "verification_done") as { inputTokens?: number; outputTokens?: number } | undefined;
  const verifyTokens = verifyEntry ? ((verifyEntry.inputTokens ?? 0) + (verifyEntry.outputTokens ?? 0)) : 0;
  const grandTotal = primaryTokens + verifyTokens;

  const primaryCost = estimateCost(model, {
    input: (lastRound?.totalInput ?? lastRound?.inputTokens ?? 0),
    output: (lastRound?.totalOutput ?? lastRound?.outputTokens ?? 0),
  });
  const verifyCost = verifyEntry ? estimateCost("claude-sonnet-4", {
    input: verifyEntry.inputTokens ?? 0,
    output: verifyEntry.outputTokens ?? 0,
  }) : null;
  const totalCostNum = (primaryCost ? parseFloat(primaryCost) : 0) + (verifyCost ? parseFloat(verifyCost) : 0);
  const cost = totalCostNum > 0 ? totalCostNum.toFixed(Math.max(2, 6 - Math.floor(Math.log10(totalCostNum)))) : primaryCost;

  return (
    <div className="flex flex-col h-full min-w-0 overflow-hidden border-l border-(--g-border) bg-(--g-surface)">
      {/* Header */}
        <div className="flex items-center shrink-0 px-3.5 py-2.5 border-b border-(--g-border) bg-(--g-bg)">
          <span className="flex-1 text-xs font-medium text-(--g-text-muted)">Debug trace</span>
          <span className={cn(debugEntry, "mr-2 text-(--g-text-dim)")}>{entries.length} events</span>
          <Button variant="ghost" size="icon-xs" onClick={onClose}>{Ic.x(12)}</Button>
        </div>

        {/* Scroll area */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 py-2.5">
          {entries.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-xs text-(--g-text-dim)">
              No debug data yet
            </div>
          ) : (
            <DebugPanelEntries entries={entries} />
          )}
          {compactedHistory && compactedHistory.length > 0 && (
            <div className="mt-3 border-t border-(--g-border) pt-2.5">
              <button
                onClick={() => setShowHistory((v) => !v)}
                className={cn(collapseBtn, "text-[0.625rem] font-mono text-(--g-text-dim) hover:text-(--g-text-muted) mb-1.5")}
              >
                <span className={cn("transition-transform duration-150", showHistory ? "rotate-90" : "rotate-0")}>▶</span>
                <span className="ml-1">context sent ({compactedHistory.length} messages{compactedTokens ? `, -${compactedTokens.toLocaleString()} tok` : ""})</span>
              </button>
              {showHistory && (
                <div className="flex flex-col gap-2">
                  {[...compactedHistory].reverse().map((m, i) => (
                    <div key={i} className="text-[0.625rem] font-mono">
                      <span className={cn("font-semibold", m.role === "user" ? "text-(--g-accent)" : "text-(--g-method-patch-text)")}>{m.role}</span>
                      <pre className="whitespace-pre-wrap break-all mt-0.5 text-(--g-text-dim) leading-[1.5]">{m.content}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Token bar */}
        <div className="flex flex-col gap-1 shrink-0 px-3 py-[0.4375rem] border-t border-(--g-border) bg-(--g-bg)">
          <div className="flex gap-3.5">
            <span className={cn(debugEntry, "text-(--g-text-dim)")}>
              primary <span className="text-(--g-text-muted)">{primaryTokens.toLocaleString()}</span>
            </span>
            {verifyTokens > 0 && (
              <span className={cn(debugEntry, "text-(--g-text-dim)")}>
                double check <span className="text-(--g-green)">{verifyTokens.toLocaleString()}</span>
              </span>
            )}
            <span className={cn(debugEntry, "text-(--g-text-dim)")}>
              <span className="text-(--g-text-muted)">{toolCallCount}</span> tools
            </span>
            {compactedTokens !== undefined ? (
              <span className={cn(debugEntry, compactedTokens > 0 ? "text-(--g-method-patch-text)" : "text-(--g-text-dim)")}>
                auto-compact: {compactedTokens > 0 ? `-${compactedTokens.toLocaleString()} tok` : "on"}
              </span>
            ) : null}
          </div>
          <div className="flex gap-3.5">
            <span className={cn(debugEntry, "font-semibold text-(--g-text)")}>
              total {grandTotal.toLocaleString()} tokens
            </span>
            {cost && (
              <span className={cn(debugEntry, "text-(--g-text-dim)")}>
                ${cost}
              </span>
            )}
          </div>
        </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// VerificationBadge
// ---------------------------------------------------------------------------

/**
 * Badge shown below an assistant message with the double-check result.
 * Shows a spinner while streaming, a green checkmark if verified, or a collapsible correction block.
 */
const VerificationBadge = ({ text, usage, msgKey, streaming }: VerificationBadgeProps): JSX.Element | null => {
  const [open, setOpen] = useState(false);
  const isVerified = text.trim().startsWith("✓");
  const tokenCount = usage ? (usage.input + usage.output) : 0;

  // Still loading
  if (streaming && !text.trim()) {
    return (
      <div className="flex items-center gap-1.5 mt-2.5 px-2.5 py-1.5 border-t border-(--g-border) text-[0.6875rem] text-(--g-text-dim)">
        <svg className="animate-spin" width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="var(--g-green)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        <span>double checking...</span>
      </div>
    );
  }

  if (!text.trim()) return null;

  // Verified — simple inline badge
  if (isVerified) {
    return (
      <div className="flex items-center gap-[0.3125rem] mt-2.5 py-1.5 border-t border-(--g-border) text-[0.6875rem] text-(--g-green)">
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
        <span>{text.trim()}</span>
        {tokenCount > 0 && <span className="text-[0.625rem] text-(--g-text-dim)">({tokenCount.toLocaleString()} tok)</span>}
      </div>
    );
  }

  const handleToggle = () => setOpen(!open);

  // Correction — clickable dropdown
  return (
    <div className="mt-2.5 border-t border-(--g-border)">
      <button
        onClick={handleToggle}
        className="flex items-center gap-[0.3125rem] w-full py-2 border-none bg-transparent cursor-pointer text-[0.6875rem] font-semibold uppercase tracking-[0.5px] text-(--g-method-put-text)"
      >
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 9v4m0 4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
        <span>Corrected by Sonnet</span>
        {tokenCount > 0 && <span className="font-normal text-(--g-text-dim)">{tokenCount.toLocaleString()} tok</span>}
        <span className="flex-1" />
        <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform duration-150 ${open ? "rotate-180" : "rotate-0"}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="pb-1 text-sm leading-[1.6] text-(--g-text-muted)">
          <GregMarkdown text={cleanText(text)} msgKey={`${msgKey}-verify`} />
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// ChatMessage
// ---------------------------------------------------------------------------

/**
 * Single chat message bubble — user messages are right-aligned, assistant messages left-aligned.
 * Shows model name, debug button, endpoint cards, and verification badge for assistant messages.
 */
const DIAGRAM_OPTIONS: Array<{ label: string; type: string; title: string }> = [
  { label: "Flowchart",    type: "flowchart", title: "flowchart TD — data / service flows" },
  { label: "Sequence",     type: "sequence",  title: "sequenceDiagram — step-by-step call chains" },
  { label: "ER Diagram",   type: "er",        title: "erDiagram — entity / object relationships" },
  { label: "State",        type: "state",     title: "stateDiagram-v2 — resource lifecycle states" },
  { label: "Architecture", type: "c4",        title: "C4Context — which services call which" },
];

const CODE_OPTIONS: Array<{ label: string; type: string }> = [
  { label: "cURL",       type: "curl" },
  { label: "Python",     type: "python" },
  { label: "JavaScript", type: "javascript" },
];

// ---------------------------------------------------------------------------
// QuickActionBar — diagram + code dropdowns
// Extracted so its open/close state never causes ChatMessage (and GregMarkdown)
// to re-render. Only this small component re-renders on dropdown toggle.
// ---------------------------------------------------------------------------

interface QuickActionBarProps {
  msgText: string;
  msgIdx: number;
  onQuickAction: (msgIdx: number, action: "diagram" | "code", subType?: string) => void;
  onFork?: (msgIdx: number) => void;
}

const QuickActionBar = memo(({ msgText, msgIdx, onQuickAction, onFork }: QuickActionBarProps): JSX.Element => {
  const [diagramOpen, setDiagramOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const diagramRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<HTMLDivElement>(null);

  // 🔧 perf: memoized — avoids regex on every render, recomputes only when text changes
  const hasDiagram = useMemo(() => /```mermaid/i.test(msgText), [msgText]);
  // Matches code blocks with a programming language tag, but not data/config formats
  // (json, yaml, markdown, xml, html, css, toml, ini, text) or mermaid diagrams.
  const hasCode = useMemo(() => /```(?!mermaid\b)(?!json\b)(?!ya?ml\b)(?!markdown?\b)(?!xml\b)(?!html\b)(?!css\b)(?!toml\b)(?!ini\b)(?!te?xt\b)\w/i.test(msgText), [msgText]);

  // Only gate on whether the content is already present in the reply. The user
  // can always ask for a diagram or code — even when it makes no sense.
  const diagramDisabled = hasDiagram;
  const codeDisabled = hasCode;

  useEffect(() => {
    if (!diagramOpen && !codeOpen) return;
    const handler = (e: MouseEvent) => {
      if (diagramOpen && diagramRef.current && !diagramRef.current.contains(e.target as Node)) setDiagramOpen(false);
      if (codeOpen && codeRef.current && !codeRef.current.contains(e.target as Node)) setCodeOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [diagramOpen, codeOpen]);

  return (
    <div className="flex items-center gap-1.5 mt-2">
      {/* Diagram dropdown */}
      <div ref={diagramRef} className="relative">
        <button
          onClick={() => !diagramDisabled && setDiagramOpen((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs font-medium transition-colors",
            diagramDisabled
              ? "border-(--g-border) text-(--g-text-dim) bg-(--g-surface) opacity-40 cursor-not-allowed"
              : "border-(--g-border) text-(--g-text-muted) bg-(--g-surface) hover:text-(--g-accent) hover:border-(--g-border-accent) hover:bg-(--g-accent-dim)",
          )}
          title={
            hasDiagram
              ? "Diagram already in this response — ask explicitly if you want a different one"
              : "Generate a mermaid diagram from this response"
          }
        >
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
          </svg>
          diagram
          <svg width={8} height={8} viewBox="0 0 10 10" fill="none" className={cn("transition-transform duration-150", diagramOpen ? "rotate-180" : "rotate-0")}>
            <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {diagramOpen && (
          <div className="absolute bottom-full mb-1.5 left-0 z-50 min-w-[10rem] rounded-lg border border-(--g-border) bg-(--g-surface) shadow-lg overflow-hidden py-1">
            {DIAGRAM_OPTIONS.map((opt) => (
              <button
                key={opt.type}
                title={opt.title}
                onClick={() => { setDiagramOpen(false); onQuickAction(msgIdx, "diagram", opt.type); }}
                className="flex w-full items-center px-3 py-1.5 text-xs text-left text-(--g-text-muted) hover:bg-(--g-surface-hover) hover:text-(--g-text) transition-colors"
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Code dropdown */}
      <div ref={codeRef} className="relative">
        <button
          onClick={() => !codeDisabled && setCodeOpen((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs font-medium transition-colors",
            codeDisabled
              ? "border-(--g-border) text-(--g-text-dim) bg-(--g-surface) opacity-40 cursor-not-allowed"
              : "border-(--g-border) text-(--g-text-muted) bg-(--g-surface) hover:text-(--g-accent) hover:border-(--g-border-accent) hover:bg-(--g-accent-dim)",
          )}
          title={
            hasCode
              ? "Code already in this response — ask explicitly if you want a different language"
              : "Generate code from this response"
          }
        >
          <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
          </svg>
          code
          <svg width={8} height={8} viewBox="0 0 10 10" fill="none" className={cn("transition-transform duration-150", codeOpen ? "rotate-180" : "rotate-0")}>
            <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {codeOpen && (
          <div className="absolute bottom-full mb-1.5 left-0 z-50 min-w-[8rem] rounded-lg border border-(--g-border) bg-(--g-surface) shadow-lg overflow-hidden py-1">
            {CODE_OPTIONS.map((opt) => (
              <button
                key={opt.type}
                onClick={() => { setCodeOpen(false); onQuickAction(msgIdx, "code", opt.type); }}
                className="flex w-full items-center px-3 py-1.5 text-xs text-left text-(--g-text-muted) hover:bg-(--g-surface-hover) hover:text-(--g-text) transition-colors"
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Fork — only rendered on Main-tab messages */}
      {onFork && <ForkButton msgIdx={msgIdx} onFork={onFork} />}
    </div>
  );
});

// ---------------------------------------------------------------------------
// ToolCallActivity — inline tool-call feed shown during and after streaming
// ---------------------------------------------------------------------------

interface ToolCallEntry {
  idx: number;
  name: string;
  input: unknown;
  roundInput?: number;
  roundOutput?: number;
  result?: {
    resultLength: number;
    endpointCount: number;
    resultText: string;
  };
}

const extractToolCallEntries = (debug: Record<string, unknown>[]): ToolCallEntry[] => {
  const entries: ToolCallEntry[] = [];
  let lastRound: { input: number; output: number } | undefined;
  for (const e of debug) {
    if (e.event === "round") {
      lastRound = { input: (e.inputTokens as number) ?? 0, output: (e.outputTokens as number) ?? 0 };
    } else if (e.event === "tool_call") {
      entries.push({ idx: entries.length, name: (e.name ?? e.tool) as string, input: e.input, ...(lastRound && { roundInput: lastRound.input, roundOutput: lastRound.output }) });
    } else if (e.event === "tool_result") {
      const name = (e.name ?? e.tool) as string;
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i]!.name === name && !entries[i]!.result) {
          entries[i]!.result = { resultLength: (e.resultLength as number) ?? 0, endpointCount: (e.endpointCount as number) ?? 0, resultText: (e.resultText as string) ?? "" };
          break;
        }
      }
    }
  }
  return entries;
};

// Wrench — used on individual tool call rows
const ToolIcon = ({ size = 11 }: { size?: number }): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);

// Wrench + screwdriver crossed — used on the aggregation header
const ToolGroupIcon = ({ size = 11 }: { size?: number }): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 0 0 4.486-6.336l-3.276 3.277a3.004 3.004 0 0 1-2.25-2.25l3.276-3.276a4.5 4.5 0 0 0-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437 1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008Z" />
  </svg>
);

const ToolCallActivity = memo(({ debug }: { debug: Record<string, unknown>[] }): JSX.Element => {
  const entries = useMemo(() => extractToolCallEntries(debug), [debug]);
  const [open, setOpen] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<Set<number>>(new Set());

  if (entries.length === 0) return <></>;

  const toggle = (idx: number) => setExpandedIdx((prev) => {
    const next = new Set(prev);
    if (next.has(idx)) next.delete(idx); else next.add(idx);
    return next;
  });

  return (
    <div>
      {/* Outer header — matches EndpointDropdown / DocDropdown style */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(collapseBtn, "w-full rounded border border-(--g-method-patch-border) px-2.5 py-1 text-[0.8125rem] text-(--g-method-patch-text) bg-(--g-method-patch-bg)")}
      >
        <span className="flex items-center gap-1.5 flex-1 text-left">
          <ToolGroupIcon size={11} />
          <span className="font-semibold">{entries.length}</span>
          {` tool call${entries.length !== 1 ? "s" : ""}`}
        </span>
        {(() => { const total = entries.reduce((s, e) => s + (e.roundInput ?? 0), 0); return total > 0 ? (
          <span className="flex items-center gap-0.5 font-mono text-[0.6875rem] tabular-nums opacity-70 mr-1.5">
            {Ic.bolt(9)} {total.toLocaleString()}
          </span>
        ) : null; })()}
        <span className={cn("flex transition-transform duration-150", open ? "rotate-180" : "rotate-0")}>
          <svg width={10} height={10} viewBox="0 0 10 10" fill="none">
            <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {/* Animated body */}
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="tree-children flex flex-col gap-[0.1875rem] mt-1 max-h-[18.75rem] overflow-auto">
            {entries.map((entry) => {
              const isExpanded = expandedIdx.has(entry.idx);
              const pending = !entry.result;
              const resultLen = entry.result?.resultLength ?? 0;
              const epCount = entry.result?.endpointCount ?? 0;
              return (
                <div key={entry.idx} className="tree-item">
                <div className="rounded border border-(--g-border) overflow-hidden text-xs">
                  <button
                    onClick={() => toggle(entry.idx)}
                    className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-left bg-(--g-surface) hover:bg-(--g-surface-hover) transition-colors"
                  >
                    <span className="text-(--g-text) shrink-0">{entry.name === "search_apis" ? Ic.server(11) : entry.name === "search_docs" ? Ic.doc(11) : <ToolIcon size={11} />}</span>
                    <span className="font-mono truncate flex-1 text-(--g-text-muted)">
                      {entry.name}
                      {entry.name === "get_doc" && (entry.input as Record<string, unknown>)?.doc_name ? (
                        <span className="text-(--g-text-dim)"> — <i>"{String((entry.input as Record<string, unknown>).doc_name)}" - "{String((entry.input as Record<string, unknown>).heading ?? "")}"</i></span>
                      ) : entry.name === "get_endpoint" && (entry.input as Record<string, unknown>)?.method ? (
                        <span className="text-(--g-text-dim)"> — <i>"{String((entry.input as Record<string, unknown>).method)}"</i> {"->"} <i>"{String((entry.input as Record<string, unknown>).api ?? "")}:/{String((entry.input as Record<string, unknown>).path ?? "")}"</i></span>
                      ) : (entry.input as Record<string, unknown>)?.query ? (
                        <span className="text-(--g-text-dim)"> — <i>"{String((entry.input as Record<string, unknown>).query)}"</i></span>
                      ) : null}
                    </span>
                    {entry.roundInput !== undefined && (
                      <span className="flex items-center gap-0.5 font-mono text-[0.6875rem] text-(--g-text-dim) shrink-0 tabular-nums">
                        {Ic.bolt(9)} {entry.roundInput.toLocaleString()}
                      </span>
                    )}
                    {pending ? (
                      <span className="text-[0.6875rem] text-(--g-text-dim) animate-pulse shrink-0">running…</span>
                    ) : null}
                    <span className={cn("flex shrink-0 ml-0.5 text-(--g-text-dim) transition-transform duration-150", isExpanded ? "rotate-180" : "rotate-0")}>
                      <svg width={8} height={8} viewBox="0 0 10 10" fill="none">
                        <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                  </button>
                  <div
                    className="grid transition-[grid-template-rows] duration-150 ease-out"
                    style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}
                  >
                    <div className="overflow-hidden">
                      <div className="border-t border-(--g-border) px-2.5 py-2 bg-(--g-surface)">
                        <div className="flex gap-2">
                          <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-(--g-text-dim) w-8 shrink-0 pt-px">in</span>
                          <pre className="font-mono text-[0.6875rem] text-(--g-text-muted) whitespace-pre-wrap break-all leading-relaxed min-w-0">{JSON.stringify(entry.input, null, 2)}</pre>
                        </div>
                        {entry.result && entry.result.resultText && (
                          <div className="flex gap-2 mt-1.5">
                            <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-(--g-text-dim) w-8 shrink-0 pt-px">out</span>
                            <pre className="font-mono text-[0.6875rem] text-(--g-text-dim) whitespace-pre-wrap break-all leading-relaxed min-w-0">{entry.result.resultText.slice(0, 600)}{entry.result.resultText.length > 600 ? "…" : ""}</pre>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// ChatMessage
// ---------------------------------------------------------------------------

const ChatMessage = memo(({ msg, i, onSelectEndpoint, onSelectDoc, onShowDebug, onRetry, onQuickAction, onFork, onDelete, loadingGif }: ChatMessageProps): JSX.Element => {
  const p = msg.personality ?? "greg";

  // 🔧 perf: stable style object for user bubble — assistant messages have no bubble
  const userBubbleStyle = useMemo(() => ({
    background: "var(--g-user-bg)",
    border: "1px solid var(--g-border-accent)",
    color: "var(--g-text)",
  }), []);

  return (
    <div className={cn("group/msg flex", msg.role === "user" ? "justify-end" : "w-full")}>
      <div className={msg.role === "user" ? "max-w-[85%]" : "w-full"}>
        {msg.role === "assistant" && (
          <div className="flex items-center justify-between gap-2 mb-1.5">
            {/* Left: name + model + debug */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[0.8125rem] font-medium shrink-0" style={{ color: PERSONALITY_COLOR[p] }}>greg</span>
              {msg.model && (
                <span className="font-mono text-[0.6875rem] text-(--g-text-dim) truncate">{msg.model}</span>
              )}
              {((msg.debug && msg.debug.length > 0) || msg.compactedHistory) && !msg.streaming && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onShowDebug(i)}
                  title="Debug trace"
                  className="shrink-0 opacity-60 hover:opacity-100 hover:text-(--g-accent)"
                >
                  {Ic.bug(12)}
                </Button>
              )}
            </div>
            {/* Right: tool call count + delete */}
            <div className="flex items-center gap-1.5 shrink-0">
              {(msg.debug?.filter((e) => e.event === "tool_call").length ?? 0) > 0 && (
                <span
                  className="flex items-center gap-1 font-mono text-[0.6875rem] text-(--g-text-dim)"
                  title={`${msg.debug!.filter((e) => e.event === "tool_call").length} tool call${msg.debug!.filter((e) => e.event === "tool_call").length !== 1 ? "s" : ""}`}
                >
                  <ToolIcon size={10} />
                  {msg.debug!.filter((e) => e.event === "tool_call").length}
                </span>
              )}
              {!msg.streaming && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => onDelete(i)}
                  title="Delete message"
                  className="opacity-0 group-hover/msg:opacity-60 hover:!opacity-100 text-(--g-danger)"
                >
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6" /><path d="M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </Button>
              )}
            </div>
          </div>
        )}
        <div
          className={cn(
            "text-[0.9375rem] leading-[1.6]",
            msg.role === "user"
              ? "px-4 py-3 rounded-[12px_12px_2px_12px]"
              : "py-2",
          )}
          style={msg.role === "user" ? userBubbleStyle : { color: "var(--g-text)" }}
        >
          {msg.role === "user" ? (
            msg.text
          ) : msg.streaming ? (
            <>
              {loadingGif && !msg.text && (
                <img src={loadingGif} alt="greg thinking" className="block max-h-[180px] max-w-full rounded-lg mb-1.5" />
              )}
              <StreamingText text={msg.text} msgKey={i} {...(msg.personality !== undefined && { personality: msg.personality })} />
            </>
          ) : (
            <GregMarkdown text={cleanText(msg.text)} msgKey={i} />
          )}
          {(msg.verificationText !== undefined || msg.verificationStreaming) && (
            <VerificationBadge text={msg.verificationText ?? ""} {...(msg.verificationUsage !== undefined && { usage: msg.verificationUsage })} msgKey={i} {...(msg.verificationStreaming !== undefined && { streaming: msg.verificationStreaming })} />
          )}
        </div>
        {msg.role === "user" && (
          <div className="flex justify-end gap-0.5 mt-1 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-150">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onRetry(i)}
              title="Retry"
              className="opacity-60 hover:opacity-100 hover:text-(--g-accent)"
            >
              {/* refresh/retry icon */}
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                <path d="M3 3v5h5" />
              </svg>
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => onDelete(i)}
              title="Delete message"
              className="opacity-60 hover:opacity-100 text-(--g-danger)"
            >
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" /><path d="M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </Button>
          </div>
        )}
        {(msg.debug?.some((e) => e.event === "tool_call") || (msg.endpoints && msg.endpoints.length > 0) || (msg.docs && msg.docs.length > 0)) && (
          <div className="flex flex-col gap-1.5 mt-2">
            {msg.debug && msg.debug.some((e) => e.event === "tool_call") && (
              <ToolCallActivity debug={msg.debug} />
            )}
            {msg.endpoints && msg.endpoints.length > 0 && (
              <EndpointDropdown endpoints={msg.endpoints} onSelect={onSelectEndpoint} />
            )}
            {msg.docs && msg.docs.length > 0 && (
              <DocDropdown docs={msg.docs} onSelect={onSelectDoc} />
            )}
          </div>
        )}
        {/* 🔧 perf: extracted to own component — dropdown state changes don't re-render GregMarkdown */}
        {msg.role === "assistant" && !msg.streaming && (
          <QuickActionBar
            msgText={msg.text}
            msgIdx={i}
            onQuickAction={onQuickAction}
            {...(onFork && { onFork })}
          />
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// SwaggerPanel
// ---------------------------------------------------------------------------

/**
 * Side panel showing Swagger UI with an API selector dropdown.
 * Accepts an optional anchor (api + method/path) for navigating to a specific endpoint.
 * Sizing is handled externally by ResizablePanelGroup.
 */
const SwaggerPanel = memo(({ anchor, onClose }: SwaggerPanelProps): JSX.Element => {
  const { apis } = useStore(useShallow((s) => ({ apis: s.apis })));

  const [searchQuery, setSearchQuery] = useState("");
  const [zoom, setZoom] = useState(() => {
    try { const v = parseFloat(localStorage.getItem("greg-panel-zoom") ?? ""); return v > 0 ? v : 0.8; } catch { return 0.8; }
  });
  const defaultApi = anchor?.api ?? apis[0]?.name ?? "";
  const [selectedApi, setSelectedApi] = useState(defaultApi);

  // When a new anchor arrives for a different API, switch to it
  useEffect(() => {
    if (anchor?.api && anchor.api !== selectedApi) setSelectedApi(anchor.api);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor?.api]);

  // Persist zoom
  useEffect(() => {
    try { localStorage.setItem("greg-panel-zoom", String(zoom)); } catch {}
  }, [zoom]);

  // Clear search when API changes
  useEffect(() => { setSearchQuery(""); }, [selectedApi]);


  return (
    <div className="flex flex-col h-full min-w-0">
        {/* Header */}
        <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-(--g-border) bg-(--g-surface)">
          <GroupedApiSelect
            apis={apis}
            value={selectedApi}
            onChange={setSelectedApi}
            height={28}
            fontSize={12}
            minWidth={120}
            color="var(--g-text)"
          />
          <span className="flex-1" />
          <div className="relative flex items-center">
            <span className="absolute left-1.5 text-(--g-text-dim) pointer-events-none">{Ic.search(11)}</span>
            <input
              type="text"
              placeholder="Search…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-6 w-32 rounded border border-(--g-border) bg-(--g-surface) pl-6 pr-5 text-xs text-(--g-text) placeholder:text-(--g-text-dim) focus:border-(--g-accent) focus:outline-none"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute right-1 text-(--g-text-dim) hover:text-(--g-text)">
                {Ic.x(10)}
              </button>
            )}
          </div>
          {/* Zoom controls */}
          <button onClick={() => setZoom((z) => Math.max(0.4, parseFloat((z - 0.1).toFixed(1))))} title="Zoom out" className="flex items-center justify-center w-5 h-5 rounded text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors">
            <svg width={14} height={14} viewBox="0 0 16 16" fill="none">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M4.5 6.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
          <span className="text-[0.625rem] font-mono text-(--g-text-dim) w-7 text-center tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button onClick={() => setZoom((z) => Math.min(1.5, parseFloat((z + 0.1).toFixed(1))))} title="Zoom in" className="flex items-center justify-center w-5 h-5 rounded text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors">
            <svg width={14} height={14} viewBox="0 0 16 16" fill="none">
              <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.3" />
              <path d="M4.5 6.5h4M6.5 4.5v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
          <Button variant="ghost" size="icon-xs" onClick={() => window.open(`/openapi/docs/${encodeURIComponent(selectedApi)}`, "_blank")} title="Open in new tab">
            {Ic.ext()}
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={onClose} title="Close panel">
            {Ic.x(12)}
          </Button>
        </div>

        {/* API Viewer — direct render, no iframe */}
        {selectedApi ? (
          <div className="flex-1 min-h-0 overflow-hidden rounded-b-md border border-t-0 border-(--g-border) bg-(--g-bg)">
            <ApiViewer
              apiName={selectedApi}
              anchor={anchor?.api === selectedApi && anchor.method && anchor.path ? { method: anchor.method, path: anchor.path } : null}
              searchQuery={searchQuery}
              zoom={zoom}
            />
          </div>
        ) : (
          <div className="flex flex-col flex-1 items-center justify-center gap-3 rounded-b-md border border-t-0 border-(--g-border) bg-(--g-surface) text-(--g-text-dim)">
            <div className="flex">{Ic.doc(32)}</div>
            <span className="text-sm">{apis.length > 0 ? "Select an api from the dropdown" : "no apis ingested yet"}</span>
          </div>
        )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// DocsSidePanel
// ---------------------------------------------------------------------------

interface DocsSidePanelProps {
  onClose: () => void;
  anchor?: { docName: string; heading: string } | null;
}

const slugifyHeading = (text: string): string =>
  text.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-");

const findPageWithHeading = (pages: string[], heading: string): number => {
  const slug = slugifyHeading(heading);
  const idx = pages.findIndex((page) =>
    page.split("\n").some((line) => {
      const m = line.match(/^#{1,6}\s+(.+)$/);
      return m ? slugifyHeading(m[1]!) === slug : false;
    }),
  );
  return idx >= 0 ? idx : 0;
};

/**
 * Side panel showing raw markdown documentation with a doc selector dropdown.
 * Sizing is handled externally by ResizablePanelGroup.
 * Large documents are split into pages at H1/H2 boundaries to keep renders fast.
 */
const DocsSidePanel = memo(({ onClose, anchor }: DocsSidePanelProps): JSX.Element => {
  const { docs } = useStore(useShallow((s) => ({ docs: s.docs })));

  const [selectedDoc, setSelectedDoc] = useState(docs[0]?.name ?? "");
  const [pages, setPages] = useState<string[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [zoom, setZoom] = useState(() => {
    try { const v = parseFloat(localStorage.getItem("greg-docs-zoom") ?? ""); return v > 0 ? v : 1.0; } catch { return 1.0; }
  });
  const contentScrollRef = useRef<HTMLDivElement>(null);

  // Persist zoom
  useEffect(() => {
    try { localStorage.setItem("greg-docs-zoom", String(zoom)); } catch {}
  }, [zoom]);

  // Clear search when doc changes
  useEffect(() => { setSearchQuery(""); }, [selectedDoc]);

  // When an anchor arrives for a different doc, switch to it
  useEffect(() => {
    if (anchor?.docName && anchor.docName !== selectedDoc) {
      setSelectedDoc(anchor.docName);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor?.docName]);

  // Fetch content when selection changes
  useEffect(() => {
    const name = selectedDoc || docs[0]?.name;
    if (!name) { setPages([]); setPageIndex(0); return; }
    let cancelled = false;
    setLoading(true);
    getDocContent(name)
      .then((text) => {
        if (!cancelled) {
          setPages(splitIntoPages(text || "(empty document)", PAGE_LIMIT));
          setPageIndex(0);
        }
      })
      .catch((err) => {
        console.error("getDocContent failed:", err);
        if (!cancelled) { setPages([`Error loading document: ${err}`]); setPageIndex(0); }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDoc, docs]);

  // When an anchor heading arrives, jump to the page that contains it
  useEffect(() => {
    if (!anchor?.heading || pages.length === 0) return;
    setPageIndex(findPageWithHeading(pages, anchor.heading));
  }, [anchor?.heading, pages]);

  // Scroll to heading after the page renders
  useEffect(() => {
    if (!anchor?.heading || loading) return;
    const slug = slugifyHeading(anchor.heading);
    const id = requestAnimationFrame(() => {
      const el = document.getElementById(slug);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [pageIndex, anchor, loading]);

  const activeName = selectedDoc || docs[0]?.name ?? "";

  // Search: find pages that contain the query, auto-navigate to first match
  const lowerQuery = searchQuery.toLowerCase();
  const matchingPageIndices = useMemo(
    () => (lowerQuery ? pages.map((p, i) => (p.toLowerCase().includes(lowerQuery) ? i : -1)).filter((i) => i !== -1) : []),
    [pages, lowerQuery],
  );
  const currentMatchPos = lowerQuery ? matchingPageIndices.indexOf(pageIndex) : -1;

  // Jump to first matching page when search changes
  useEffect(() => {
    if (lowerQuery && matchingPageIndices.length > 0 && !matchingPageIndices.includes(pageIndex)) {
      setPageIndex(matchingPageIndices[0]!);
      contentScrollRef.current?.scrollTo({ top: 0 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lowerQuery, pages]);

  const goToMatch = (dir: 1 | -1) => {
    if (matchingPageIndices.length === 0) return;
    const next = currentMatchPos === -1
      ? (dir === 1 ? 0 : matchingPageIndices.length - 1)
      : (currentMatchPos + dir + matchingPageIndices.length) % matchingPageIndices.length;
    setPageIndex(matchingPageIndices[next]!);
    contentScrollRef.current?.scrollTo({ top: 0 });
  };

  return (
    <div className="flex flex-col h-full min-w-0">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-(--g-border) bg-(--g-surface)">
        <GroupedDocSelect
          docs={docs}
          value={activeName}
          onChange={setSelectedDoc}
          height={28}
          fontSize={12}
          minWidth={120}
          color="var(--g-text)"
        />
        <span className="flex-1" />
        {/* Search */}
        <div className="relative flex items-center">
          <span className="absolute left-1.5 text-(--g-text-dim) pointer-events-none">{Ic.search(11)}</span>
          <input
            type="text"
            placeholder="Search…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-6 w-28 rounded border border-(--g-border) bg-(--g-surface) pl-6 pr-5 text-xs text-(--g-text) placeholder:text-(--g-text-dim) focus:border-(--g-accent) focus:outline-none"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-1 text-(--g-text-dim) hover:text-(--g-text)">
              {Ic.x(10)}
            </button>
          )}
        </div>
        {/* Search navigation — shown when query has matches */}
        {lowerQuery && (
          <div className="flex items-center gap-0.5">
            <button onClick={() => goToMatch(-1)} title="Previous match" className="flex items-center justify-center w-4 h-4 rounded text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors disabled:opacity-30" disabled={matchingPageIndices.length === 0}>
              <svg width={10} height={10} viewBox="0 0 16 16" fill="none"><path d="M10 3L6 8l4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <span className="text-[0.5625rem] font-mono text-(--g-text-dim) tabular-nums select-none w-[3.25rem] text-center">
              {matchingPageIndices.length === 0 ? "no match" : `${currentMatchPos + 1}/${matchingPageIndices.length}`}
            </span>
            <button onClick={() => goToMatch(1)} title="Next match" className="flex items-center justify-center w-4 h-4 rounded text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors disabled:opacity-30" disabled={matchingPageIndices.length === 0}>
              <svg width={10} height={10} viewBox="0 0 16 16" fill="none"><path d="M6 3l4 5-4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        )}
        {/* Pagination — hidden when searching or single-page */}
        {!lowerQuery && pages.length > 1 && (
          <>
            <button
              onClick={() => { setPageIndex((i) => Math.max(0, i - 1)); contentScrollRef.current?.scrollTo({ top: 0 }); }}
              disabled={pageIndex === 0}
              title="Previous page"
              className="flex items-center justify-center w-4 h-4 rounded text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors disabled:opacity-30 disabled:cursor-default"
            >
              <svg width={10} height={10} viewBox="0 0 16 16" fill="none">
                <path d="M10 3L6 8l4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <span className="text-[0.5625rem] font-mono text-(--g-text-dim) tabular-nums select-none" style={{ minWidth: "3rem", textAlign: "center" }}>
              {pageIndex + 1}/{pages.length}
            </span>
            <button
              onClick={() => { setPageIndex((i) => Math.min(pages.length - 1, i + 1)); contentScrollRef.current?.scrollTo({ top: 0 }); }}
              disabled={pageIndex === pages.length - 1}
              title="Next page"
              className="flex items-center justify-center w-4 h-4 rounded text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors disabled:opacity-30 disabled:cursor-default"
            >
              <svg width={10} height={10} viewBox="0 0 16 16" fill="none">
                <path d="M6 3l4 5-4 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </>
        )}
        {/* Zoom controls */}
        <button onClick={() => setZoom((z) => Math.max(0.6, parseFloat((z - 0.1).toFixed(1))))} title="Zoom out" className="flex items-center justify-center w-5 h-5 rounded text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors">
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M4.5 6.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
        <span className="text-[0.625rem] font-mono text-(--g-text-dim) w-7 text-center tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <button onClick={() => setZoom((z) => Math.min(1.6, parseFloat((z + 0.1).toFixed(1))))} title="Zoom in" className="flex items-center justify-center w-5 h-5 rounded text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors">
          <svg width={14} height={14} viewBox="0 0 16 16" fill="none">
            <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M4.5 6.5h4M6.5 4.5v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
        {/* Popout */}
        <Button variant="ghost" size="icon-xs" onClick={() => window.open(`${window.location.origin}${window.location.pathname}#docs`, "_blank")} title="Open in new tab">
          {Ic.ext()}
        </Button>
        <Button variant="ghost" size="icon-xs" onClick={onClose} title="Close panel">
          {Ic.x(12)}
        </Button>
      </div>

      {/* Content */}
      {activeName ? (
        <div ref={contentScrollRef} className="flex-1 min-h-0 overflow-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center h-full text-(--g-text-dim)">Loading...</div>
          ) : (
            <div style={{ fontSize: `${zoom}em` }}>
              <MarkdownContent content={pages[pageIndex] ?? ""} className="text-(--g-text-muted) leading-relaxed" />
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col flex-1 items-center justify-center gap-3 text-(--g-text-dim)">
          <div className="flex">{Ic.doc(32)}</div>
          <span className="text-sm">No docs ingested yet</span>
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// GregPage
// ---------------------------------------------------------------------------

/**
 * Main chat page — sidebar with history, message list, input box, and optional detail/debug panels.
 */
const GregPage = (): JSX.Element => {
  const {
    conversations,
    activeConversationId,
    personality,
    chatLoading,
    addChatMessageTo,
    updateLastAssistantIn,
    setPersonality,
    setChatLoading,
    customGregPrompt,
    customExplainerPrompt,
    customProPrompt,
    customCasualPrompt,
    selectedModel,
    selectedProvider,
    setModel,
    chatHistory,
    newChat,
    loadChat,
    renameChat,
    deleteChat,
    activeChatId,
    saveChat,
    setDoubleCheck,
    clearChat,
    setChatMessages,
    addContextBoundary,
    setContextBoundaries,
    forkConversation,
    switchConversation,
    closeConversation,
    renameConversation,
    deleteMessage,
  } = useStore(useShallow((s) => ({
    conversations: s.conversations,
    activeConversationId: s.activeConversationId,
    personality: s.personality,
    chatLoading: s.chatLoading,
    addChatMessageTo: s.addChatMessageTo,
    updateLastAssistantIn: s.updateLastAssistantIn,
    setPersonality: s.setPersonality,
    setChatLoading: s.setChatLoading,
    customGregPrompt: s.customGregPrompt,
    customExplainerPrompt: s.customExplainerPrompt,
    customProPrompt: s.customProPrompt,
    customCasualPrompt: s.customCasualPrompt,
    selectedModel: s.selectedModel,
    selectedProvider: s.selectedProvider,
    setModel: s.setModel,
    chatHistory: s.chatHistory,
    newChat: s.newChat,
    loadChat: s.loadChat,
    renameChat: s.renameChat,
    deleteChat: s.deleteChat,
    activeChatId: s.activeChatId,
    saveChat: s.saveChat,
    setDoubleCheck: s.setDoubleCheck,
    clearChat: s.clearChat,
    setChatMessages: s.setChatMessages,
    addContextBoundary: s.addContextBoundary,
    setContextBoundaries: s.setContextBoundaries,
    forkConversation: s.forkConversation,
    switchConversation: s.switchConversation,
    closeConversation: s.closeConversation,
    renameConversation: s.renameConversation,
    deleteMessage: s.deleteMessage,
  })));

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? conversations[0]!,
    [conversations, activeConversationId],
  );
  const chatMessages = activeConversation.messages;
  const contextBoundaries = activeConversation.contextBoundaries;
  const isMainActive = conversations[0]?.id === activeConversationId;
  const parentConversation = useMemo(
    () => (activeConversation.parentId ? conversations.find((c) => c.id === activeConversation.parentId) ?? null : null),
    [activeConversation.parentId, conversations],
  );
  const isBranchActive = parentConversation !== null && activeConversation.forkIndex !== null;
  const activeChatTitle = useMemo(
    () => chatHistory.find((c) => c.id === activeChatId)?.title ?? null,
    [chatHistory, activeChatId],
  );
  const forkExcerpt = isBranchActive
    ? (parentConversation!.messages[activeConversation.forkIndex!]?.text ?? "")
    : "";
  const tokenCounterMessages = useMemo(() => {
    const lastBoundary = contextBoundaries.length > 0 ? contextBoundaries[contextBoundaries.length - 1]! : 0;
    const local = chatMessages.slice(lastBoundary);
    if (!isBranchActive) return local;
    // Include inherited messages so the token estimate reflects what's actually sent
    const inherited = parentConversation!.messages.slice(0, activeConversation.forkIndex! + 1);
    return [...inherited, ...local];
  }, [chatMessages, contextBoundaries, isBranchActive, parentConversation, activeConversation.forkIndex]);

  const handleCompact = useCallback(() => {
    const msgs = getActiveConversation(useStore.getState()).messages;
    let charsStripped = 0;
    const compacted = msgs.map((m) => {
      const stripped = stripCodeBlocks(m.text);
      charsStripped += Math.max(0, m.text.length - stripped.length);
      return {
        role: m.role,
        text: stripped,
        ...(m.personality !== undefined && { personality: m.personality }),
        ...(m.model !== undefined && { model: m.model }),
        ...(m.usage !== undefined && { usage: m.usage }),
        ...(m.compactedTokens !== undefined && { compactedTokens: m.compactedTokens }),
      };
    }) as ChatMsg[];
    // Tag the last assistant message with approximately how many tokens were stripped
    const approxTokens = Math.ceil(charsStripped / 4);
    if (approxTokens > 0) {
      for (let i = compacted.length - 1; i >= 0; i--) {
        if (compacted[i]!.role === "assistant") {
          compacted[i] = { ...compacted[i]!, compactedTokens: (compacted[i]!.compactedTokens ?? 0) + approxTokens };
          break;
        }
      }
    }
    setChatMessages(compacted);
  }, [setChatMessages]);

  const doubleCheck = false; // disabled
  const isGregLike = personality === "greg";

  const [greetingGif, setGreetingGif] = useState<string | null>(null);
  const [loadingGif, setLoadingGif] = useState<string | null>(null);
  const [greeting, setGreetingText] = useState<string>("");
  const [models, setModels] = useState<Array<{ id: string; name: string; provider: string }>>([]);
  const [sidebarOpen, setSidebarOpen] = useState(() => { try { const v = localStorage.getItem("greg-sidebar-open"); return v === null ? false : v !== "false"; } catch { return false; } });
  const [sidebarWidth, setSidebarWidth] = useState(() => { try { return parseInt(localStorage.getItem("greg-sidebar-width") ?? "") || 260; } catch { return 260; } });
  const sidebarRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const handleSidebarResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const sidebar = sidebarRef.current;
    const toggle = toggleRef.current;
    // Disable CSS transitions during drag for instant feedback
    if (sidebar) sidebar.style.transition = "none";
    if (toggle) toggle.style.transition = "none";
    const onMove = (ev: MouseEvent) => {
      const w = Math.max(180, Math.min(520, startW + ev.clientX - startX));
      // Direct DOM — zero React overhead
      if (sidebar) sidebar.style.width = `${w}px`;
      if (toggle) toggle.style.left = `${w}px`;
    };
    const onUp = (ev: MouseEvent) => {
      const w = Math.max(180, Math.min(520, startW + ev.clientX - startX));
      if (sidebar) sidebar.style.transition = "";
      if (toggle) toggle.style.transition = "";
      setSidebarWidth(w);
      try { localStorage.setItem("greg-sidebar-width", String(w)); } catch {}
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set());
  const toggleChatSelection = (id: string) => setSelectedChatIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const clearChatSelection = () => setSelectedChatIds(new Set());
  const deleteSelectedChats = () => {
    selectedChatIds.forEach((id) => deleteChat(id));
    clearChatSelection();
  };
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [historySearch, setHistorySearch] = useState(() => { try { return localStorage.getItem("greg-history-search") ?? ""; } catch { return ""; } });
  const handleHistorySearch = (q: string) => { setHistorySearch(q); try { localStorage.setItem("greg-history-search", q); } catch {} };
  const [debugMsgIdx, setDebugMsgIdx] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [followUpSuggestions, setFollowUpSuggestions] = useState<string[]>([]);
  const [generatingFollowUps, setGeneratingFollowUps] = useState(false);

  const chatItems = useMemo<ChatListItem[]>(() => {
    const items: ChatListItem[] = [];
    for (let i = 0; i < chatMessages.length; i++) {
      if (contextBoundaries.includes(i)) items.push({ kind: "boundary" });
      items.push({ kind: "message", msg: chatMessages[i]!, msgIndex: i });
    }
    if (contextBoundaries.includes(chatMessages.length)) items.push({ kind: "boundary" });
    return items;
  }, [chatMessages, contextBoundaries]);

  const groupedHistory = useMemo(() => {
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    const startOfYesterday = new Date(startOfToday); startOfYesterday.setDate(startOfToday.getDate() - 1);
    const startOf7Days = new Date(startOfToday); startOf7Days.setDate(startOfToday.getDate() - 7);

    const q = historySearch.toLowerCase();
    const filtered = q ? chatHistory.filter((c) => c.title.toLowerCase().includes(q)) : chatHistory;

    const groups: Array<{ label: string; entries: typeof chatHistory }> = [
      { label: "Today", entries: [] },
      { label: "Yesterday", entries: [] },
      { label: "Previous 7 Days", entries: [] },
      { label: "Older", entries: [] },
    ];

    for (const chat of filtered) {
      if (chat.ts >= startOfToday.getTime()) groups[0]!.entries.push(chat);
      else if (chat.ts >= startOfYesterday.getTime()) groups[1]!.entries.push(chat);
      else if (chat.ts >= startOf7Days.getTime()) groups[2]!.entries.push(chat);
      else groups[3]!.entries.push(chat);
    }

    return groups.filter((g) => g.entries.length > 0);
  }, [chatHistory, historySearch]);

  const [autoCompact, setAutoCompact] = useState(true);
  const autoCompactRef = useRef(autoCompact);
  autoCompactRef.current = autoCompact;
  const [chatZoom, setChatZoom] = useState(1);
  useEffect(() => { try { localStorage.setItem("greg-chat-zoom", String(chatZoom)); } catch {} }, [chatZoom]);
  const [personalityOpen, setPersonalityOpen] = useState(false);
  const personalityRef = useRef<HTMLDivElement>(null);
  const [apisOpen, setApisOpen] = useState(() => { try { return localStorage.getItem("greg-apis-open") === "true"; } catch { return false; } });
  const [docsOpen, setDocsOpen] = useState(() => { try { return localStorage.getItem("greg-docs-open") === "true"; } catch { return false; } });
  const panelOpen = apisOpen || docsOpen;

  // Hydrate localStorage-backed state after mount
  useEffect(() => {
    try {
      const savedCompact = localStorage.getItem("greg-auto-compact");
      if (savedCompact !== null) setAutoCompact(savedCompact !== "false");
      const savedZoom = parseFloat(localStorage.getItem("greg-chat-zoom") ?? "");
      if (savedZoom > 0) setChatZoom(savedZoom);
    } catch {}
  }, []);
  const [panelAnchor, setPanelAnchor] = useState<{ api: string; method?: string; path?: string } | null>(null);
  const [panelDocAnchor, setPanelDocAnchor] = useState<{ docName: string; heading: string } | null>(null);
  const abortRef = useRef<{ controller: AbortController; convId: string } | null>(null);

  useEffect(() => { listModels().then(setModels).catch(() => {}); }, []);
  useEffect(() => { fetchSuggestions().then(setSuggestions).catch(() => {}); }, []);
  useEffect(() => { setGreetingText(getGreeting(personality)); }, [personality]);
  useEffect(() => { try { localStorage.setItem("greg-auto-compact", String(autoCompact)); } catch {} }, [autoCompact]);
  useEffect(() => { try { localStorage.setItem("greg-apis-open", String(apisOpen)); } catch {} }, [apisOpen]);
  useEffect(() => { try { localStorage.setItem("greg-docs-open", String(docsOpen)); } catch {} }, [docsOpen]);
  useEffect(() => { try { localStorage.setItem("greg-sidebar-open", String(sidebarOpen)); } catch {} }, [sidebarOpen]);
  // If provider is ollama and the user has never explicitly set a preference, default auto-compact ON
  useEffect(() => {
    try {
      if (selectedProvider === "ollama" && localStorage.getItem("greg-auto-compact") === null) {
        setAutoCompact(true);
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProvider]);
  useEffect(() => {
    if (!personalityOpen) return;
    const handler = (e: MouseEvent) => {
      if (personalityRef.current && !personalityRef.current.contains(e.target as Node)) setPersonalityOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [personalityOpen]);

  // Resizable panel groups — persistent sizing via useLayoutEffect (before first paint)
  const innerGroupRef = useGroupRef();
  const outerGroupRef = useGroupRef();
  const swaggerPanelRef = usePanelRef();
  const debugPanelRef = usePanelRef();
  // Preferred open-width for each panel — stored in dedicated keys so they survive
  // the panel being closed (rp-greg-* gets [100,0] when closed and can't be trusted).
  const swaggerSizeRef = useRef(25);
  const debugSizeRef = useRef(15);
  useLayoutEffect(() => {
    try {
      const inner = localStorage.getItem("rp-greg-inner");
      if (inner && innerGroupRef.current) innerGroupRef.current.setLayout(JSON.parse(inner) as Layout);
      const swaggerSize = parseFloat(localStorage.getItem("greg-swagger-size") ?? "");
      if (swaggerSize > 0) swaggerSizeRef.current = swaggerSize;
    } catch {}
    try {
      const outer = localStorage.getItem("rp-greg-outer");
      if (outer && outerGroupRef.current) outerGroupRef.current.setLayout(JSON.parse(outer) as Layout);
      const debugSize = parseFloat(localStorage.getItem("greg-debug-size") ?? "");
      if (debugSize > 0) debugSizeRef.current = debugSize;
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Animate swagger panel open/close via resize()/collapse() on state change.
  // ⚠️ resize() treats bare numbers as pixels — pass "25%" to get a percentage.
  // Only resize to swaggerSizeRef if currently collapsed — don't override the user's resized width.
  useEffect(() => {
    const p = swaggerPanelRef.current;
    if (!p) return;
    if (panelOpen) { if (p.isCollapsed()) p.resize(`${swaggerSizeRef.current}%`); }
    else p.collapse();
  }, [panelOpen]);
  useEffect(() => {
    const p = debugPanelRef.current;
    if (!p) return;
    if (debugMsgIdx !== null) {
      // Only set the initial size when the panel is actually collapsed — don't
      // override the user's manually resized width when switching between messages
      if (p.isCollapsed()) p.resize(`${debugSizeRef.current}%`);
    } else {
      p.collapse();
    }
  }, [debugMsgIdx]);
  const fetchGreetingGif = useCallback(() => {
    fetch("/api/greeting-gif").then((r) => r.json()).then((d) => setGreetingGif(d.url ?? null)).catch(() => {});
  }, []);

  // Fetch greeting gif on initial mount
  useEffect(() => { if (isGregLike) fetchGreetingGif(); }, []);

  const handleNewChat = useCallback(() => {
    newChat();
    setGreetingGif(null);
    fetchSuggestions().then(setSuggestions).catch(() => {});
    if (isGregLike) fetchGreetingGif();
  }, [isGregLike, newChat, fetchGreetingGif]);

  const handleSelectEndpoint = useCallback((ep: EndpointCard) => {
    setPanelAnchor({ api: ep.api, method: ep.method, path: ep.path });
    setApisOpen(true);
  }, []);

  const handleSelectDoc = useCallback((dc: DocCard) => {
    setPanelDocAnchor({ docName: dc.doc_name, heading: dc.heading });
    setDocsOpen(true);
  }, []);

  const handleCloseApis = useCallback(() => { setApisOpen(false); setPanelAnchor(null); }, []);
  const handleCloseDocs = useCallback(() => setDocsOpen(false), []);
  const handleCloseDebug = useCallback(() => setDebugMsgIdx(null), []);

  // Keep a ref to the latest handleSend so handleRetry always picks up the
  // current personality/model/provider — not whatever was in scope when the
  // original message was sent. Assigned below, after handleSend is declared.
  const handleSendRef = useRef<((overrideText?: string, baseMessages?: ChatMsg[]) => Promise<void>) | null>(null);

  // Refs so handleRetry / handleQuickAction keep a stable identity across renders —
  // reading chatMessages / chatLoading / contextBoundaries directly would invalidate
  // the ChatMessage memo on every streaming token.
  const handlerDepsRef = useRef({ chatLoading, chatMessages, contextBoundaries });
  handlerDepsRef.current = { chatLoading, chatMessages, contextBoundaries };

  const handleRetry = useCallback((msgIdx: number): void => {
    const { chatLoading: loading, chatMessages: msgs, contextBoundaries: bounds } = handlerDepsRef.current;
    if (loading) return;
    const msg = msgs[msgIdx];
    if (!msg || msg.role !== "user") return;
    const trimmed = msgs.slice(0, msgIdx);
    setChatMessages(trimmed);
    setFollowUpSuggestions([]);
    // Drop boundaries beyond the retry point; keep those at or before it
    setContextBoundaries(bounds.filter((b) => b <= msgIdx));
    // Pass the trimmed array directly so handleSend uses it for history,
    // not the stale closure value that hasn't updated yet
    handleSendRef.current?.(msg.text, trimmed);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const DIAGRAM_PROMPTS: Record<string, string> = {
    flowchart: "show the above as a mermaid flowchart diagram (flowchart TD). Include the actual endpoint methods and paths (e.g. GET /users/{id}) as node labels — do not use generic descriptions.",
    sequence:  "show the above as a mermaid sequence diagram (sequenceDiagram). Label each arrow with the actual HTTP method and path (e.g. POST /orders) — do not use generic descriptions.",
    er:        "show the above as a mermaid ER diagram (erDiagram). Use the actual resource names from the API paths and include the key fields from request/response schemas.",
    state:     "show the above as a mermaid state diagram (stateDiagram-v2). Label transitions with the actual endpoint that triggers each state change (e.g. PUT /orders/{id}/cancel).",
    c4:        "show the above as a mermaid C4 context diagram (C4Context). Label each relationship with the actual endpoint paths being called.",
  };

  const CODE_PROMPTS: Record<string, string> = {
    curl:       "show me cURL for the above",
    python:     "show me Python for the above",
    javascript: "show me JavaScript (no TypeScript types) for the above",
  };

  const handleQuickAction = useCallback((msgIdx: number, action: "diagram" | "code", subType?: string): void => {
    const { chatLoading: loading, chatMessages: msgs } = handlerDepsRef.current;
    if (loading) return;
    const prompt = action === "diagram"
      ? (DIAGRAM_PROMPTS[subType ?? "flowchart"] ?? DIAGRAM_PROMPTS["flowchart"]!)
      : (CODE_PROMPTS[subType ?? "javascript"] ?? CODE_PROMPTS["javascript"]!);
    // Context trimmed to just up to this message so the AI knows exactly what to diagram/code.
    const context = msgs.slice(0, msgIdx + 1);
    handleSendRef.current?.(prompt, context);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refs so handleRefreshFollowUps keeps a stable identity across renders — reading chatMessages
  // directly would invalidate the memo on every streaming token.
  const refreshDepsRef = useRef({ chatMessages, generatingFollowUps, selectedModel, selectedProvider });
  refreshDepsRef.current = { chatMessages, generatingFollowUps, selectedModel, selectedProvider };
  const handleRefreshFollowUps = useCallback((): void => {
    const { chatMessages: msgs, generatingFollowUps: gen, selectedModel: model, selectedProvider: provider } = refreshDepsRef.current;
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
    if (!lastUser || !lastAssistant || gen) return;
    setGeneratingFollowUps(true);
    setFollowUpSuggestions([]);
    const opts: { model?: string; provider?: "anthropic" | "ollama" } = {
      ...(model ? { model } : {}),
      ...(provider === "ollama" || provider === "anthropic" ? { provider: provider as "ollama" | "anthropic" } : {}),
    };
    generateFollowUpSuggestions(lastUser.text, lastAssistant.text, opts)
      .then((s) => { setFollowUpSuggestions(s); setGeneratingFollowUps(false); })
      .catch(() => { setGeneratingFollowUps(false); });
  }, []);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [userScrolled, setUserScrolled] = useState(false);
  const userScrolledRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    userScrolledRef.current = false;
    setUserScrolled(false);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    userScrolledRef.current = !atBottom;
    setUserScrolled(!atBottom);
  }, []);

  // Jump to bottom whenever the active conversation changes (tab switch / URL restore).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    userScrolledRef.current = false;
    setUserScrolled(false);
  }, [activeConversationId]);

  // Auto-scroll during streaming and on new messages, unless user has scrolled up.
  useEffect(() => {
    if (userScrolledRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages]);

  const handleFork = useCallback((msgIdx: number): void => {
    const id = forkConversation(msgIdx);
    if (id) { setFollowUpSuggestions([]); }
  }, [forkConversation]);

  const handleSwitchTab = useCallback((id: string): void => {
    switchConversation(id);
    setFollowUpSuggestions([]);
  }, [switchConversation]);

  const handleDelete = useCallback((msgIdx: number): void => {
    deleteMessage(msgIdx);
  }, [deleteMessage]);

  const handleCloseTab = useCallback((id: string): void => {
    // If an in-flight stream targets this conversation, abort it — otherwise
    // it would keep hitting the server with no UI to write to.
    const pending = abortRef.current;
    if (pending && pending.convId === id) {
      pending.controller.abort();
      abortRef.current = null;
      setChatLoading(false);
    }
    closeConversation(id);
  }, [closeConversation, setChatLoading]);

  const handleSend = async (overrideText?: string, baseMessages?: ChatMsg[]): Promise<void> => {
    const text = (overrideText ?? inputRef.current?.value ?? "").trim();
    if (!text || chatLoading) return;

    if (inputRef.current) { inputRef.current.value = ""; inputRef.current.style.height = "auto"; }

    // Slash commands
    if (text === "/clear") {
      // Keep messages visible but record a new boundary so subsequent
      // sends only include messages after this point
      addContextBoundary();
      setFollowUpSuggestions([]);
      setGeneratingFollowUps(false);
      return;
    }
    setUserScrolled(false);
    setFollowUpSuggestions([]);
    setGeneratingFollowUps(false);
    setLoadingGif(null);
    // Pin the conversation this stream belongs to — if the user switches tabs
    // mid-generation, tokens keep writing to the originating convo.
    const targetConvId = activeConversationId;
    addChatMessageTo(targetConvId, { role: "user", text, personality });
    addChatMessageTo(targetConvId, { role: "assistant", text: "", streaming: true, ...(selectedModel && { model: selectedModel }), personality });
    setChatLoading(true);
    if (isGregLike) {
      fetch("/api/greeting-gif").then((r) => r.json()).then((d) => setLoadingGif(d.url ?? null)).catch(() => {});
    }

    // Auto-compact strips code blocks from prior assistant messages in the
    // outgoing request only — state still holds the full text so the UI keeps
    // rendering code. This saves tokens without hiding content from the user.
    // baseMessages is supplied by handleRetry so we use the already-sliced array
    // rather than the stale closure value. For normal sends, slice from the last
    // context boundary so /clear'd messages aren't included in the API history.
    const lastBoundary = contextBoundaries.length > 0 ? contextBoundaries[contextBoundaries.length - 1]! : 0;
    const localBase = baseMessages ?? chatMessages.slice(lastBoundary);
    // Branch: prepend inherited messages from parent up to the fork point.
    // Always runs on a branch — retries and quick-actions pass baseMessages
    // scoped to the branch's own messages, so the parent context would
    // otherwise be dropped and the model loses the endpoints/schemas that
    // were established before the fork.
    const inherited = isBranchActive
      ? parentConversation!.messages.slice(0, activeConversation.forkIndex! + 1)
      : [];
    const historyBase = [...inherited, ...localBase];
    let autoCompactedChars = 0;
    const history = [
      ...historyBase.map((m) => {
        if (m.role === "assistant" && autoCompactRef.current) {
          const compacted = compactMessage(m.text);
          autoCompactedChars += Math.max(0, m.text.length - compacted.length);
          return { role: m.role, content: compacted };
        }
        return { role: m.role, content: m.text };
      }),
      { role: "user" as const, content: text },
    ];
    const autoCompactedTokens = Math.ceil(autoCompactedChars / 4);

    let accumulated = "";
    let verificationText = "";
    let doneModel: string | undefined;
    let doneUsage: { input: number; output: number; toolCalls: number } | undefined;
    let doneVerificationUsage: { input: number; output: number } | undefined;
    const endpointMap = new Map<string, EndpointCard>();
    const docCardMap = new Map<string, DocCard>();
    const citedDocNames = new Set<string>();
    const debugLog: Record<string, unknown>[] = [];

    // Batch text updates to one per animation frame to avoid thrashing the reconciler
    let rafPending = false;
    const flushText = () => {
      updateLastAssistantIn(targetConvId, (m) => ({ ...m, text: accumulated }));
      rafPending = false;
    };

    try {
      const customPrompt = personality === "greg" ? customGregPrompt : personality === "explanatory" ? customExplainerPrompt : personality === "casual" ? customCasualPrompt : customProPrompt;
      const abort = new AbortController();
      abortRef.current = { controller: abort, convId: targetConvId };
      for await (const event of streamChat(
        history,
        personality,
        {
          ...(customPrompt ? { systemPrompt: customPrompt } : {}),
          ...(selectedModel ? { model: selectedModel } : {}),
          ...(selectedProvider ? { provider: selectedProvider } : {}),
          ...(doubleCheck ? { doubleCheck } : {}),
        },
        abort.signal,
      )) {
        switch (event.type) {
          case "text":
            accumulated += event.text ?? "";
            if (!rafPending) { rafPending = true; requestAnimationFrame(flushText); }
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
          case "docs":
            // Deduplicate by doc_name+heading, keep highest score
            for (const dc of event.docCards ?? []) {
              const key = `${dc.doc_name}:${dc.heading}`;
              const existing = docCardMap.get(key);
              if (!existing || (dc.score ?? 0) > (existing.score ?? 0)) {
                docCardMap.set(key, dc);
              }
            }
            break;
          case "docrefs": {
            // Doc names the LLM explicitly cited — used post-stream to filter doc cards.
            const names = (event as { docNames?: string[] }).docNames ?? [];
            for (const name of names) citedDocNames.add(name);
            break;
          }
          case "followups": {
            // Inline follow-ups emitted by the main LLM alongside the response.
            // Replaces the prior post-stream generateFollowUpSuggestions call.
            const list = event.followups ?? [];
            if (list.length > 0) {
              setFollowUpSuggestions(list);
              setGeneratingFollowUps(false);
            }
            break;
          }
          case "verification_text":
            // Arrives as one complete message (not streamed)
            verificationText = event.text ?? "";
            updateLastAssistantIn(targetConvId, (m) => ({ ...m, verificationText, verificationStreaming: false }));
            break;
          case "error":
            accumulated += `\n[error: ${event.error}]`;
            updateLastAssistantIn(targetConvId, (m) => ({ ...m, text: accumulated }));
            break;
          case "debug":
            debugLog.push(event as unknown as Record<string, unknown>);
            // Push tool activity events immediately so the streaming UI can show them
            if (event.event === "tool_call" || event.event === "tool_result" || event.event === "round") {
              updateLastAssistantIn(targetConvId, (m) => ({
                ...m,
                debug: [...(m.debug ?? []), event as unknown as Record<string, unknown>],
              }));
            }
            if (event.event === "verification_start") {
              // Greg is done, verification is starting — render Greg's markdown, show checking indicator
              const eps = relevantEndpoints([...endpointMap.values()]);
              updateLastAssistantIn(targetConvId, (m) => ({
                ...m,
                streaming: false,
                ...(eps.length > 0 ? { endpoints: eps } : {}),
                verificationStreaming: true,
                verificationText: "",
              }));
            }
            break;
          case "done":
            doneModel = event.model;
            doneUsage = event.usage ? { ...event.usage, toolCalls: (event.usage as { toolCalls?: number }).toolCalls ?? 0 } : undefined;
            doneVerificationUsage = (event as { verificationUsage?: { input: number; output: number } }).verificationUsage;
            break;
        }
      }
    } catch (err) {
      accumulated += `\n[connection error]`;
      updateLastAssistantIn(targetConvId, (m) => ({ ...m, text: accumulated }));
    }

    abortRef.current = null;
    const dedupedEndpoints = [...endpointMap.values()];
    // Filter doc cards to only those the LLM explicitly cited via <docrefs>.
    // If the tag was omitted (no docs used, or LLM forgot), fall back to a
    // strict score threshold so at least the highest-confidence results show.
    const allDocCards = citedDocNames.size > 0
      ? [...docCardMap.values()].filter((dc) => citedDocNames.has(dc.doc_name))
      : [...docCardMap.values()].filter((dc) => (dc.score ?? 0) >= 0.8);

    // Scan response text for inline route mentions (e.g. `GET /devices/{id}/commands`).
    // Anything mentioned directly in the assistant's text is promoted to the top of the card list.
    const INLINE_ROUTE_RE = /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/[^\s`'")\]\n]+)/g;
    const mentionedKeys = new Set<string>();
    let rm: RegExpExecArray | null;
    while ((rm = INLINE_ROUTE_RE.exec(accumulated)) !== null) {
      mentionedKeys.add(`${rm[1]}:${rm[2]}`);
    }

    // Routes mentioned inline but NOT already returned by tools — look them up.
    const seenKeys = new Set(dedupedEndpoints.map((e) => `${e.method}:${e.path}`));
    const routesToLookup: Array<{ method: string; path: string }> = [];
    for (const key of mentionedKeys) {
      if (!seenKeys.has(key)) {
        const [method, path] = key.split(":", 2) as [string, string];
        routesToLookup.push({ method, path });
      }
    }
    const lookedUp: EndpointCard[] = routesToLookup.length > 0
      ? (await Promise.all(routesToLookup.map((r) => getEndpoint(r.method, r.path).catch(() => null))))
          .filter(Boolean)
          .map((r) => ({ method: r!.method, path: r!.path, api: r!.api, description: r!.description, score: r!.score, full_text: r!.full_text, response_schema: r!.response_schema, ...(r!.warnings ? { warnings: r!.warnings } : {}) }))
      : [];
    // Only show endpoints that were explicitly mentioned in the response text
    // (bumped to score=1) or fetched via get_endpoint (already score=1).
    // Search results that the LLM retrieved but never cited are excluded.
    const combined = [
      ...dedupedEndpoints
        .map((ep) => mentionedKeys.has(`${ep.method}:${ep.path}`) ? { ...ep, score: 1 } : ep)
        .filter((ep) => (ep.score ?? 0) >= 1),
      ...lookedUp,
    ];
    const allEndpoints = combined;

    updateLastAssistantIn(targetConvId, (m) => ({
      ...m,
      // Ensure the final accumulated text lands in state — a pending RAF flush
      // may not have fired before saveChat() persists the message.
      text: accumulated,
      streaming: false,
      verificationStreaming: false,
      ...(allEndpoints.length > 0 ? { endpoints: allEndpoints } : {}),
      ...(allDocCards.length > 0 ? { docs: allDocCards } : {}),
      ...(doneModel !== undefined && { model: doneModel }),
      ...(doneUsage !== undefined && { usage: doneUsage }),
      ...(doneVerificationUsage !== undefined && { verificationUsage: doneVerificationUsage }),
      ...(verificationText ? { verificationText } : {}),
      ...(debugLog.length > 0 ? { debug: debugLog } : {}),
      // Always record compaction data when auto-compact is on so the debug panel can display the status
      ...(autoCompactRef.current ? { compactedTokens: autoCompactedTokens, compactedHistory: history } : {}),
    }));

    saveChat();
    setChatLoading(false);
    // Follow-ups are emitted inline by the LLM via the "followups" SSE event
    // during the stream — the switch case above has already populated state
    // if the tag arrived. Nothing to do here.
  };

  // Refresh the ref every render so handleRetry always invokes the
  // latest handleSend closure (with current personality/model/provider).
  handleSendRef.current = handleSend;

  // Stable identity — routed through handleSendRef so renders don't recreate it.
  const handleSuggestion = useCallback((q: string): void => {
    handleSendRef.current?.(q);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const hasChatMessages = chatMessages.length > 0;

  return (
    <div className="flex h-[calc(100%-2.75rem)]">
      {/* History toggle badge — fixed, slides with sidebar */}
      <button
        ref={toggleRef}
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed z-30 flex items-center justify-center px-3 py-3 rounded-r-lg border border-l-0 border-(--g-border) bg-(--g-surface) shadow-sm hover:bg-(--g-surface-hover) -translate-y-1/2 transition-[left,color] duration-200"
        style={{ top: "4.25rem", left: sidebarOpen ? sidebarWidth : 0, color: sidebarOpen ? "var(--g-accent)" : "var(--g-text-dim)" }}
        title={sidebarOpen ? "Close history" : "Open history"}
      >
        {Ic.clock(18)}
      </button>

      {/* History sidebar — width controlled by drag, visibility by sidebarOpen */}
      <div
        ref={sidebarRef}
        className="relative shrink-0 overflow-hidden border-r border-(--g-border) bg-(--g-surface) transition-[width] duration-200"
        style={{ width: sidebarOpen ? sidebarWidth : 0 }}
      >
        <div className="flex flex-col w-full h-full overflow-hidden">
          {/* Header */}
          <div className="flex items-center px-3 py-[0.6875rem] border-b border-(--g-border) shrink-0 gap-1.5">
            {selectedChatIds.size > 0 ? (
              <>
                <span className="flex-1 text-[0.625rem] font-medium text-(--g-text-dim)">{selectedChatIds.size} selected</span>
                <button
                  onClick={deleteSelectedChats}
                  title="Delete selected"
                  className="flex items-center gap-1 h-6 px-2 rounded-[6px] text-[0.625rem] font-medium text-red-400 border border-red-400/30 hover:bg-red-400/10 transition-colors duration-150"
                >
                  {Ic.x(10)} Delete
                </button>
                <button
                  onClick={clearChatSelection}
                  title="Clear selection"
                  className="flex items-center justify-center w-6 h-6 rounded-[6px] border border-(--g-border-hover) text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors duration-150"
                >
                  {Ic.x(12)}
                </button>
              </>
            ) : (
              <>
                <span className="flex-1 text-[0.625rem] font-medium uppercase tracking-[0.1em] text-(--g-text-dim)">Chats</span>
                <button
                  onClick={handleNewChat}
                  title="New chat"
                  className="flex items-center justify-center w-6 h-6 rounded-[6px] border border-(--g-border-hover) text-(--g-text-dim) hover:border-(--g-border-hover) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors duration-150"
                >
                  {Ic.plus(14)}
                </button>
              </>
            )}
          </div>

          {/* Search */}
          <div className="px-2.5 py-2 shrink-0">
            <div className="relative">
              <span className="absolute left-[9px] top-1/2 -translate-y-1/2 text-(--g-text-dim) pointer-events-none">
                {Ic.search(13)}
              </span>
              <input
                type="text"
                value={historySearch}
                onChange={(e) => handleHistorySearch(e.target.value)}
                placeholder="Search chats…"
                className="w-full h-[30px] pl-[30px] pr-2.5 rounded-[6px] text-[0.75rem] bg-(--g-surface) border border-(--g-border) text-(--g-text) placeholder:text-(--g-text-dim) outline-none focus:border-(--g-border-hover) focus:bg-(--g-surface-hover) transition-colors"
              />
            </div>
          </div>

          {/* Grouped list */}
          <div className="flex-1 overflow-y-auto px-1.5 pb-3 [scrollbar-width:thin] [scrollbar-color:var(--g-surface-hover)_transparent]">
            {groupedHistory.length === 0 && (
              <p className="px-2 pt-6 text-center text-[0.6875rem] tracking-[0.02em] text-(--g-text-dim)">
                {historySearch ? "No chats match your search" : "No chats yet"}
              </p>
            )}
            {groupedHistory.map((group) => (
              <div key={group.label}>
                <div className="px-1 pt-3 pb-[5px] text-[0.625rem] font-medium uppercase tracking-[0.08em] text-(--g-text-dim)">
                  {group.label}
                </div>
                {group.entries.map((chat) => {
                  const isActive = chat.id === useStore.getState().activeChatId;
                  const relTime = (() => {
                    const diff = Date.now() - chat.ts;
                    const mins = Math.floor(diff / 60000);
                    if (mins < 1) return "just now";
                    if (mins < 60) return `${mins}m ago`;
                    const hrs = Math.floor(mins / 60);
                    if (hrs < 24) return `${hrs}h ago`;
                    const days = Math.floor(hrs / 24);
                    if (days === 1) return "Yesterday";
                    if (days < 7) return `${days}d ago`;
                    return new Date(chat.ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
                  })();
                  const isSelected = selectedChatIds.has(chat.id);
                  const hasSelection = selectedChatIds.size > 0;
                  return (
                    <div
                      key={chat.id}
                      onClick={() => {
                        if (hasSelection) { toggleChatSelection(chat.id); return; }
                        loadChat(chat.id); setFollowUpSuggestions([]);
                      }}
                      className={cn(
                        "group/item relative flex items-center gap-2 mb-px pl-1.5 pr-2 py-[7px] rounded-[9px] border cursor-pointer transition-colors duration-100",
                        isSelected
                          ? "bg-(--g-surface) border-(--g-accent)/40"
                          : isActive
                            ? "bg-(--g-surface) border-(--g-border-hover)"
                            : "border-transparent hover:bg-(--g-surface) hover:border-(--g-border-hover)",
                      )}
                    >
                      {/* Checkbox */}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleChatSelection(chat.id); }}
                        className={cn(
                          "shrink-0 flex items-center justify-center w-4 h-4 rounded-[4px] border transition-all duration-100",
                          isSelected
                            ? "bg-(--g-accent) border-(--g-accent)"
                            : "border-(--g-border-hover) opacity-0 group-hover/item:opacity-100",
                        )}
                      >
                        {isSelected && (
                          <svg width={9} height={9} viewBox="0 0 10 10" fill="none">
                            <path d="M2 5l2.5 2.5L8 3" stroke="var(--g-bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </button>

                      {/* Text */}
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                        {/* Active left bar */}
                        {isActive && !isSelected && (
                          <span className="absolute left-0 top-[20%] bottom-[20%] w-0.5 rounded-sm bg-(--g-accent)" />
                        )}
                        <span className="truncate text-[0.75rem] text-(--g-text) leading-[1.35] pr-6">{chat.title}</span>
                        <span className="text-[0.625rem] tracking-[0.02em] text-(--g-text-dim)">{relTime}</span>
                      </div>

                      {/* Hover actions (hidden when in selection mode) */}
                      {!hasSelection && (
                        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 hidden group-hover/item:flex items-center gap-[3px] bg-(--g-surface-hover) border border-(--g-border) rounded-[6px] p-0.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }}
                            className="flex items-center justify-center w-[22px] h-[22px] rounded text-(--g-text-dim) hover:text-red-400 hover:bg-(--g-surface) transition-colors"
                            title="Delete"
                          >
                            {Ic.x(11)}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        {/* Drag handle — sits on top of the border-r */}
        <div
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-10 hover:bg-(--g-accent) transition-colors duration-150 opacity-0 hover:opacity-40"
          onMouseDown={handleSidebarResizeStart}
        />
      </div>

      {/* Main area: chat + swagger + debug — all resizable */}
      <ResizablePanelGroup groupRef={outerGroupRef} onLayoutChanged={(l) => { try { localStorage.setItem("rp-greg-outer", JSON.stringify(l)); if (l[1] > 0) { debugSizeRef.current = l[1]; localStorage.setItem("greg-debug-size", String(l[1])); } } catch {} }} className="flex flex-1 min-w-0">
        {/* Inner group: chat + swagger */}
        <ResizablePanel id="main" minSize={20}>
          <ResizablePanelGroup groupRef={innerGroupRef} onLayoutChanged={(l) => { try { localStorage.setItem("rp-greg-inner", JSON.stringify(l)); if (l[1] > 0) { swaggerSizeRef.current = l[1]; localStorage.setItem("greg-swagger-size", String(l[1])); } } catch {} }}>
            <ResizablePanel id="chat" defaultSize={75} minSize={20}>
        {/* Chat column */}
        <div
          className="flex flex-col h-full min-w-0 px-6 pt-2 pb-5"
          style={chatZoom !== 1 ? { zoom: chatZoom } : undefined}
        >
        {/* Chat title bar */}
        {activeChatTitle !== null && (
          <div className={cn("flex items-center gap-2 mb-1 min-w-0 group/title transition-[padding] duration-200", !sidebarOpen && "pl-10")}>
            {renamingTitle ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const t = renameValue.trim();
                    if (t && activeChatId) renameChat(activeChatId, t);
                    setRenamingTitle(false);
                  } else if (e.key === "Escape") {
                    setRenamingTitle(false);
                  }
                }}
                onBlur={() => {
                  const t = renameValue.trim();
                  if (t && activeChatId) renameChat(activeChatId, t);
                  setRenamingTitle(false);
                }}
                className="flex-1 min-w-0 bg-transparent border-b border-(--g-accent) text-[0.8125rem] font-medium text-(--g-text) outline-none py-0.5"
              />
            ) : (
              <button
                onClick={() => { setRenameValue(activeChatTitle); setRenamingTitle(true); setTimeout(() => { renameInputRef.current?.select(); }, 0); }}
                className="flex-1 min-w-0 text-left text-[0.8125rem] font-medium text-(--g-text-dim) truncate hover:text-(--g-text) transition-colors"
                title="Click to rename"
              >
                {activeChatTitle}
              </button>
            )}
            {!renamingTitle && (
              <button
                onClick={() => { setRenameValue(activeChatTitle); setRenamingTitle(true); setTimeout(() => { renameInputRef.current?.select(); }, 0); }}
                className="shrink-0 opacity-0 group-hover/title:opacity-60 hover:!opacity-100 text-(--g-text-dim) transition-opacity"
                title="Rename chat"
              >
                {Ic.pencil(13)}
              </button>
            )}
          </div>
        )}

        {/* Messages + detail panel */}
        <div className="flex flex-1 gap-5 min-h-0">
          {/* Messages */}
          <div className="relative flex flex-col flex-1 min-w-0">
            {/* Top toolbar: full-width, overlays the messages, zoom + clear on the right */}
            <div
              className="absolute top-0 left-0 right-0 z-20 flex items-center justify-end gap-2 px-3 h-10"
              style={{
                background: "linear-gradient(to bottom, var(--g-bg) 0%, var(--g-bg) 65%, transparent 100%)",
              }}
            >
              <button
                onClick={() => setChatZoom((z) => Math.max(0.6, parseFloat((z - 0.1).toFixed(1))))}
                title="Zoom out"
                className="flex items-center justify-center w-8 h-8 rounded-md text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors"
              >
                <svg width={18} height={18} viewBox="0 0 16 16" fill="none">
                  <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M4.5 6.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>
              <span className="text-xs font-mono text-(--g-text-dim) w-9 text-center tabular-nums">
                {Math.round(chatZoom * 100)}%
              </span>
              <button
                onClick={() => setChatZoom((z) => Math.min(1.6, parseFloat((z + 0.1).toFixed(1))))}
                title="Zoom in"
                className="flex items-center justify-center w-8 h-8 rounded-md text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors"
              >
                <svg width={18} height={18} viewBox="0 0 16 16" fill="none">
                  <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M4.5 6.5h4M6.5 4.5v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>
              {chatMessages.length > 0 && (
                <button
                  onClick={() => { clearChat(); setFollowUpSuggestions([]); }}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-md text-sm text-red-400 hover:text-red-300 hover:bg-(--g-surface-hover) transition-colors"
                  title="Clear chat"
                >
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                  Clear
                </button>
              )}
            </div>
            {conversations.length > 1 && (
              <div className="mt-10 shrink-0">
                <TabBar
                  conversations={conversations}
                  activeConversationId={activeConversationId}
                  onSwitch={handleSwitchTab}
                  onClose={handleCloseTab}
                  onRename={renameConversation}
                />
              </div>
            )}
            <div
              ref={scrollRef}
              className="flex-1 min-h-0 overflow-y-auto"
              onScroll={handleScroll}
            >
              {/* Greeting / fork context header */}
              {isBranchActive ? (
                <ForkContext parentName={parentConversation?.name ?? "Main"} excerpt={forkExcerpt} />
              ) : (
                <div className={cn("flex flex-col items-center gap-4 text-(--g-text-dim) px-6", hasChatMessages ? "pt-3 pb-2" : "min-h-full justify-center")}>
                  <img src="https://media0.giphy.com/media/v1.Y2lkPWM4MWI4ODBkMnl2cmJ4ODFic3pwcjNqdGx4eTd0NWZqeHR1Z21jZXk0dmc2NzByeiZlcD12MV9zdGlja2Vyc19zZWFyY2gmY3Q9cw/j0HjChGV0J44KrrlGv/giphy.gif" alt="greg" className="max-h-[45rem] rounded-xl" />
                  <span className="text-lg">{greeting}</span>
                  {suggestions.length > 0 && !hasChatMessages && (
                    <div className="flex flex-wrap justify-center gap-2 max-w-[35rem]">
                      {suggestions.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => handleSuggestion(s)}
                          className="px-3.5 py-1.5 rounded-[1.25rem] border border-(--g-border) bg-(--g-surface) cursor-pointer text-[0.8125rem] text-(--g-text-muted) transition-[border-color,color] duration-150 hover:border-(--g-border-accent) hover:text-(--g-text)"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Messages */}
              {chatItems.map((item, index) => {
                if (item.kind === "boundary") {
                  return (
                    <div key={`b-${index}`} className="flex items-center gap-2 my-1 w-full max-w-[1000px] mx-auto px-6">
                      <div className="flex-1 h-px bg-(--g-border)" />
                      <span className="text-[0.6875rem] text-(--g-text-dim) select-none">context cleared</span>
                      <div className="flex-1 h-px bg-(--g-border)" />
                    </div>
                  );
                }
                return (
                  <div key={`m-${item.msgIndex}`} className="w-full max-w-[1000px] mx-auto px-6 py-1.5 [content-visibility:auto] [contain-intrinsic-size:0_auto]">
                    <ChatMessage
                      msg={item.msg}
                      i={item.msgIndex}
                      onSelectEndpoint={handleSelectEndpoint}
                      onSelectDoc={handleSelectDoc}
                      onShowDebug={setDebugMsgIdx}
                      onRetry={handleRetry}
                      onQuickAction={handleQuickAction}
                      onDelete={handleDelete}
                      {...(isMainActive && { onFork: handleFork })}
                      loadingGif={item.msg.streaming ? loadingGif : null}
                    />
                  </div>
                );
              })}

              {/* Follow-up suggestions — inside the scroll container so they
                  don't resize the scrollable area and cause position jumps. */}
              {(generatingFollowUps || followUpSuggestions.length > 0) && (
                <div className="w-full max-w-[1000px] mx-auto px-6 pt-3 pb-2">
                  {generatingFollowUps && followUpSuggestions.length === 0 && (
                    <span className="ml-0.5 text-[0.6875rem] text-(--g-text-dim) animate-pulse">generating follow-ups…</span>
                  )}
                  {followUpSuggestions.length > 0 && (
                    <div className="flex flex-col gap-1.5 ml-0.5">
                      {followUpSuggestions.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => handleSuggestion(s)}
                          className="self-start max-w-[70%] px-3 py-1 rounded-[1.25rem] border border-(--g-border) bg-(--g-surface) cursor-pointer text-left text-[0.75rem] text-(--g-text-muted) transition-[border-color,color] duration-150 hover:border-(--g-border-accent) hover:text-(--g-text)"
                        >
                          {s}
                        </button>
                      ))}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={handleRefreshFollowUps}
                        title="Refresh follow-up suggestions"
                        className={cn("self-start mt-0.5 opacity-40 hover:opacity-100 hover:text-(--g-accent)", generatingFollowUps && "animate-spin opacity-60")}
                        disabled={generatingFollowUps}
                      >
                        <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                          <path d="M3 3v5h5" />
                        </svg>
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Bottom spacer */}
              <div className="h-3" />
            </div>

            {/* Scroll to bottom button */}
            {userScrolled && (
              <button
                onClick={scrollToBottom}
                className="absolute bottom-[5.625rem] left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-4 py-2 rounded-[1.25rem] border border-(--g-border-accent) bg-(--g-surface) cursor-pointer text-sm text-(--g-accent) shadow-[0_4px_16px_rgba(0,0,0,0.3)]"
              >
                <svg width={14} height={14} viewBox="0 0 14 14" fill="none">
                  <path d="M3 5.5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Scroll to bottom
              </button>
            )}

            {/* Input */}
            <div className="mt-3 shrink-0">
              <InputBoxWrapper>
                <textarea
                  ref={inputRef}
                  rows={1}
                  placeholder={isGregLike ? "talk to greg..." : chatMessages.length > 0 ? "Reply..." : "How can I help?"}
                  onChange={supportsFieldSizing ? undefined : (e) => { const t = e.target; requestAnimationFrame(() => { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 160) + "px"; }); }}
                  onKeyDown={handleKeyDown}
                  className="w-full min-h-7 max-h-[160px] overflow-y-auto p-0 resize-none border-none bg-transparent outline-none font-[inherit] text-base text-(--g-text) leading-[1.55] mb-1 [field-sizing:content]"
                />
                <div className="flex items-center mb-1.5">
                  <span className="text-[0.6875rem] text-(--g-text-dim) select-none">
                    <kbd className="font-mono opacity-70">/clear</kbd>
                    <span className="ml-1 opacity-50">— clear context</span>
                  </span>
                </div>
                {/* Bottom row: personality + model + send */}
                <div className="flex items-center gap-2 pt-2" style={{ borderTop: "1px solid var(--g-border)" }}>
                  {/* Personality dropup */}
                  <div className="relative" ref={personalityRef}>
                    <button
                      onClick={() => setPersonalityOpen(!personalityOpen)}
                      className="flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition-colors hover:bg-(--g-surface-hover)"
                      style={{ color: PERSONALITY_COLOR[personality] }}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PERSONALITY_COLOR[personality] }} />
                      {personality}
                      <svg width={10} height={10} viewBox="0 0 10 10" fill="none" className={cn("transition-transform duration-150", personalityOpen ? "rotate-180" : "rotate-0")}>
                        <path d="M2 6.5l3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    {personalityOpen && (
                      <div className="absolute bottom-full mb-1.5 left-0 z-50 min-w-[9rem] rounded-lg border border-(--g-border) bg-(--g-surface) shadow-lg overflow-hidden">
                        {(["greg", "casual", "quick", "explanatory"] as const satisfies Personality[]).map((p, i) => (
                          <React.Fragment key={p}>
                            <button
                              onClick={() => { setPersonality(p); setPersonalityOpen(false); }}
                              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left transition-colors"
                              style={{
                                color: p === personality ? PERSONALITY_COLOR[p] : "var(--g-text-muted)",
                                background: p === personality ? `color-mix(in srgb, ${PERSONALITY_COLOR[p]} 8%, transparent)` : "transparent",
                              }}
                              onMouseEnter={(e) => { if (p !== personality) (e.currentTarget as HTMLElement).style.background = "var(--g-surface-hover)"; }}
                              onMouseLeave={(e) => { if (p !== personality) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                            >
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: PERSONALITY_COLOR[p] }} />
                              {p}
                            </button>
                            {i === 1 && <div className="h-px bg-(--g-border) mx-1" />}
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Model picker */}
                  <select
                    value={selectedModel || ""}
                    onChange={(e) => {
                      const m = models.find((x) => x.id === e.target.value);
                      if (m) setModel(m.id, m.provider);
                    }}
                    style={{ fieldSizing: "content" } as React.CSSProperties}
                    className="-ml-2 h-8 px-2 rounded-md text-xs text-(--g-text-muted) bg-transparent border-none outline-none cursor-pointer hover:bg-(--g-surface-hover) transition-colors min-w-0 max-w-[14rem] truncate"
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
                  <TokenCounter chatMessages={tokenCounterMessages} provider={selectedProvider} onCompact={handleCompact} />

                  <span className="flex-1" />

                  {/* Auto-compact toggle */}
                  <button
                    onClick={() => setAutoCompact((v) => !v)}
                    className="flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition-colors hover:bg-(--g-surface-hover)"
                    style={{ color: autoCompact ? "var(--g-green)" : "var(--g-text-dim)" }}
                    title={autoCompact ? "Auto-compact on: code blocks stripped after each response" : "Auto-compact off: full responses retained"}
                  >
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
                      <line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/>
                    </svg>
                    <span>Auto-compact</span>
                  </button>

                  {/* APIs toggle */}
                  <button
                    onClick={() => setApisOpen((v) => !v)}
                    className="flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition-colors hover:bg-(--g-surface-hover)"
                    style={{ color: apisOpen ? "var(--g-accent)" : "var(--g-text-dim)" }}
                    title="Toggle API docs"
                  >
                    {Ic.server(14)}
                    <span>APIs</span>
                  </button>

                  {/* Docs toggle */}
                  <button
                    onClick={() => setDocsOpen((v) => !v)}
                    className="flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition-colors hover:bg-(--g-surface-hover)"
                    style={{ color: docsOpen ? "var(--g-accent)" : "var(--g-text-dim)" }}
                    title="Toggle markdown docs"
                  >
                    {Ic.doc(14)}
                    <span>Docs</span>
                  </button>

                  {/* Send / Stop */}
                  {chatLoading ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const pending = abortRef.current;
                        pending?.controller.abort();
                        abortRef.current = null;
                        setChatLoading(false);
                        if (pending) updateLastAssistantIn(pending.convId, (m) => ({ ...m, streaming: false }));
                        saveChat();
                      }}
                      className="bg-(--g-danger-muted) text-(--g-danger) h-8 w-8"
                    >
                      <svg width={16} height={16} viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="2" /></svg>
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleSend()}
                      className="bg-(--g-accent-muted) text-(--g-accent) h-8 w-8"
                    >
                      <span className="-rotate-90">{Ic.send(16)}</span>
                    </Button>
                  )}
                </div>
              </InputBoxWrapper>
            </div>
          </div>

        </div>
        </div>
            </ResizablePanel>

            {/* Side panel (APIs / Docs) — always mounted so collapse/expand slides smoothly */}
            <ResizableHandle withHandle className={cn("transition-opacity duration-200", panelOpen ? "opacity-100" : "opacity-0 pointer-events-none")} />
            <ResizablePanel
              panelRef={swaggerPanelRef}
              id="swagger"
              minSize={10}
              defaultSize={panelOpen ? 25 : 0}
              collapsible
              collapsedSize={0}
              className="transition-all duration-300 ease-in-out overflow-hidden"
            >
              {apisOpen && docsOpen ? (
                <ResizablePanelGroup direction="vertical" className="h-full">
                  <ResizablePanel minSize={20} defaultSize={55}>
                    <SwaggerPanel anchor={panelAnchor} onClose={handleCloseApis} />
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                  <ResizablePanel minSize={20} defaultSize={45}>
                    <DocsSidePanel onClose={handleCloseDocs} anchor={panelDocAnchor} />
                  </ResizablePanel>
                </ResizablePanelGroup>
              ) : apisOpen ? (
                <SwaggerPanel anchor={panelAnchor} onClose={handleCloseApis} />
              ) : docsOpen ? (
                <DocsSidePanel onClose={handleCloseDocs} anchor={panelDocAnchor} />
              ) : null}
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>

        {/* Debug panel — always mounted so collapse/expand slides smoothly */}
        <ResizableHandle withHandle className={cn("transition-opacity duration-200", debugMsgIdx !== null ? "opacity-100" : "opacity-0 pointer-events-none")} />
        <ResizablePanel
          panelRef={debugPanelRef}
          id="debug"
          minSize={8}
          defaultSize={debugMsgIdx !== null ? 12 : 0}
          collapsible
          collapsedSize={0}
          className="transition-all duration-300 ease-in-out overflow-hidden"
        >
          {debugMsgIdx !== null && (() => {
            const msg = chatMessages[debugMsgIdx];
            return (
              <DebugPanel
                entries={msg?.debug ?? EMPTY_DEBUG}
                {...(msg?.model !== undefined && { model: msg.model })}
                {...(msg?.compactedTokens !== undefined ? { compactedTokens: msg.compactedTokens } : {})}
                {...(msg?.compactedHistory !== undefined ? { compactedHistory: msg.compactedHistory } : {})}
                onClose={handleCloseDebug}
              />
            );
          })()}
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
};

export default GregPage;
