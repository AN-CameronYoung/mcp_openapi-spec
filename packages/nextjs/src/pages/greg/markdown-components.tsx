"use client";

import React, { useState, useRef, useEffect, useMemo, memo } from "react";
import { useShallow } from "zustand/react/shallow";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

import { METHOD_COLORS } from "../../lib/constants";
import { Ic } from "../../lib/icons";
import { cn } from "../../lib/utils";
import { useStore } from "../../store/store";
import MermaidDiagram from "../../components/MermaidDiagram";
import type {
  CopyBtnProps,
  ApiPathCodeProps,
  CodeDropdownProps,
  StreamingTextProps,
  LiDropdownProps,
  SectionDropdownProps,
  GregMarkdownProps,
  HeadingSection,
} from "./types";
import {
  collapseBtn,
  LANG_MAP,
  METHOD_RE,
  PARAM_RE,
  PARAM_TEST,
  PERSONALITY_COLOR,
  REVEAL_CHARS_PER_FRAME,
} from "./constants";
import {
  stableKey,
  isApiPath,
  getTextFromChildren,
  hasSubContent,
  stripStreamTags,
} from "./utils";

// ---------------------------------------------------------------------------
// CopyBtn
// ---------------------------------------------------------------------------

/**
 * Icon button that copies text to the clipboard and briefly shows a checkmark on success.
 */
export const CopyBtn = ({ text }: CopyBtnProps): JSX.Element => {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const handleClick = (): void => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    clearTimeout(timer.current);
  };

  const handleMouseLeave = (): void => {
    if (!copied) return;
    timer.current = setTimeout(() => setCopied(false), 1000);
  };

  const handleMouseEnter = (): void => {
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

// ---------------------------------------------------------------------------
// ApiPathCode
// ---------------------------------------------------------------------------

/**
 * Renders an API path (with optional HTTP method prefix) with colour-coded method and path params.
 */
export const ApiPathCode = ({ code }: ApiPathCodeProps): JSX.Element => {
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
// CodeDropdown
// ---------------------------------------------------------------------------

/**
 * Collapsible code block with syntax highlighting and a copy button.
 */
export const CodeDropdown = ({ code, lang, lineCount, blockKey }: CodeDropdownProps): JSX.Element => {
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

// ---------------------------------------------------------------------------
// StreamingText
// ---------------------------------------------------------------------------

/**
 * Renders streaming assistant text with a loading animation when empty,
 * and a "coding..." spinner when a code block is mid-stream.
 */
export const StreamingText = ({ text, personality, msgKey }: StreamingTextProps): JSX.Element => {
  const dotColor = PERSONALITY_COLOR[personality ?? "greg"] ?? "var(--g-green)";
  const theme = useStore((s) => s.theme);
  const isDark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const components = useMemo(() => mdComponents(msgKey, LANG_MAP, isDark), [msgKey, isDark]);
  const cleaned = stripStreamTags(text);

  // smooth reveal: displayedLen tracks how many chars of `cleaned` are shown
  const [displayedLen, setDisplayedLen] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (cleaned.length <= displayedLen) {
      setDisplayedLen(cleaned.length);
      return;
    }
    const step = (): void => {
      setDisplayedLen((prev) => {
        const next = prev + REVEAL_CHARS_PER_FRAME;
        if (next >= cleaned.length) return cleaned.length;
        rafRef.current = requestAnimationFrame(step);
        return next;
      });
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleaned]);

  const visible = cleaned.slice(0, displayedLen);

  if (!visible) return (
    <span className="inline-flex items-center gap-1 py-px">
      {[0, 1, 2].map((i) => (
        <span key={i} className="inline-block w-1.5 h-1.5 rounded-full" style={{
          background: dotColor,
          animation: `greg-bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </span>
  );

  // check for an unclosed code block (streaming in progress)
  const openFences = (visible.match(/```/g) || []).length;
  const hasUnclosedCode = openFences % 2 === 1;

  if (hasUnclosedCode) {
    const lastFence = visible.lastIndexOf("```");
    const before = visible.slice(0, lastFence).trim();
    const fenceRest = visible.slice(lastFence + 3);
    const lang = fenceRest.split("\n")[0]?.trim().toLowerCase() ?? "";
    const isDiagram = lang === "mermaid";
    return (
      <>
        {before && (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as never}>{before}</ReactMarkdown>
        )}
        <div className="flex items-center gap-2 py-2 text-(--g-text-dim)">
          <svg className="animate-spin inline-block w-3.5 h-3.5" width={14} height={14} viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20 12" />
          </svg>
          <span className="text-sm italic">{isDiagram ? "diagramming..." : "coding..."}</span>
        </div>
      </>
    );
  }

  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components as never}>{visible}</ReactMarkdown>
  );
};

// ---------------------------------------------------------------------------
// LiDropdown
// ---------------------------------------------------------------------------

/**
 * Collapsible list item — shows a summary line, expands to reveal full content on click.
 * Renders as a plain list item when there is no block-level sub-content.
 */
export const LiDropdown = ({ children, index }: LiDropdownProps): JSX.Element => {
  const [open, setOpen] = useState(false);

  if (!hasSubContent(children)) {
    return <li className="list-decimal ml-[1.125rem] mb-0.5">{children as React.ReactNode}</li>;
  }

  const text = (
    getTextFromChildren(children).split("\n")[0] ?? ""
  ).slice(0, 80) ?? `Step ${index + 1}`;

  const handleToggle = (): void => setOpen(!open);

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
export const SectionDropdown = ({ title, body, msgKey, langMap, defaultOpen, isDark }: SectionDropdownProps): JSX.Element => {
  const [open, setOpen] = useState(defaultOpen);
  const components = useMemo(() => mdComponents(msgKey, langMap, isDark), [msgKey, langMap, isDark]);

  if (!body.trim()) {
    return <div className="mb-1.5"><span className="text-xl font-semibold text-(--g-text)">{title}</span></div>;
  }

  const handleToggle = (): void => setOpen(!open);

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
// mdComponents
// ---------------------------------------------------------------------------

/**
 * Builds the react-markdown component map for a given message key and language alias map.
 *
 * @param msgKey - Unique key for the message (for stable code block keys)
 * @param langMap - Map of language aliases to canonical language names
 * @param isDark - Whether dark mode is active
 */
export const mdComponents = (msgKey: number | string, langMap: Record<string, string>, isDark: boolean) => ({
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
// GregMarkdown
// ---------------------------------------------------------------------------

/**
 * Renders assistant markdown, splitting into collapsible section dropdowns when 2+ headings are present.
 */
export const GregMarkdown = memo(({ text, msgKey }: GregMarkdownProps): JSX.Element => {
  const langMap = LANG_MAP;
  const theme = useStore((s) => s.theme);
  const isDark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const components = useMemo(() => mdComponents(msgKey, langMap, isDark), [msgKey, langMap, isDark]);

  // replace code block content with spaces so # comments inside don't match as headings
  const textForScan = text.replace(/```[\s\S]*?```/g, (m) => " ".repeat(m.length));
  const sectionRegex = /^(#{1,3})\s+(.+)$/gm;
  const headings = [...textForScan.matchAll(sectionRegex)];

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
});
