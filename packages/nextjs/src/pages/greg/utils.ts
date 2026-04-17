import type React from "react";

import type { Personality } from "../../lib/api";
import type { ToolCallEntry } from "./types";
import {
  ANTHROPIC_PRICING,
  AUTO_COMPACT_MAX_CHARS,
  ENDPOINT_RE,
  GREG_GREETINGS,
  METHOD_RE,
  PARAM_TEST,
} from "./constants";

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

/**
 * Returns a formatted USD cost string for a Claude API call, or null if the model is unrecognised.
 *
 * @param model - The model ID string
 * @param usage - Input and output token counts
 */
export const estimateCost = (model: string | undefined, usage: { input: number; output: number }): string | null => {
  if (!model || !model.startsWith("claude")) return null;

  // match longest key first so "claude-3-5-sonnet" beats "claude-3"
  const key = Object.keys(ANTHROPIC_PRICING)
    .sort((a, b) => b.length - a.length)
    .find((k) => model.startsWith(k));
  if (!key) return null;

  const [inputRate, outputRate] = ANTHROPIC_PRICING[key]!;
  const cost = (usage.input * inputRate + usage.output * outputRate) / 1_000_000;

  if (cost === 0) return "0.000000";

  // 4 significant figures after any leading zeros
  const magnitude = Math.floor(Math.log10(cost));
  const decimals = Math.min(Math.max(2, 2 - magnitude + 3), 8);

  return cost.toFixed(decimals);
};

// ---------------------------------------------------------------------------
// Text splitting / cleaning
// ---------------------------------------------------------------------------

/**
 * Splits text on fenced code blocks and inline backtick spans, yielding
 * alternating [prose, code, prose, code, ...] segments.
 *
 * @param text - Raw text to split
 */
export const splitOnCode = (text: string): string[] =>
  text.split(/(```[\s\S]*?```|`[^`\n]*`)/);

/**
 * Streaming-time stripper: drops inline control tags so they don't flash mid-stream.
 *
 * @param raw - Raw streaming text
 */
export const stripStreamTags = (raw: string): string =>
  raw
    .replace(/<endpoint[^>]*\/?>/g, "")
    .replace(/<quickActions[^>]*\/?>/g, "")
    .replace(/<followups>[\s\S]*?<\/followups>/g, "")
    .replace(/^(#{1,6}|[-*+]) \*\*(.*?)\*\*/gm, "$1 $2");

/**
 * Normalises raw LLM output: strips endpoint tags, unwraps markdown tables from code fences,
 * and converts single newlines to paragraph breaks while preserving code blocks and list structure.
 *
 * @param raw - The raw LLM text string
 */
export const cleanText = (raw: string): string => {
  // first pass: strip control tags and unwrap fake table code blocks
  const pre = raw
    .replace(/<endpoint[^>]*\/?>/g, "")
    .replace(/<quickActions[^>]*\/?>/g, "")
    .replace(/<followups>[\s\S]*?<\/followups>/g, "")
    .replace(/```[^\n]*\n([\s\S]*?)```/g, (match, inner: string) => {
      const lines = inner.trim().split("\n").filter((l: string) => l.trim());
      const isTable = lines.length >= 2 && lines.every((l: string) => l.trimStart().startsWith("|"));
      return isTable ? inner.trim() : match;
    });

  // prose-only transforms: apply only outside code blocks/inline code
  const proseTransform = (s: string): string =>
    s
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^(#{1,6}|[-*+]) \*\*(.*?)\*\*/gm, "$1 $2")
      .replace(/:([A-Z])/g, ":\n\n$1")
      .replace(/([.!?)])\s+([A-Z][a-z]+ \w+:)/g, "$1\n\n$2");

  const text = splitOnCode(pre)
    .map((part, i) => (i % 2 === 1 ? part : proseTransform(part)))
    .join("")
    .trim();

  // second pass: convert single newlines to doubles in prose segments only
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

// ---------------------------------------------------------------------------
// React helpers
// ---------------------------------------------------------------------------

/**
 * Returns the first string child from a React node array.
 *
 * @param children - React children to inspect
 */
export const getTextFromChildren = (children: React.ReactNode): string => {
  const nodes = Array.isArray(children) ? children : [children];
  return nodes.find((c) => typeof c === "string") ?? "";
};

/**
 * Returns a stable numeric hash string for the given string, for use as a React key.
 *
 * @param s - The string to hash
 */
export const stableKey = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return String(h >>> 0);
};

/**
 * Returns true if children contain any block-level element (paragraph, list, etc.)
 * indicating there is sub-content worth collapsing.
 *
 * @param children - React children to inspect
 */
export const hasSubContent = (children: React.ReactNode): boolean => {
  const BLOCK = new Set(["p", "ul", "ol", "blockquote", "pre", "table", "div"]);
  const nodes = Array.isArray(children) ? children : [children];
  return nodes.some((c) => c && typeof c === "object" && "type" in (c as React.ReactElement) && BLOCK.has((c as React.ReactElement).type as string));
};

// ---------------------------------------------------------------------------
// API path detection
// ---------------------------------------------------------------------------

/**
 * Returns true if the given inline code string looks like an API path.
 *
 * @param code - The inline code text
 */
export const isApiPath = (code: string): boolean => {
  if (METHOD_RE.test(code)) return true;
  if (code.startsWith("/") && PARAM_TEST.test(code)) return true;
  return false;
};

// ---------------------------------------------------------------------------
// Greetings
// ---------------------------------------------------------------------------

/**
 * Returns the appropriate greeting string for the active personality.
 *
 * @param personality - The active chat personality
 */
export const getGreeting = (personality: Personality): string => {
  if (personality === "explanatory") return "Ready to explain your APIs in depth. What would you like to understand?";
  if (personality === "quick") return "What can I help you with?";
  if (personality === "casual") return "ok";
  return GREG_GREETINGS[Math.floor(Math.random() * GREG_GREETINGS.length)]!;
};

// ---------------------------------------------------------------------------
// Message compaction
// ---------------------------------------------------------------------------

/**
 * Strips code blocks from text, preserving any API endpoint references found inside.
 *
 * @param text - The text to strip code blocks from
 */
export const stripCodeBlocks = (text: string): string =>
  text
    .replace(/```[\s\S]*?```/g, (block) => {
      const endpoints = [...block.matchAll(ENDPOINT_RE)].map((m) => `\`${m[1]} ${m[2]}\``);
      return endpoints.length > 0 ? `(${endpoints.join(", ")})` : "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * Aggressively compacts an assistant message for inclusion in API history.
 * Strips code blocks first, then truncates long prose to AUTO_COMPACT_MAX_CHARS.
 *
 * @param text - The assistant message text
 */
export const compactMessage = (text: string): string => {
  const stripped = stripCodeBlocks(text);
  if (stripped.length <= AUTO_COMPACT_MAX_CHARS) return stripped;
  const cutoff = stripped.lastIndexOf(" ", AUTO_COMPACT_MAX_CHARS);
  return stripped.slice(0, cutoff > 0 ? cutoff : AUTO_COMPACT_MAX_CHARS) + "\n[…]";
};

// ---------------------------------------------------------------------------
// Debug trace parsing
// ---------------------------------------------------------------------------

/**
 * Extracts structured tool call entries from raw debug event objects.
 *
 * @param debug - Array of debug event records
 */
export const extractToolCallEntries = (debug: Record<string, unknown>[]): ToolCallEntry[] => {
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

// ---------------------------------------------------------------------------
// Heading utilities
// ---------------------------------------------------------------------------

/**
 * Converts a heading string into a URL-safe slug.
 *
 * @param text - The heading text to slugify
 */
export const slugifyHeading = (text: string): string =>
  text.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-");

/**
 * Returns the page index that contains the given heading, or 0 if not found.
 *
 * @param pages - Array of page content strings
 * @param heading - The heading text to search for
 */
export const findPageWithHeading = (pages: string[], heading: string): number => {
  const slug = slugifyHeading(heading);
  const idx = pages.findIndex((page) =>
    page.split("\n").some((line) => {
      const m = line.match(/^#{1,6}\s+(.+)$/);
      return m ? slugifyHeading(m[1]!) === slug : false;
    }),
  );
  return idx >= 0 ? idx : 0;
};
