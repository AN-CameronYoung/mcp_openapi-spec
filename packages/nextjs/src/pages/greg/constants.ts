import type { Personality, EndpointCard } from "../../lib/api";

// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------

/**
 * True when the browser supports `field-sizing: content` (Chrome 123+, Firefox 136+).
 * Browsers with support resize textareas natively with no JS layout reflow.
 */
export const supportsFieldSizing: boolean =
  typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  CSS.supports("field-sizing", "content");

// ---------------------------------------------------------------------------
// Tailwind class fragments
// ---------------------------------------------------------------------------

export const collapseBtn = "flex items-center gap-1.5 border-none cursor-pointer bg-transparent";
export const debugEntry = "font-mono text-[0.6875rem] leading-[1.65]";
export const debugGroupLabel = "text-[0.625rem] text-(--g-text-dim) py-2 pb-[0.1875rem] font-mono uppercase tracking-[0.06em]";

// ---------------------------------------------------------------------------
// Sentinel values
// ---------------------------------------------------------------------------

export const EMPTY_DEBUG: Record<string, unknown>[] = [];

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/** Per-million-token pricing for Anthropic models: [input, output]. */
export const ANTHROPIC_PRICING: Record<string, [number, number]> = {
  "claude-opus-4-6": [15, 75],
  "claude-sonnet-4-6": [3, 15],
  "claude-haiku-4-5": [0.80, 4],
  "claude-opus-4": [15, 75],
  "claude-sonnet-4": [3, 15],
  "claude-3-5-sonnet": [3, 15],
  "claude-3-5-haiku": [0.80, 4],
  "claude-3-opus": [15, 75],
};

// ---------------------------------------------------------------------------
// Personality theming
// ---------------------------------------------------------------------------

export const PERSONALITY_COLOR: Record<Personality, string> = {
  greg: "var(--g-green)",
  explanatory: "var(--g-method-put-text)",
  quick: "var(--g-method-post)",
  casual: "var(--g-method-patch)",
};

export const BUBBLE_STYLES: Record<Personality, { bg: string; border: string }> = {
  greg: { bg: "color-mix(in srgb, var(--g-green) 6%, transparent)", border: "color-mix(in srgb, var(--g-green) 20%, transparent)" },
  explanatory: { bg: "color-mix(in srgb, var(--g-method-put) 6%, transparent)", border: "color-mix(in srgb, var(--g-method-put) 20%, transparent)" },
  quick: { bg: "color-mix(in srgb, var(--g-method-post) 6%, transparent)", border: "color-mix(in srgb, var(--g-method-post) 20%, transparent)" },
  casual: { bg: "color-mix(in srgb, var(--g-method-patch) 6%, transparent)", border: "color-mix(in srgb, var(--g-method-patch) 20%, transparent)" },
};

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

export const METHOD_RE = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/\S*|$)/;
export const PARAM_RE = /(\{[a-zA-Z_][a-zA-Z0-9_]*\}|<[a-zA-Z][a-zA-Z0-9_-]*>)/g;
export const PARAM_TEST = /\{[a-zA-Z_][a-zA-Z0-9_]*\}|<[a-zA-Z][a-zA-Z0-9_-]*>/;
export const ENDPOINT_RE = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\/[^\s\n`'")\]]+)/g;

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * Minimum semantic-search score (0-1) for a search-returned endpoint to render
 * as a card. Exact-match lookups bypass this threshold.
 */
export const CARD_SCORE_THRESHOLD = 0.6;

export const DOC_CARD_SCORE_THRESHOLD = 0.72;

// ---------------------------------------------------------------------------
// Text processing
// ---------------------------------------------------------------------------

/** Characters revealed per animation frame (~60fps) during streaming. */
export const REVEAL_CHARS_PER_FRAME = 3;

/** Max chars to keep per assistant message in auto-compact mode. */
export const AUTO_COMPACT_MAX_CHARS = 800;

// ---------------------------------------------------------------------------
// Language aliases
// ---------------------------------------------------------------------------

/** Hoisted language alias map — stable identity across renders for useMemo deps. */
export const LANG_MAP: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  py: "python",
  sh: "bash",
  yml: "yaml",
};

// ---------------------------------------------------------------------------
// Greetings
// ---------------------------------------------------------------------------

export const GREG_GREETINGS: string[] = [
  "greg here. what api u need",
  "yo. greg ready. ask greg thing",
  "greg online. u need endpoint or what",
  "greg awake. what u looking for",
  "sup. greg know ur apis. ask",
  "greg here. tell greg what u need",
  "ok greg ready. go",
];

// ---------------------------------------------------------------------------
// Quick action options
// ---------------------------------------------------------------------------

export const DIAGRAM_OPTIONS: Array<{ label: string; type: string; title: string }> = [
  { label: "Flowchart",    type: "flowchart", title: "flowchart TD — data / service flows" },
  { label: "Sequence",     type: "sequence",  title: "sequenceDiagram — step-by-step call chains" },
  { label: "ER Diagram",   type: "er",        title: "erDiagram — entity / object relationships" },
  { label: "State",        type: "state",     title: "stateDiagram-v2 — resource lifecycle states" },
  { label: "Architecture", type: "c4",        title: "C4Context — which services call which" },
];

export const CODE_OPTIONS: Array<{ label: string; type: string }> = [
  { label: "cURL",       type: "curl" },
  { label: "Python",     type: "python" },
  { label: "JavaScript", type: "javascript" },
];

export const DIAGRAM_PROMPTS: Record<string, string> = {
  flowchart: "show the above as a mermaid flowchart diagram (flowchart TD). Include the actual endpoint methods and paths (e.g. GET /users/{id}) as node labels — do not use generic descriptions.",
  sequence:  "show the above as a mermaid sequence diagram (sequenceDiagram). Label each arrow with the actual HTTP method and path (e.g. POST /orders) — do not use generic descriptions.",
  er:        "show the above as a mermaid ER diagram (erDiagram). Use the actual resource names from the API paths and include the key fields from request/response schemas.",
  state:     "show the above as a mermaid state diagram (stateDiagram-v2). Label transitions with the actual endpoint that triggers each state change (e.g. PUT /orders/{id}/cancel).",
  c4:        "show the above as a mermaid C4 context diagram (C4Context). Label each relationship with the actual endpoint paths being called.",
};

export const CODE_PROMPTS: Record<string, string> = {
  curl:       "show me cURL for the above",
  python:     "show me Python for the above",
  javascript: "show me JavaScript (no TypeScript types) for the above",
};

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

/** Filters endpoints below the card score threshold. */
export const relevantEndpoints = (eps: EndpointCard[]): EndpointCard[] =>
  eps.filter((ep) => (ep.score ?? 0) >= CARD_SCORE_THRESHOLD);
