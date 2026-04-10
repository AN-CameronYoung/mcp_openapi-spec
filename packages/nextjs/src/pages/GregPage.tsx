"use client";

import React, { useState, useRef, useEffect, useMemo, memo, useCallback } from "react";
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
import { streamChat, listModels, fetchSuggestions } from "../lib/api";
import type { EndpointCard, Personality } from "../lib/api";
import ApiViewer from "../components/ApiViewer";
import GroupedApiSelect from "../components/GroupedApiSelect";
import { cn } from "../lib/utils";
import { useStore } from "../store/store";
import type { ChatMsg } from "../store/store";
import EpCard from "../components/EpCard";
import { Button } from "../components/ui/button";

SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("javascript", typescript);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("yaml", yaml);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// Per-million-token pricing for Anthropic models (input, output)
const ANTHROPIC_PRICING: Record<string, [number, number]> = {
  "claude-opus-4": [15, 75],
  "claude-sonnet-4": [3, 15],
  "claude-haiku-4-5": [0.80, 4],
  "claude-3-5-sonnet": [3, 15],
  "claude-3-5-haiku": [0.80, 4],
  "claude-3-opus": [15, 75],
};

const PERSONALITY_COLOR: Record<Personality, string> = {
  greg: "var(--g-green)",
  verbose: "var(--g-method-put-text)",
  curt: "var(--g-text-dim)",
  casual: "var(--g-method-patch)",
};

const BUBBLE_STYLES: Record<Personality, { bg: string; border: string }> = {
  greg: { bg: "color-mix(in srgb, var(--g-green) 6%, transparent)", border: "color-mix(in srgb, var(--g-green) 20%, transparent)" },
  verbose: { bg: "color-mix(in srgb, var(--g-method-put) 6%, transparent)", border: "color-mix(in srgb, var(--g-method-put) 20%, transparent)" },
  curt: { bg: "color-mix(in srgb, var(--g-text-dim) 12%, transparent)", border: "color-mix(in srgb, var(--g-text-dim) 30%, transparent)" },
  casual: { bg: "color-mix(in srgb, var(--g-method-patch) 6%, transparent)", border: "color-mix(in srgb, var(--g-method-patch) 20%, transparent)" },
};

const METHOD_RE = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/\S*|$)/;
const PARAM_RE = /(\{[a-zA-Z_][a-zA-Z0-9_]*\}|<[a-zA-Z][a-zA-Z0-9_-]*>)/g;
const PARAM_TEST = /\{[a-zA-Z_][a-zA-Z0-9_]*\}|<[a-zA-Z][a-zA-Z0-9_-]*>/;

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
const cleanText = (raw: string): string => {
  const text = raw
    .replace(/<endpoint[^>]*\/?>/g, "")
    // Unwrap fenced code blocks that are actually markdown tables
    .replace(/```[^\n]*\n([\s\S]*?)```/g, (match, inner: string) => {
      const lines = inner.trim().split("\n").filter((l: string) => l.trim());
      const isTable = lines.length >= 2 && lines.every((l: string) => l.trimStart().startsWith("|"));
      return isTable ? inner.trim() : match;
    })
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
  if (personality === "verbose") return "Ready to explain your APIs in depth. What would you like to understand?";
  if (personality === "curt") return "What can I help you with?";
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

/**
 * Styled container for the chat input area; border colour changes on focus and is tinted by the active personality.
 */
const InputBoxWrapper = ({ children }: InputBoxWrapperProps): JSX.Element => {
  const [focused, setFocused] = useState(false);

  return (
    <div
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={() => setFocused(false)}
      className="flex flex-col rounded-[0.625rem] px-2.5 pt-2.5 pb-2 transition-[border-color,background] duration-150"
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
      {open && (
        <div className="mt-1">
          <SyntaxHighlighter style={syntaxStyle} language={lang} PreTag="div" customStyle={{ background: "var(--g-bg)", color: "var(--g-inline-code-text)", borderRadius: 6, fontSize: 13, lineHeight: 1.5, padding: "8px 12px", overflowX: "auto" }} codeTagProps={{ style: { background: "var(--g-bg)", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre" } }}>
            {code}
          </SyntaxHighlighter>
        </div>
      )}
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
      const lang = langMap[rawLang] ?? rawLang;
      if (DATA_LANGS.has(lang)) {
        return (
          <SyntaxHighlighter style={syntaxStyle} language={lang === "md" || lang === "markdown" ? "text" : lang} PreTag="div" customStyle={{ background: "var(--g-bg)", color: "var(--g-inline-code-text)", borderRadius: 6, fontSize: 13, lineHeight: 1.5, padding: "8px 12px", overflowX: "auto", margin: "6px 0" }} codeTagProps={{ style: { background: "var(--g-bg)", fontSize: 13, lineHeight: 1.5, whiteSpace: "pre" } }}>
            {code}
          </SyntaxHighlighter>
        );
      }
      const lineCount = code.split("\n").length;
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
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents(msgKey, langMap, isDark) as never}>{body}</ReactMarkdown>
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
  const langMap: Record<string, string> = { ts: "typescript", js: "javascript", py: "python", sh: "bash", yml: "yaml" };
  const theme = useStore((s) => s.theme);
  const isDark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);

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
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents(msgKey, langMap, isDark) as never}>{sections.preamble}</ReactMarkdown>
        )}
        {sections.items.map((s, i) => (
          <SectionDropdown key={i} title={s.title} body={s.body} msgKey={msgKey} langMap={langMap} defaultOpen={false} isDark={isDark} />
        ))}
      </>
    );
  }

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents(msgKey, langMap, isDark) as never}>
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
      {open && (
        <div className="flex flex-col gap-[0.1875rem] mt-1 max-h-[18.75rem] overflow-auto">
          {endpoints.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).map((ep, j) => (
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
      )}
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
const DebugPanel = ({ entries, model, onClose }: DebugPanelProps): JSX.Element => {
  const rounds = entries.filter((e) => (e as { event: string }).event === "round");
  const lastRound = rounds[rounds.length - 1] as { totalInput?: number; totalOutput?: number } | undefined;
  const primaryTokens = lastRound ? ((lastRound.totalInput ?? 0) + (lastRound.totalOutput ?? 0)) : 0;
  const toolCallCount = entries.filter((e) => (e as { event: string }).event === "tool_call").length;

  // Verification tokens
  const verifyEntry = entries.find((e) => (e as { event: string }).event === "verification_done") as { inputTokens?: number; outputTokens?: number } | undefined;
  const verifyTokens = verifyEntry ? ((verifyEntry.inputTokens ?? 0) + (verifyEntry.outputTokens ?? 0)) : 0;
  const grandTotal = primaryTokens + verifyTokens;

  const primaryCost = estimateCost(model, {
    input: (lastRound?.totalInput ?? 0),
    output: (lastRound?.totalOutput ?? 0),
  });
  const verifyCost = verifyEntry ? estimateCost("claude-sonnet-4", {
    input: verifyEntry.inputTokens ?? 0,
    output: verifyEntry.outputTokens ?? 0,
  }) : null;
  const totalCostNum = (primaryCost ? parseFloat(primaryCost) : 0) + (verifyCost ? parseFloat(verifyCost) : 0);
  const cost = totalCostNum > 0 ? totalCostNum.toFixed(Math.max(2, 6 - Math.floor(Math.log10(totalCostNum)))) : primaryCost;

  return (
    <div className="flex flex-col w-[18.75rem] min-h-0 overflow-hidden shrink-0 border-l border-(--g-border) bg-(--g-surface)">
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
};

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
const ChatMessage = memo(({ msg, i, onSelectEndpoint, onShowDebug, loadingGif }: ChatMessageProps): JSX.Element => {
  const p = msg.personality ?? "greg";
  const bubbleStyle = (BUBBLE_STYLES[p] ?? BUBBLE_STYLES["greg"])!;
  return (
    <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[85%]">
        {msg.role === "assistant" && (
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[0.8125rem] font-medium" style={{ color: PERSONALITY_COLOR[p] }}>greg</span>
            {msg.model && (
              <span className="font-mono text-[0.6875rem] text-(--g-text-dim)">{msg.model}</span>
            )}
            {msg.debug && msg.debug.length > 0 && !msg.streaming && (
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
          </div>
        )}
        <div
          className={`px-3.5 py-3 text-sm leading-[1.6] ${msg.role === "user" ? "rounded-[12px_12px_2px_12px]" : "rounded-[0.625rem]"}`}
          style={{
            background: msg.role === "user" ? "var(--g-user-bg)" : bubbleStyle.bg,
            border: `1px solid ${msg.role === "user" ? "var(--g-border-accent)" : bubbleStyle.border}`,
            color: "var(--g-text)",
          }}
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
 * Resizable side panel showing Swagger UI with an API selector dropdown.
 * Accepts an optional anchor (api + method/path) for navigating to a specific endpoint.
 * Drag the left edge to resize; width is persisted to localStorage.
 */
const SwaggerPanel = ({ anchor, onClose }: SwaggerPanelProps): JSX.Element => {
  const { apis } = useStore(useShallow((s) => ({ apis: s.apis })));

  const initWidth = useMemo(() => {
    try { const v = parseInt(localStorage.getItem("greg-panel-width") ?? ""); return v > 200 ? v : 480; } catch { return 480; }
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);

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

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    const handle = handleRef.current;
    if (!container) return;
    const startX = e.clientX;
    const startW = container.offsetWidth;
    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;inset:0;z-index:9999;cursor:col-resize;";
    document.body.appendChild(overlay);
    if (handle) { handle.style.background = "var(--g-accent)"; handle.style.opacity = "1"; }
    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      container.style.width = Math.max(280, Math.min(window.innerWidth * 0.7, startW + delta)) + "px";
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      overlay.remove();
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      if (handle) { handle.style.background = ""; handle.style.opacity = ""; }
      try { localStorage.setItem("greg-panel-width", String(container.offsetWidth)); } catch {}
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  return (
    <div ref={containerRef} className="relative flex h-full shrink-0" style={{ width: initWidth }}>
      {/* Drag handle */}
      <div onMouseDown={onMouseDown} className="flex items-center justify-center w-2 shrink-0 cursor-col-resize">
        <div ref={handleRef} className="w-[0.1875rem] h-9 rounded-[0.125rem] opacity-50 bg-(--g-text-dim)" />
      </div>

      {/* Panel content */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-t-md border-b border-(--g-border) bg-(--g-surface)">
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
        </div>

        {/* API Viewer — direct render, no iframe */}
        {selectedApi ? (
          <div className="flex-1 min-h-0 overflow-hidden rounded-b-md border border-t-0 border-(--g-border) bg-(--g-bg)">
            <ApiViewer
              apiName={selectedApi}
              anchor={anchor?.api === selectedApi ? anchor : null}
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
    </div>
  );
};

// ---------------------------------------------------------------------------
// GregPage
// ---------------------------------------------------------------------------

/**
 * Main chat page — sidebar with history, message list, input box, and optional detail/debug panels.
 */
const GregPage = (): JSX.Element => {
  const {
    chatMessages,
    personality,
    chatLoading,
    addChatMessage,
    updateLastAssistant,
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
  } = useStore(useShallow((s) => ({
    chatMessages: s.chatMessages,
    personality: s.personality,
    chatLoading: s.chatLoading,
    addChatMessage: s.addChatMessage,
    updateLastAssistant: s.updateLastAssistant,
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
  })));

  const doubleCheck = false; // disabled
  const isGregLike = personality === "greg";

  const [greetingGif, setGreetingGif] = useState<string | null>(null);
  const [loadingGif, setLoadingGif] = useState<string | null>(null);
  const [greeting, setGreetingText] = useState<string>("");
  const [models, setModels] = useState<Array<{ id: string; name: string; provider: string }>>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [debugMsgIdx, setDebugMsgIdx] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [personalityOpen, setPersonalityOpen] = useState(false);
  const personalityRef = useRef<HTMLDivElement>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelAnchor, setPanelAnchor] = useState<{ api: string; method?: string; path?: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { listModels().then(setModels).catch(() => {}); }, []);
  useEffect(() => { fetchSuggestions().then(setSuggestions).catch(() => {}); }, []);
  useEffect(() => { setGreetingText(getGreeting(personality)); }, [personality]);
  useEffect(() => {
    if (!personalityOpen) return;
    const handler = (e: MouseEvent) => {
      if (personalityRef.current && !personalityRef.current.contains(e.target as Node)) setPersonalityOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [personalityOpen]);

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

  const handleSend = async (overrideText?: string): Promise<void> => {
    const text = (overrideText ?? input).trim();
    if (!text || chatLoading) return;

    setInput("");
    setUserScrolled(false);
    setLoadingGif(null);
    addChatMessage({ role: "user", text, personality });
    addChatMessage({ role: "assistant", text: "", streaming: true, ...(selectedModel && { model: selectedModel }), personality });
    setChatLoading(true);
    if (isGregLike) {
      fetch("/api/greeting-gif").then((r) => r.json()).then((d) => setLoadingGif(d.url ?? null)).catch(() => {});
    }

    const history = [
      ...chatMessages.map((m) => ({ role: m.role, content: m.text })),
      { role: "user" as const, content: text },
    ];

    let accumulated = "";
    let verificationText = "";
    let doneModel: string | undefined;
    let doneUsage: { input: number; output: number; toolCalls: number } | undefined;
    let doneVerificationUsage: { input: number; output: number } | undefined;
    const endpointMap = new Map<string, EndpointCard>();
    const debugLog: Record<string, unknown>[] = [];

    try {
      const customPrompt = personality === "greg" ? customGregPrompt : personality === "verbose" ? customExplainerPrompt : personality === "casual" ? customCasualPrompt : customProPrompt;
      const abort = new AbortController();
      abortRef.current = abort;
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
          case "verification_text":
            // Arrives as one complete message (not streamed)
            verificationText = event.text ?? "";
            updateLastAssistant((m) => ({ ...m, verificationText, verificationStreaming: false }));
            break;
          case "error":
            accumulated += `\n[error: ${event.error}]`;
            updateLastAssistant((m) => ({ ...m, text: accumulated }));
            break;
          case "debug":
            debugLog.push(event as unknown as Record<string, unknown>);
            if (event.event === "verification_start") {
              // Greg is done, verification is starting — render Greg's markdown, show checking indicator
              const eps = [...endpointMap.values()];
              updateLastAssistant((m) => ({
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
      updateLastAssistant((m) => ({ ...m, text: accumulated }));
    }

    abortRef.current = null;
    const dedupedEndpoints = [...endpointMap.values()];
    updateLastAssistant((m) => ({
      ...m,
      streaming: false,
      verificationStreaming: false,
      ...(dedupedEndpoints.length > 0 ? { endpoints: dedupedEndpoints } : {}),
      ...(doneModel !== undefined && { model: doneModel }),
      ...(doneUsage !== undefined && { usage: doneUsage }),
      ...(doneVerificationUsage !== undefined && { verificationUsage: doneVerificationUsage }),
      ...(verificationText ? { verificationText } : {}),
      ...(debugLog.length > 0 ? { debug: debugLog } : {}),
    }));
    saveChat();
    setChatLoading(false);
  };

  const handleSuggestion = (q: string): void => { handleSend(q); };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-[calc(100%-2.75rem)]">
      {/* History sidebar — DOM-affecting flex child */}
      <div
        className="flex shrink-0 overflow-hidden border-r border-(--g-border) bg-(--g-surface) transition-[width] duration-200"
        style={{ width: sidebarOpen ? "16.25rem" : "0" }}
      >
        <div className="flex flex-col w-[16.25rem] min-w-[16.25rem] h-full overflow-auto px-2.5 py-3">
          <div className="flex items-center mb-2.5">
            <span className="flex-1 text-[0.9375rem] font-semibold text-(--g-text)">History</span>
            <Button variant="ghost" size="icon-xs" onClick={handleNewChat} className="text-(--g-accent)" title="New chat">
              {Ic.plus(14)}
            </Button>
          </div>
          {chatHistory.length === 0 && (
            <span className="text-[0.8125rem] text-(--g-text-dim)">No chats yet</span>
          )}
          {chatHistory.map((chat) => {
            const isActive = chat.id === useStore.getState().activeChatId;
            return (
              <div
                key={chat.id}
                onClick={() => loadChat(chat.id)}
                className="flex items-center gap-1.5 mb-0.5 px-2 py-1.5 rounded-md cursor-pointer transition-colors duration-100"
                style={{
                  background: isActive ? "var(--g-surface-active)" : "transparent",
                  borderLeft: isActive ? "2px solid var(--g-accent)" : "2px solid transparent",
                }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "var(--g-surface-hover)"; }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <span className="flex-1 truncate text-[0.8125rem] text-(--g-text)">
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
        className="fixed z-20 flex items-center justify-center px-3 py-3 rounded-r-lg border border-l-0 border-(--g-border) bg-(--g-surface) shadow-sm hover:bg-(--g-surface-hover) -translate-y-1/2 transition-[left,color] duration-200"
        style={{ top: "4.25rem", left: sidebarOpen ? "16.25rem" : "0", color: sidebarOpen ? "var(--g-accent)" : "var(--g-text-dim)" }}
        title={sidebarOpen ? "Close history" : "Open history"}
      >
        {Ic.clock(18)}
      </button>

      {/* Main area: chat content + swagger panel */}
      <div className="flex flex-1 min-w-0">
        {/* Chat column */}
        <div className="flex flex-col flex-1 min-w-0 px-6 pt-5 pb-5">
        {/* Messages + detail panel */}
        <div className="flex flex-1 gap-5 min-h-0">
          {/* Messages */}
          <div className="relative flex flex-col flex-1 min-w-0">
            {/* Clear button */}
            {chatMessages.length > 0 && (
              <button
                onClick={clearChat}
                className="absolute top-0 right-0 z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs text-red-400 hover:bg-red-500/10 transition-colors"
                title="Clear chat"
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                Clear
              </button>
            )}
            <div ref={scrollContainerRef} onScroll={handleScroll} className="relative flex flex-col flex-1 gap-3 overflow-auto">
              <div className={cn("flex flex-col items-center gap-4 text-(--g-text-dim)", chatMessages.length === 0 ? "flex-1 justify-center" : "pt-6 pb-2")}>
                <img src="https://media0.giphy.com/media/v1.Y2lkPWM4MWI4ODBkMnl2cmJ4ODFic3pwcjNqdGx4eTd0NWZqeHR1Z21jZXk0dmc2NzByeiZlcD12MV9zdGlja2Vyc19zZWFyY2gmY3Q9cw/j0HjChGV0J44KrrlGv/giphy.gif" alt="greg" className="max-h-[45rem] rounded-xl" />
                <span className="text-2xl">
                  {greeting}
                </span>
                {suggestions.length > 0 && chatMessages.length === 0 && (
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
              {chatMessages.map((msg, i) => (
                <ChatMessage key={i} msg={msg} i={i} onSelectEndpoint={handleSelectEndpoint} onShowDebug={setDebugMsgIdx} loadingGif={msg.streaming ? loadingGif : null} />
              ))}
              <div ref={messagesEndRef} />
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
                  rows={1}
                  placeholder={isGregLike ? "talk to greg..." : "Search API documentation..."}
                  value={input}
                  onChange={(e) => { setInput(e.target.value); const t = e.target; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px"; }}
                  onKeyDown={handleKeyDown}
                  className="w-full min-h-5 p-0 resize-none border-none bg-transparent outline-none font-[inherit] text-[0.8125rem] text-(--g-text) leading-[1.5] mb-1"
                />
                {/* Bottom row: personality + model + send */}
                <div className="flex items-center gap-1.5 pt-1.5" style={{ borderTop: "1px solid var(--g-border)" }}>
                  {/* Personality dropup */}
                  <div className="relative" ref={personalityRef}>
                    <button
                      onClick={() => setPersonalityOpen(!personalityOpen)}
                      className="flex items-center gap-1.5 h-6 px-2 rounded text-[0.6875rem] font-medium transition-colors hover:bg-(--g-surface-hover)"
                      style={{ color: PERSONALITY_COLOR[personality] }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: PERSONALITY_COLOR[personality] }} />
                      {personality}
                      <svg width={8} height={8} viewBox="0 0 10 10" fill="none" className={cn("transition-transform duration-150", personalityOpen ? "rotate-180" : "rotate-0")}>
                        <path d="M2 6.5l3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    {personalityOpen && (
                      <div className="absolute bottom-full mb-1.5 left-0 z-50 min-w-[9rem] rounded-lg border border-(--g-border) bg-(--g-surface) shadow-lg overflow-hidden">
                        {(["greg", "curt", "casual", "verbose"] as const satisfies Personality[]).map((p) => (
                          <button
                            key={p}
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
                    className="h-6 px-1.5 rounded text-[0.6875rem] text-(--g-text-muted) bg-transparent border-none outline-none cursor-pointer hover:bg-(--g-surface-hover) transition-colors"
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

                  <span className="flex-1" />

                  {/* Docs toggle */}
                  <button
                    onClick={() => setPanelOpen(!panelOpen)}
                    className="flex items-center gap-1 h-6 px-2 rounded text-[0.6875rem] font-medium transition-colors hover:bg-(--g-surface-hover)"
                    style={{ color: panelOpen ? "var(--g-accent)" : "var(--g-text-dim)" }}
                    title="Toggle API docs"
                  >
                    {Ic.doc(12)}
                    <span>Docs</span>
                  </button>

                  {/* Send / Stop */}
                  {chatLoading ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => { abortRef.current?.abort(); abortRef.current = null; setChatLoading(false); updateLastAssistant((m) => ({ ...m, streaming: false })); saveChat(); }}
                      className="bg-(--g-danger-muted) text-(--g-danger)"
                    >
                      <svg width={14} height={14} viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="2" /></svg>
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleSend()}
                      className="bg-(--g-accent-muted) text-(--g-accent)"
                    >
                      <span className="-rotate-90">{Ic.send(14)}</span>
                    </Button>
                  )}
                </div>
              </InputBoxWrapper>
            </div>
          </div>

        </div>
        </div>

        {/* Swagger panel — full height sibling outside padded column, slides in/out */}
        <div
          className="flex overflow-hidden transition-[max-width] duration-200 ease-in-out"
          style={{ maxWidth: panelOpen ? "70vw" : 0 }}
        >
          <SwaggerPanel anchor={panelAnchor} onClose={() => { setPanelOpen(false); setPanelAnchor(null); }} />
        </div>
      </div>

      {/* Debug panel — sibling to main area */}
      {debugMsgIdx !== null && (() => {
        const msg = chatMessages[debugMsgIdx];
        return msg ? <DebugPanel entries={msg.debug ?? []} {...(msg.model !== undefined && { model: msg.model })} onClose={() => setDebugMsgIdx(null)} /> : null;
      })()}
    </div>
  );
};

export default GregPage;
