import type React from "react";

import type { EndpointCard, DocCard, Personality } from "../../lib/api";
import type { ChatMsg } from "../../store/store";

// ---------------------------------------------------------------------------
// Chat list
// ---------------------------------------------------------------------------

/** Discriminated union for items in the chat message list (messages + context boundaries). */
export type ChatListItem =
  | { kind: "message"; msg: ChatMsg; msgIndex: number }
  | { kind: "boundary" };

// ---------------------------------------------------------------------------
// Small component props
// ---------------------------------------------------------------------------

/** Props for the clipboard copy icon button. */
export type CopyBtnProps = {
  text: string;
};

/** Props for the styled chat input container. */
export type InputBoxWrapperProps = {
  children: React.ReactNode;
};

/** Props for the collapsible syntax-highlighted code block. */
export type CodeDropdownProps = {
  code: string;
  lang: string;
  lineCount: number;
  blockKey: string;
};

/** Props for the streaming text component with character-reveal animation. */
export type StreamingTextProps = {
  text: string;
  personality?: Personality;
  msgKey: number | string;
};

/** Props for the colour-coded API path renderer. */
export type ApiPathCodeProps = {
  code: string;
};

/** Props for the collapsible numbered list item. */
export type LiDropdownProps = {
  children?: React.ReactNode;
  index: number;
};

/** Props for the collapsible markdown section with a heading toggle. */
export type SectionDropdownProps = {
  title: string;
  body: string;
  msgKey: number | string;
  langMap: Record<string, string>;
  defaultOpen: boolean;
  isDark: boolean;
  id?: string;
};

/** Props for the assistant markdown renderer with section collapsing. */
export type GregMarkdownProps = {
  text: string;
  msgKey: number | string;
};

/** Props for the collapsible endpoint card list. */
export type EndpointDropdownProps = {
  endpoints: EndpointCard[];
  onSelect: (ep: EndpointCard) => void;
};

/** Props for the debug trace panel. */
export type DebugPanelProps = {
  entries: Record<string, unknown>[];
  model?: string;
  compactedTokens?: number;
  compactedHistory?: Array<{ role: string; content: string }>;
  onClose: () => void;
};

/** Props for the debug trace entry list within DebugPanel. */
export type DebugPanelEntriesProps = {
  entries: Record<string, unknown>[];
};

/** Props for the double-check verification badge. */
export type VerificationBadgeProps = {
  text: string;
  usage?: { input: number; output: number };
  msgKey: number | string;
  streaming?: boolean;
};

/** Props for a single chat message bubble. */
export type ChatMessageProps = {
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
};

/** Props for the Swagger/OpenAPI side panel. */
export type SwaggerPanelProps = {
  anchor: { api: string; method?: string; path?: string } | null;
  onClose: () => void;
};

/** Parsed heading section used by GregMarkdown's section dropdown logic. */
export type HeadingSection = {
  preamble?: string;
  items: {
    title: string;
    body: string;
  }[];
};

/** Props for the collapsible doc card list. */
export type DocDropdownProps = {
  docs: DocCard[];
  onSelect: (dc: DocCard) => void;
};

/** Props for the quick action bar (diagram + code dropdowns). */
export type QuickActionBarProps = {
  msgText: string;
  msgIdx: number;
  onQuickAction: (msgIdx: number, action: "diagram" | "code", subType?: string) => void;
  onFork?: (msgIdx: number) => void;
};

/** Parsed tool call entry extracted from debug events. */
export type ToolCallEntry = {
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
};

/** Props for the markdown docs side panel. */
export type DocsSidePanelProps = {
  onClose: () => void;
  anchor?: { docName: string; heading: string } | null;
};
