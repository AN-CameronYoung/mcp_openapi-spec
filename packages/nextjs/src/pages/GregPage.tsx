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
import { streamChat, listModels, fetchSuggestions, generateFollowUpSuggestions, getEndpoint } from "../lib/api";
import type { EndpointCard, Personality } from "../lib/api";
import ApiViewer from "../components/ApiViewer";
import GroupedApiSelect from "../components/GroupedApiSelect";
import MermaidDiagram from "../components/MermaidDiagram";
import { cn } from "../lib/utils";
import { useStore, pageFromHash, chatIdFromHash, getActiveConversation } from "../store/store";
import type { ChatMsg } from "../store/store";
import EpCard from "../components/EpCard";
import { Button } from "../components/ui/button";
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
            <SyntaxHighlighter showLineNumbers style={syntaxStyle} language={lang} PreTag="div" customStyle={{ background: "var(--g-bg)", color: "var(--g-inline-code-text)", borderRadius: 6, fontSize: 13, lineHeight: 1.5, padding: "8px 12px", overflowX: "auto" }} codeTagProps={{ style: { background: "var(--g-bg)", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre" } }} lineNumberStyle={{ color: "color-mix(in srgb, var(--g-text-dim) 60%, transparent)", minWidth: "2em", paddingRight: "1em", userSelect: "none", fontStyle: "normal" }}>
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
const StreamingText = ({ text, personality }: StreamingTextProps): JSX.Element => {
  const dotColor = PERSONALITY_COLOR[personality ?? "greg"] ?? "var(--g-green)";
  const cleaned = cleanText(text);

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
    // Show text before the code block + "coding..." spinner
    const lastFence = cleaned.lastIndexOf("```");
    const before = cleaned.slice(0, lastFence).trim();
    return (
      <>
        {before && <span className="whitespace-pre-wrap">{before}</span>}
        <div className="flex items-center gap-2 py-2 text-(--g-text-dim)">
          <svg className="animate-spin inline-block w-3.5 h-3.5" width={14} height={14} viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20 12" />
          </svg>
          <span className="text-sm italic">coding...</span>
        </div>
      </>
    );
  }

  return <span className="whitespace-pre-wrap">{cleaned}</span>;
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
    <code className="rounded bg-(--g-bg) py-px px-[0.3125rem] font-mono text-[0.9em]">
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
          <SyntaxHighlighter style={syntaxStyle} language={renderLang} PreTag="div" customStyle={{ background: "var(--g-bg)", color: "var(--g-inline-code-text)", borderRadius: 6, fontSize: 13, lineHeight: 1.5, padding: "8px 12px", overflowX: "auto", margin: "6px 0" }} codeTagProps={{ style: { background: "var(--g-bg)", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre" } }}>
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
            <SyntaxHighlighter showLineNumbers style={syntaxStyle} language={lang} PreTag="div" customStyle={{ background: "var(--g-bg)", color: "var(--g-inline-code-text)", borderRadius: 6, fontSize: 13, lineHeight: 1.5, padding: "8px 12px", overflowX: "auto" }} codeTagProps={{ style: { background: "var(--g-bg)", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre" } }} lineNumberStyle={{ color: "color-mix(in srgb, var(--g-text-dim) 60%, transparent)", minWidth: "2em", paddingRight: "1em", userSelect: "none", fontStyle: "normal" }}>
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
      <code className="rounded bg-(--g-bg) py-px px-[0.3125rem] font-mono text-[0.9em]" style={{ color: "var(--g-inline-code-text)" }}>
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
    <div className="mt-1.5">
      <button
        onClick={handleToggle}
        className={cn(collapseBtn, "w-full rounded border border-(--g-border-accent) px-2.5 py-1 text-[0.8125rem] text-(--g-accent) bg-(--g-accent-dim)")}
      >
        <span className="flex-1 text-left">
          {`${endpoints.length} endpoint${endpoints.length !== 1 ? "s" : ""} found`}
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
          <div className="flex flex-col gap-[0.1875rem] mt-1 max-h-[18.75rem] overflow-auto">
            {[...endpoints].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((ep, j) => (
              <EpCard
                key={j}
                method={ep.method}
                path={ep.path}
                api={ep.api}
                description={ep.description}
                {... (ep.warnings !== undefined && { warnings: ep.warnings })}
                onClick={() => onSelect(ep)}
              />
            ))}
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
  { label: "Flowchart",    type: "flowchart", title: "flowchart LR — data / service flows" },
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
  const hasCode = useMemo(() => /```(?!mermaid)\w/.test(msgText), [msgText]);

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
// ChatMessage
// ---------------------------------------------------------------------------

const ChatMessage = memo(({ msg, i, onSelectEndpoint, onShowDebug, onRetry, onQuickAction, onFork, onDelete, loadingGif }: ChatMessageProps): JSX.Element => {
  const p = msg.personality ?? "greg";
  const bubbleStyle = (BUBBLE_STYLES[p] ?? BUBBLE_STYLES["greg"])!;

  // 🔧 perf: stable style objects — avoids new object references on every render
  const bubbleStyle_ = useMemo(() => ({
    background: msg.role === "user" ? "var(--g-user-bg)" : bubbleStyle.bg,
    border: `1px solid ${msg.role === "user" ? "var(--g-border-accent)" : bubbleStyle.border}`,
    color: "var(--g-text)",
  }), [msg.role, bubbleStyle.bg, bubbleStyle.border]);

  return (
    <div className={`group/msg flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[85%]">
        {msg.role === "assistant" && (
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[0.8125rem] font-medium" style={{ color: PERSONALITY_COLOR[p] }}>greg</span>
            {msg.model && (
              <span className="font-mono text-[0.6875rem] text-(--g-text-dim)">{msg.model}</span>
            )}
            {((msg.debug && msg.debug.length > 0) || msg.compactedHistory) && !msg.streaming && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onShowDebug(i)}
                title="Debug trace"
                className="ml-0.5 opacity-60 hover:opacity-100 hover:text-(--g-accent)"
              >
                {Ic.bug(12)}
              </Button>
            )}
            {!msg.streaming && (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onDelete(i)}
                title="Delete message"
                className="ml-auto opacity-0 group-hover/msg:opacity-60 hover:!opacity-100 text-(--g-danger)"
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
        )}
        <div
          className={`px-4 ${msg.role === "user" ? "py-3 rounded-[12px_12px_2px_12px]" : "py-2.5 rounded-[0.625rem]"} text-[0.9375rem] leading-[1.6]`}
          style={bubbleStyle_}
        >
          {msg.role === "user" ? (
            msg.text
          ) : msg.streaming ? (
            <>
              {loadingGif && !msg.text && (
                <img src={loadingGif} alt="greg thinking" className="block max-h-[180px] max-w-full rounded-lg mb-1.5" />
              )}
              <StreamingText text={msg.text} {...(msg.personality !== undefined && { personality: msg.personality })} />
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
        {/* 🔧 perf: extracted to own component — dropdown state changes don't re-render GregMarkdown */}
        {msg.role === "assistant" && !msg.streaming && (
          <QuickActionBar
            msgText={msg.text}
            msgIdx={i}
            onQuickAction={onQuickAction}
            {...(onFork && { onFork })}
          />
        )}
        {msg.endpoints && msg.endpoints.length > 0 && (
          <EndpointDropdown endpoints={msg.endpoints} onSelect={onSelectEndpoint} />
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
          <Button variant="ghost" size="icon-xs" onClick={onClose} title="Close docs">
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
    deleteChat,
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
    deleteChat: s.deleteChat,
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
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
  const [autoCompact, setAutoCompact] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("greg-auto-compact");
      if (saved !== null) return saved !== "false";
    } catch {}
    return true;
  });
  const autoCompactRef = useRef(autoCompact);
  autoCompactRef.current = autoCompact;
  const [chatZoom, setChatZoom] = useState<number>(() => {
    try { const v = parseFloat(localStorage.getItem("greg-chat-zoom") ?? ""); return v > 0 ? v : 1; } catch { return 1; }
  });
  useEffect(() => { try { localStorage.setItem("greg-chat-zoom", String(chatZoom)); } catch {} }, [chatZoom]);
  const [personalityOpen, setPersonalityOpen] = useState(false);
  const personalityRef = useRef<HTMLDivElement>(null);
  const [panelOpen, setPanelOpen] = useState<boolean>(() => {
    try { return localStorage.getItem("greg-panel-open") !== "false"; } catch { return false; }
  });
  const [panelAnchor, setPanelAnchor] = useState<{ api: string; method?: string; path?: string } | null>(null);
  const abortRef = useRef<{ controller: AbortController; convId: string } | null>(null);

  useEffect(() => { listModels().then(setModels).catch(() => {}); }, []);
  useEffect(() => { fetchSuggestions().then(setSuggestions).catch(() => {}); }, []);
  useEffect(() => { setGreetingText(getGreeting(personality)); }, [personality]);
  useEffect(() => { try { localStorage.setItem("greg-auto-compact", String(autoCompact)); } catch {} }, [autoCompact]);
  useEffect(() => { try { localStorage.setItem("greg-panel-open", String(panelOpen)); } catch {} }, [panelOpen]);
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
  useLayoutEffect(() => {
    try {
      const inner = localStorage.getItem("rp-greg-inner");
      if (inner && innerGroupRef.current) innerGroupRef.current.setLayout(JSON.parse(inner) as Layout);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Animate swagger panel open/close via resize()/collapse() on state change.
  // ⚠️ resize() treats bare numbers as pixels — pass "25%" to get a percentage.
  // Only resize to 25% if currently collapsed — don't override the user's resized width.
  useEffect(() => {
    const p = swaggerPanelRef.current;
    if (!p) return;
    if (panelOpen) { if (p.isCollapsed()) p.resize("25%"); }
    else p.collapse();
  }, [panelOpen]);
  useEffect(() => {
    const p = debugPanelRef.current;
    if (!p) return;
    if (debugMsgIdx !== null) {
      // Only set the initial size when the panel is actually collapsed — don't
      // override the user's manually resized width when switching between messages
      if (p.isCollapsed()) p.resize("15%");
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
    setPanelOpen(true);
  }, []);

  const handleCloseSwagger = useCallback(() => { setPanelOpen(false); setPanelAnchor(null); }, []);
  const handleCloseDebug = useCallback(() => setDebugMsgIdx(null), []);

  // Keep a ref to the latest handleSend so handleRetry always picks up the
  // current personality/model/provider — not whatever was in scope when the
  // original message was sent. Assigned below, after handleSend is declared.
  const handleSendRef = useRef<((overrideText?: string, baseMessages?: ChatMsg[]) => Promise<void>) | null>(null);

  const handleRetry = useCallback((msgIdx: number): void => {
    if (chatLoading) return;
    const msg = chatMessages[msgIdx];
    if (!msg || msg.role !== "user") return;
    const trimmed = chatMessages.slice(0, msgIdx);
    setChatMessages(trimmed);
    setFollowUpSuggestions([]);
    // If context boundary was beyond the retry point, reset it
    // Drop boundaries beyond the retry point; keep those at or before it
    setContextBoundaries(contextBoundaries.filter((b) => b <= msgIdx));
    // Pass the trimmed array directly so handleSend uses it for history,
    // not the stale closure value that hasn't updated yet
    handleSendRef.current?.(msg.text, trimmed);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatLoading, chatMessages, contextBoundaries, setChatMessages]);

  const DIAGRAM_PROMPTS: Record<string, string> = {
    flowchart: "show the above as a mermaid flowchart diagram (flowchart LR). Include the actual endpoint methods and paths (e.g. GET /users/{id}) as node labels — do not use generic descriptions.",
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
    if (chatLoading) return;
    const prompt = action === "diagram"
      ? (DIAGRAM_PROMPTS[subType ?? "flowchart"] ?? DIAGRAM_PROMPTS["flowchart"]!)
      : (CODE_PROMPTS[subType ?? "javascript"] ?? CODE_PROMPTS["javascript"]!);
    // Context trimmed to just up to this message so the AI knows exactly what to diagram/code.
    const context = chatMessages.slice(0, msgIdx + 1);
    handleSend(prompt, context);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatLoading, chatMessages]);

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
    // Filter search results by score; inline-mentioned routes (lookedUp) always pass.
    // Bump score on any endpoint that was mentioned in the text so EndpointDropdown's
    // score-descending sort lifts it to the top.
    const combined = [...relevantEndpoints(dedupedEndpoints), ...lookedUp];
    const allEndpoints = combined.map((ep) =>
      mentionedKeys.has(`${ep.method}:${ep.path}`) ? { ...ep, score: 1 } : ep,
    );

    updateLastAssistantIn(targetConvId, (m) => ({
      ...m,
      // Ensure the final accumulated text lands in state — a pending RAF flush
      // may not have fired before saveChat() persists the message.
      text: accumulated,
      streaming: false,
      verificationStreaming: false,
      ...(allEndpoints.length > 0 ? { endpoints: allEndpoints } : {}),
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
      {/* History sidebar — DOM-affecting flex child */}
      <div
        className="flex shrink-0 overflow-hidden border-r border-(--g-border) bg-(--g-surface) transition-[width] duration-200"
        style={{ width: sidebarOpen ? "16.25rem" : "0" }}
      >
        <div className="flex flex-col w-[16.25rem] min-w-[16.25rem] h-full overflow-auto px-2.5 py-3">
          <div className="flex items-center mb-2.5">
            <span className="flex-1 text-[0.75rem] font-semibold text-(--g-text)">History</span>
            <Button variant="ghost" size="icon-xs" onClick={handleNewChat} className="text-(--g-accent)" title="New chat">
              {Ic.plus(14)}
            </Button>
          </div>
          {chatHistory.length === 0 && (
            <span className="text-[0.6875rem] text-(--g-text-dim)">No chats yet</span>
          )}
          {chatHistory.map((chat) => {
            const isActive = chat.id === useStore.getState().activeChatId;
            return (
              <div
                key={chat.id}
                onClick={() => { loadChat(chat.id); setFollowUpSuggestions([]); }}
                className="flex items-center gap-1.5 mb-0.5 px-2 py-1 rounded-md cursor-pointer transition-colors duration-100"
                style={{
                  background: isActive ? "var(--g-surface-active)" : "transparent",
                  borderLeft: isActive ? "2px solid var(--g-accent)" : "2px solid transparent",
                }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "var(--g-surface-hover)"; }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <span className="flex-1 truncate text-[0.6875rem] text-(--g-text)">
                  {chat.title}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }}
                  className="shrink-0 opacity-50"
                >
                  {Ic.x(11)}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* History toggle badge — fixed, slides with sidebar */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed z-30 flex items-center justify-center px-3 py-3 rounded-r-lg border border-l-0 border-(--g-border) bg-(--g-surface) shadow-sm hover:bg-(--g-surface-hover) -translate-y-1/2 transition-[left,color] duration-200"
        style={{ top: "4.25rem", left: sidebarOpen ? "16.25rem" : "0", color: sidebarOpen ? "var(--g-accent)" : "var(--g-text-dim)" }}
        title={sidebarOpen ? "Close history" : "Open history"}
      >
        {Ic.clock(18)}
      </button>

      {/* Main area: chat + swagger + debug — all resizable */}
      <ResizablePanelGroup groupRef={outerGroupRef} onLayoutChanged={(l) => { try { localStorage.setItem("rp-greg-outer", JSON.stringify(l)); } catch {} }} className="flex flex-1 min-w-0">
        {/* Inner group: chat + swagger */}
        <ResizablePanel id="main" minSize={20}>
          <ResizablePanelGroup groupRef={innerGroupRef} onLayoutChanged={(l) => { try { localStorage.setItem("rp-greg-inner", JSON.stringify(l)); } catch {} }}>
            <ResizablePanel id="chat" defaultSize={75} minSize={20}>
        {/* Chat column */}
        <div
          className="flex flex-col h-full min-w-0 px-6 pt-5 pb-5"
          style={chatZoom !== 1 ? { zoom: chatZoom } : undefined}
        >
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
                <div className={cn("flex flex-col items-center gap-4 text-(--g-text-dim) px-6", hasChatMessages ? "pt-6 pb-2" : "min-h-full justify-center")}>
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
                    <div key={`b-${index}`} className="flex items-center gap-2 my-1 px-6">
                      <div className="flex-1 h-px bg-(--g-border)" />
                      <span className="text-[0.6875rem] text-(--g-text-dim) select-none">context cleared</span>
                      <div className="flex-1 h-px bg-(--g-border)" />
                    </div>
                  );
                }
                return (
                  <div key={`m-${item.msgIndex}`} className="px-6 py-1.5">
                    <ChatMessage
                      msg={item.msg}
                      i={item.msgIndex}
                      onSelectEndpoint={handleSelectEndpoint}
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
                <div className="px-6 pb-2">
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
                  onChange={(e) => { const t = e.target; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 160) + "px"; }}
                  onKeyDown={handleKeyDown}
                  className="w-full min-h-7 p-0 resize-none border-none bg-transparent outline-none font-[inherit] text-base text-(--g-text) leading-[1.55] mb-1"
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

                  {/* Docs toggle */}
                  <button
                    onClick={() => setPanelOpen(!panelOpen)}
                    className="flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition-colors hover:bg-(--g-surface-hover)"
                    style={{ color: panelOpen ? "var(--g-accent)" : "var(--g-text-dim)" }}
                    title="Toggle API docs"
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

            {/* Swagger panel — always mounted so collapse/expand slides smoothly */}
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
              {panelOpen && <SwaggerPanel anchor={panelAnchor} onClose={handleCloseSwagger} />}
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
