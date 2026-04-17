"use client";

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import { useGroupRef } from "react-resizable-panels";
import type { Layout } from "react-resizable-panels";
import { useShallow } from "zustand/react/shallow";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";

import { Ic } from "../lib/icons";
import { streamChat, listModels, fetchSuggestions, generateFollowUpSuggestions, getEndpoint } from "../lib/api";
import type { EndpointCard, DocCard, Personality } from "../lib/api";
import { cn } from "../lib/utils";
import { useStore, getActiveConversation } from "../store/store";
import type { ChatMsg } from "../store/store";
import { Button } from "../components/ui/button";
import { TabBar } from "../components/chat/TabBar";
import { ForkContext } from "../components/chat/ForkContext";
import { usePanelRef } from "react-resizable-panels";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "../components/ui/resizable";

import type { ChatListItem } from "./greg/types";
import {
  supportsFieldSizing,
  PERSONALITY_COLOR,
  EMPTY_DEBUG,
  DIAGRAM_PROMPTS,
  CODE_PROMPTS,
  relevantEndpoints,
} from "./greg/constants";
import { getGreeting, stripCodeBlocks, compactMessage, cleanText, slugifyHeading } from "./greg/utils";
import { ChatMessage, TokenCounter, InputBoxWrapper } from "./greg/chat-components";
import { DebugPanel, SwaggerPanel, DocsSidePanel } from "./greg/panel-components";

SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("javascript", typescript);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("yaml", yaml);

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

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

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
    const inherited = parentConversation!.messages.slice(0, activeConversation.forkIndex! + 1);
    return [...inherited, ...local];
  }, [chatMessages, contextBoundaries, isBranchActive, parentConversation, activeConversation.forkIndex]);

  const doubleCheck = false;
  const isGregLike = personality === "greg";

  // ---------------------------------------------------------------------------
  // Local state
  // ---------------------------------------------------------------------------

  const [greetingGif, setGreetingGif] = useState<string | null>(null);
  const [loadingGif, setLoadingGif] = useState<string | null>(null);
  const [greeting, setGreetingText] = useState<string>("");
  const [models, setModels] = useState<Array<{ id: string; name: string; provider: string }>>([]);
  const [sidebarView, setSidebarView] = useState<"history" | "map" | null>(() => { try { const v = localStorage.getItem("greg-sidebar-view"); return (v === "history" || v === "map") ? v : null; } catch { return null; } });
  const [sidebarWidth, setSidebarWidth] = useState(() => { try { return parseInt(localStorage.getItem("greg-sidebar-width") ?? "") || 260; } catch { return 260; } });
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set());
  const [renamingTitle, setRenamingTitle] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [historySearch, setHistorySearch] = useState(() => { try { return localStorage.getItem("greg-history-search") ?? ""; } catch { return ""; } });
  const [debugMsgIdx, setDebugMsgIdx] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [followUpSuggestions, setFollowUpSuggestions] = useState<string[]>([]);
  const [generatingFollowUps, setGeneratingFollowUps] = useState(false);
  const [autoCompact, setAutoCompact] = useState(true);
  const autoCompactRef = useRef(autoCompact);
  autoCompactRef.current = autoCompact;
  const [chatZoom, setChatZoom] = useState(1);
  const [personalityOpen, setPersonalityOpen] = useState(false);
  const personalityRef = useRef<HTMLDivElement>(null);
  const [apisOpen, setApisOpen] = useState(() => { try { return localStorage.getItem("greg-apis-open") === "true"; } catch { return false; } });
  const [docsOpen, setDocsOpen] = useState(() => { try { return localStorage.getItem("greg-docs-open") === "true"; } catch { return false; } });
  const panelOpen = apisOpen || docsOpen;
  const [panelAnchor, setPanelAnchor] = useState<{ api: string; method?: string; path?: string } | null>(null);
  const [panelDocAnchor, setPanelDocAnchor] = useState<{ docName: string; heading: string } | null>(null);
  const abortRef = useRef<{ controller: AbortController; convId: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [userScrolled, setUserScrolled] = useState(false);
  const userScrolledRef = useRef(false);

  // ---------------------------------------------------------------------------
  // Chat list items
  // ---------------------------------------------------------------------------

  const chatItems = useMemo<ChatListItem[]>(() => {
    const items: ChatListItem[] = [];
    for (let i = 0; i < chatMessages.length; i++) {
      if (contextBoundaries.includes(i)) items.push({ kind: "boundary" });
      items.push({ kind: "message", msg: chatMessages[i]!, msgIndex: i });
    }
    if (contextBoundaries.includes(chatMessages.length)) items.push({ kind: "boundary" });
    return items;
  }, [chatMessages, contextBoundaries]);

  type ChatHeading = { msgIndex: number; level: number; text: string; id: string };
  const chatHeadings = useMemo((): ChatHeading[] => {
    const results: ChatHeading[] = [];
    for (const item of chatItems) {
      if (item.kind !== "message" || item.msg.role !== "assistant" || !item.msg.text) continue;
      const safe = item.msg.text.replace(/```[\s\S]*?```/g, (m) => " ".repeat(m.length));
      for (const m of safe.matchAll(/^(#{1,3})\s+(.+)$/gm)) {
        const level = m[1]!.length;
        const text = m[2]!.trim();
        results.push({ msgIndex: item.msgIndex, level, text, id: `msg-${item.msgIndex}-h-${slugifyHeading(text)}` });
      }
    }
    return results;
  }, [chatItems]);

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

  // ---------------------------------------------------------------------------
  // Effects — localStorage persistence
  // ---------------------------------------------------------------------------

  useEffect(() => { try { localStorage.setItem("greg-chat-zoom", String(chatZoom)); } catch {} }, [chatZoom]);
  useEffect(() => {
    try {
      const savedCompact = localStorage.getItem("greg-auto-compact");
      if (savedCompact !== null) setAutoCompact(savedCompact !== "false");
      const savedZoom = parseFloat(localStorage.getItem("greg-chat-zoom") ?? "");
      if (savedZoom > 0) setChatZoom(savedZoom);
    } catch {}
  }, []);
  useEffect(() => { listModels().then(setModels).catch(() => {}); }, []);
  useEffect(() => { fetchSuggestions().then(setSuggestions).catch(() => {}); }, []);
  useEffect(() => { setGreetingText(getGreeting(personality)); }, [personality]);
  useEffect(() => { try { localStorage.setItem("greg-auto-compact", String(autoCompact)); } catch {} }, [autoCompact]);
  useEffect(() => { try { localStorage.setItem("greg-apis-open", String(apisOpen)); } catch {} }, [apisOpen]);
  useEffect(() => { try { localStorage.setItem("greg-docs-open", String(docsOpen)); } catch {} }, [docsOpen]);
  useEffect(() => { try { localStorage.setItem("greg-sidebar-view", sidebarView ?? ""); } catch {} }, [sidebarView]);
  useEffect(() => {
    try { if (selectedProvider === "ollama" && localStorage.getItem("greg-auto-compact") === null) setAutoCompact(true); } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProvider]);
  useEffect(() => {
    if (!personalityOpen) return;
    const handler = (e: MouseEvent): void => {
      if (personalityRef.current && !personalityRef.current.contains(e.target as Node)) setPersonalityOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [personalityOpen]);

  // ---------------------------------------------------------------------------
  // Resizable panel persistence
  // ---------------------------------------------------------------------------

  const innerGroupRef = useGroupRef();
  const outerGroupRef = useGroupRef();
  const swaggerPanelRef = usePanelRef();
  const debugPanelRef = usePanelRef();
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

  useEffect(() => {
    const p = swaggerPanelRef.current;
    if (!p) return;
    if (panelOpen) { if (p.isCollapsed()) p.resize(`${swaggerSizeRef.current}%`); }
    else p.collapse();
  }, [panelOpen]);

  useEffect(() => {
    const p = debugPanelRef.current;
    if (!p) return;
    if (debugMsgIdx !== null) { if (p.isCollapsed()) p.resize(`${debugSizeRef.current}%`); }
    else p.collapse();
  }, [debugMsgIdx]);

  // ---------------------------------------------------------------------------
  // Handlers — sidebar, scroll, panels
  // ---------------------------------------------------------------------------

  const handleSidebarResizeStart = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const sidebar = sidebarRef.current;
    if (sidebar) sidebar.style.transition = "none";
    const onMove = (ev: MouseEvent): void => {
      const w = Math.max(180, Math.min(520, startW + ev.clientX - startX));
      if (sidebar) sidebar.style.width = `${w}px`;
    };
    const onUp = (ev: MouseEvent): void => {
      const w = Math.max(180, Math.min(520, startW + ev.clientX - startX));
      if (sidebar) sidebar.style.transition = "";
      setSidebarWidth(w);
      try { localStorage.setItem("greg-sidebar-width", String(w)); } catch {}
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const handleHistorySearch = (q: string): void => { setHistorySearch(q); try { localStorage.setItem("greg-history-search", q); } catch {} };
  const toggleChatSelection = (id: string): void => setSelectedChatIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const clearChatSelection = (): void => setSelectedChatIds(new Set());
  const deleteSelectedChats = (): void => { selectedChatIds.forEach((id) => deleteChat(id)); clearChatSelection(); };

  const scrollToBottom = useCallback((): void => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    userScrolledRef.current = false;
    setUserScrolled(false);
  }, []);

  const scrollToHeading = useCallback((id: string): void => {
    const el = document.getElementById(id);
    const container = scrollRef.current;
    if (!el || !container) return;
    const elTop = el.getBoundingClientRect().top;
    const containerTop = container.getBoundingClientRect().top;
    // offset 56px: 40px toolbar height + 16px breathing room
    container.scrollBy({ top: elTop - containerTop - 56, behavior: "smooth" });
  }, []);

  const handleScroll = useCallback((): void => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    userScrolledRef.current = !atBottom;
    setUserScrolled(!atBottom);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    userScrolledRef.current = false;
    setUserScrolled(false);
  }, [activeConversationId]);

  useEffect(() => {
    if (userScrolledRef.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages]);

  const fetchGreetingGif = useCallback((): void => {
    fetch("/api/greeting-gif").then((r) => r.json()).then((d) => setGreetingGif(d.url ?? null)).catch(() => {});
  }, []);
  useEffect(() => { if (isGregLike) fetchGreetingGif(); }, []);

  const handleNewChat = useCallback((): void => {
    newChat();
    setGreetingGif(null);
    fetchSuggestions().then(setSuggestions).catch(() => {});
    if (isGregLike) fetchGreetingGif();
  }, [isGregLike, newChat, fetchGreetingGif]);

  const handleSelectEndpoint = useCallback((ep: EndpointCard): void => {
    setPanelAnchor({ api: ep.api, method: ep.method, path: ep.path });
    setApisOpen(true);
  }, []);

  const handleSelectDoc = useCallback((dc: DocCard): void => {
    setPanelDocAnchor({ docName: dc.doc_name, heading: dc.heading });
    setDocsOpen(true);
  }, []);

  const handleCloseApis = useCallback((): void => { setApisOpen(false); setPanelAnchor(null); }, []);
  const handleCloseDocs = useCallback((): void => setDocsOpen(false), []);
  const handleCloseDebug = useCallback((): void => setDebugMsgIdx(null), []);

  const handleCompact = useCallback((): void => {
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

  // ---------------------------------------------------------------------------
  // Chat send / retry / quick-action handlers
  // ---------------------------------------------------------------------------

  const handleSendRef = useRef<((overrideText?: string, baseMessages?: ChatMsg[]) => Promise<void>) | null>(null);
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
    setContextBoundaries(bounds.filter((b) => b <= msgIdx));
    handleSendRef.current?.(msg.text, trimmed);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleQuickAction = useCallback((msgIdx: number, action: "diagram" | "code", subType?: string): void => {
    const { chatLoading: loading, chatMessages: msgs } = handlerDepsRef.current;
    if (loading) return;
    const prompt = action === "diagram"
      ? (DIAGRAM_PROMPTS[subType ?? "flowchart"] ?? DIAGRAM_PROMPTS["flowchart"]!)
      : (CODE_PROMPTS[subType ?? "javascript"] ?? CODE_PROMPTS["javascript"]!);
    const context = msgs.slice(0, msgIdx + 1);
    handleSendRef.current?.(prompt, context);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const handleFork = useCallback((msgIdx: number): void => {
    const id = forkConversation(msgIdx);
    if (id) setFollowUpSuggestions([]);
  }, [forkConversation]);

  const handleSwitchTab = useCallback((id: string): void => {
    switchConversation(id);
    setFollowUpSuggestions([]);
  }, [switchConversation]);

  const handleDelete = useCallback((msgIdx: number): void => { deleteMessage(msgIdx); }, [deleteMessage]);

  const handleCloseTab = useCallback((id: string): void => {
    const pending = abortRef.current;
    if (pending && pending.convId === id) {
      pending.controller.abort();
      abortRef.current = null;
      setChatLoading(false);
    }
    closeConversation(id);
  }, [closeConversation, setChatLoading]);

  // ---------------------------------------------------------------------------
  // handleSend — core streaming chat logic
  // ---------------------------------------------------------------------------

  const handleSend = async (overrideText?: string, baseMessages?: ChatMsg[]): Promise<void> => {
    const text = (overrideText ?? inputRef.current?.value ?? "").trim();
    if (!text || chatLoading) return;

    if (inputRef.current) { inputRef.current.value = ""; inputRef.current.style.height = "auto"; }

    if (text === "/clear") {
      addContextBoundary();
      setFollowUpSuggestions([]);
      setGeneratingFollowUps(false);
      return;
    }
    setUserScrolled(false);
    setFollowUpSuggestions([]);
    setGeneratingFollowUps(false);
    setLoadingGif(null);
    const targetConvId = activeConversationId;
    addChatMessageTo(targetConvId, { role: "user", text, personality });
    addChatMessageTo(targetConvId, { role: "assistant", text: "", streaming: true, ...(selectedModel && { model: selectedModel }), personality });
    setChatLoading(true);
    if (isGregLike) {
      fetch("/api/greeting-gif").then((r) => r.json()).then((d) => setLoadingGif(d.url ?? null)).catch(() => {});
    }

    const lastBoundary = contextBoundaries.length > 0 ? contextBoundaries[contextBoundaries.length - 1]! : 0;
    const localBase = baseMessages ?? chatMessages.slice(lastBoundary);
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

    let rafPending = false;
    const flushText = (): void => {
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
            for (const ep of event.data ?? []) {
              const key = `${ep.method}:${ep.path}:${ep.api}`;
              const existing = endpointMap.get(key);
              if (!existing || (ep.score ?? 0) > (existing.score ?? 0)) endpointMap.set(key, ep);
            }
            break;
          case "docs":
            for (const dc of event.docCards ?? []) {
              const key = `${dc.doc_name}:${dc.heading}`;
              const existing = docCardMap.get(key);
              if (!existing || (dc.score ?? 0) > (existing.score ?? 0)) docCardMap.set(key, dc);
            }
            break;
          case "docrefs" as string: {
            const names = (event as { docNames?: string[] }).docNames ?? [];
            for (const name of names) citedDocNames.add(name);
            break;
          }
          case "followups": {
            const list = event.followups ?? [];
            if (list.length > 0) { setFollowUpSuggestions(list); setGeneratingFollowUps(false); }
            break;
          }
          case "verification_text":
            verificationText = event.text ?? "";
            updateLastAssistantIn(targetConvId, (m) => ({ ...m, verificationText, verificationStreaming: false }));
            break;
          case "error":
            accumulated += `\n[error: ${event.error}]`;
            updateLastAssistantIn(targetConvId, (m) => ({ ...m, text: accumulated }));
            break;
          case "debug":
            debugLog.push(event as unknown as Record<string, unknown>);
            if (event.event === "tool_call" || event.event === "tool_result" || event.event === "round") {
              updateLastAssistantIn(targetConvId, (m) => ({
                ...m,
                debug: [...(m.debug ?? []), event as unknown as Record<string, unknown>],
              }));
            }
            if (event.event === "verification_start") {
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
    } catch {
      accumulated += `\n[connection error]`;
      updateLastAssistantIn(targetConvId, (m) => ({ ...m, text: accumulated }));
    }

    abortRef.current = null;
    const dedupedEndpoints = [...endpointMap.values()];
    const allDocCards = citedDocNames.size > 0
      ? [...docCardMap.values()].filter((dc) => citedDocNames.has(dc.doc_name))
      : [...docCardMap.values()].filter((dc) => (dc.score ?? 0) >= 0.8);

    const INLINE_ROUTE_RE = /\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+(\/[^\s`'")\]\n]+)/g;
    const mentionedKeys = new Set<string>();
    let rm: RegExpExecArray | null;
    while ((rm = INLINE_ROUTE_RE.exec(accumulated)) !== null) {
      mentionedKeys.add(`${rm[1]}:${rm[2]}`);
    }

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
    const allEndpoints = [
      ...dedupedEndpoints
        .map((ep) => mentionedKeys.has(`${ep.method}:${ep.path}`) ? { ...ep, score: 1 } : ep)
        .filter((ep) => (ep.score ?? 0) >= 1),
      ...lookedUp,
    ];

    updateLastAssistantIn(targetConvId, (m) => ({
      ...m,
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
      ...(autoCompactRef.current ? { compactedTokens: autoCompactedTokens, compactedHistory: history } : {}),
    }));

    saveChat();
    setChatLoading(false);
  };

  handleSendRef.current = handleSend;
  const handleSuggestion = useCallback((q: string): void => { handleSendRef.current?.(q); }, []);

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const hasChatMessages = chatMessages.length > 0;
  const hasSelection = selectedChatIds.size > 0;

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------

  return (
    <div className="flex h-[calc(100%-2.75rem)]">
      {/* Persistent icon strip */}
      <div className="shrink-0 flex flex-col items-center gap-1 pt-2 pb-2 w-11 border-r border-(--g-border) bg-(--g-surface)">
        <button
          onClick={() => setSidebarView((v) => v === "history" ? null : "history")}
          title={sidebarView === "history" ? "Close history" : "Open history"}
          className={cn(
            "flex items-center justify-center w-8 h-8 rounded-md transition-colors",
            sidebarView === "history" ? "text-(--g-accent) bg-(--g-surface-hover)" : "text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover)",
          )}
        >
          {Ic.clock(18)}
        </button>
        <button
          onClick={() => setSidebarView((v) => v === "map" ? null : "map")}
          title={sidebarView === "map" ? "Close chat map" : "Open chat map"}
          className={cn(
            "flex items-center justify-center w-8 h-8 rounded-md transition-colors",
            sidebarView === "map" ? "text-(--g-accent) bg-(--g-surface-hover)" : "text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover)",
          )}
        >
          {Ic.map(18)}
        </button>
      </div>

      {/* Sliding panel — history or map */}
      <div
        ref={sidebarRef}
        className="relative shrink-0 overflow-hidden border-r border-(--g-border) bg-(--g-surface) transition-[width] duration-200"
        style={{ width: sidebarView !== null ? sidebarWidth : 0 }}
      >
        {sidebarView === "history" && (
          <div className="flex flex-col w-full h-full overflow-hidden">
            <div className="flex items-center px-3 py-[0.6875rem] border-b border-(--g-border) shrink-0 gap-1.5">
              {hasSelection ? (
                <>
                  <span className="flex-1 text-[0.625rem] font-medium text-(--g-text-dim)">{selectedChatIds.size} selected</span>
                  <button onClick={deleteSelectedChats} title="Delete selected" className="flex items-center gap-1 h-6 px-2 rounded-[6px] text-[0.625rem] font-medium text-red-400 border border-red-400/30 hover:bg-red-400/10 transition-colors duration-150">{Ic.x(10)} Delete</button>
                  <button onClick={clearChatSelection} title="Clear selection" className="flex items-center justify-center w-6 h-6 rounded-[6px] border border-(--g-border-hover) text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors duration-150">{Ic.x(12)}</button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-[0.625rem] font-medium uppercase tracking-[0.1em] text-(--g-text-dim)">Chats</span>
                  <button onClick={handleNewChat} title="New chat" className="flex items-center justify-center w-6 h-6 rounded-[6px] border border-(--g-border-hover) text-(--g-text-dim) hover:border-(--g-border-hover) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors duration-150">{Ic.plus(14)}</button>
                </>
              )}
            </div>
            <div className="px-2.5 py-2 shrink-0">
              <div className="relative">
                <span className="absolute left-[9px] top-1/2 -translate-y-1/2 text-(--g-text-dim) pointer-events-none">{Ic.search(13)}</span>
                <input type="text" value={historySearch} onChange={(e) => handleHistorySearch(e.target.value)} placeholder="Search chats…" className="w-full h-[30px] pl-[30px] pr-2.5 rounded-[6px] text-[0.75rem] bg-(--g-surface) border border-(--g-border) text-(--g-text) placeholder:text-(--g-text-dim) outline-none focus:border-(--g-border-hover) focus:bg-(--g-surface-hover) transition-colors" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-1.5 pb-3 [scrollbar-width:thin] [scrollbar-color:var(--g-surface-hover)_transparent]">
              {groupedHistory.length === 0 && (
                <p className="px-2 pt-6 text-center text-[0.6875rem] tracking-[0.02em] text-(--g-text-dim)">
                  {historySearch ? "No chats match your search" : "No chats yet"}
                </p>
              )}
              {groupedHistory.map((group) => (
                <div key={group.label}>
                  <div className="px-1 pt-3 pb-[5px] text-[0.625rem] font-medium uppercase tracking-[0.08em] text-(--g-text-dim)">{group.label}</div>
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
                    return (
                      <div
                        key={chat.id}
                        onClick={() => { if (hasSelection) { toggleChatSelection(chat.id); return; } loadChat(chat.id); setFollowUpSuggestions([]); }}
                        className={cn(
                          "group/item relative flex items-center gap-2 mb-px pl-1.5 pr-2 py-[7px] rounded-[9px] border cursor-pointer transition-colors duration-100",
                          isSelected ? "bg-(--g-surface) border-(--g-accent)/40" : isActive ? "bg-(--g-surface) border-(--g-border-hover)" : "border-transparent hover:bg-(--g-surface) hover:border-(--g-border-hover)",
                        )}
                      >
                        <button onClick={(e) => { e.stopPropagation(); toggleChatSelection(chat.id); }} className={cn("shrink-0 flex items-center justify-center w-4 h-4 rounded-[4px] border transition-all duration-100", isSelected ? "bg-(--g-accent) border-(--g-accent)" : "border-(--g-border-hover) opacity-0 group-hover/item:opacity-100")}>
                          {isSelected && <svg width={9} height={9} viewBox="0 0 10 10" fill="none"><path d="M2 5l2.5 2.5L8 3" stroke="var(--g-bg)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                        </button>
                        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                          {isActive && !isSelected && <span className="absolute left-0 top-[20%] bottom-[20%] w-0.5 rounded-sm bg-(--g-accent)" />}
                          <span className="truncate text-[0.75rem] text-(--g-text) leading-[1.35] pr-6">{chat.title}</span>
                          <span className="text-[0.625rem] tracking-[0.02em] text-(--g-text-dim)">{relTime}</span>
                        </div>
                        {!hasSelection && (
                          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 hidden group-hover/item:flex items-center gap-[3px] bg-(--g-surface-hover) border border-(--g-border) rounded-[6px] p-0.5">
                            <button onClick={(e) => { e.stopPropagation(); deleteChat(chat.id); }} className="flex items-center justify-center w-[22px] h-[22px] rounded text-(--g-text-dim) hover:text-red-400 hover:bg-(--g-surface) transition-colors" title="Delete">{Ic.x(11)}</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
        {sidebarView === "map" && (
          <div className="flex flex-col w-full h-full overflow-hidden">
            <div className="flex items-center px-3 py-[0.6875rem] border-b border-(--g-border) shrink-0">
              <span className="flex-1 text-[0.625rem] font-medium uppercase tracking-[0.1em] text-(--g-text-dim)">Chat Map</span>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2 [scrollbar-width:thin] [scrollbar-color:var(--g-surface-hover)_transparent]">
              {chatHeadings.length === 0 ? (
                <p className="px-2 pt-6 text-center text-[0.6875rem] tracking-[0.02em] text-(--g-text-dim)">No headings in this chat</p>
              ) : (
                chatHeadings.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => scrollToHeading(h.id)}
                    className="w-full text-left py-[5px] pr-2 rounded-[6px] text-[0.75rem] text-(--g-text-muted) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors truncate"
                    style={{ paddingLeft: `${(h.level - 1) * 12 + 8}px` }}
                    title={h.text}
                  >
                    {h.text}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
        <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-10 hover:bg-(--g-accent) transition-colors duration-150 opacity-0 hover:opacity-40" onMouseDown={handleSidebarResizeStart} />
      </div>

      {/* Main area: chat + swagger + debug — all resizable */}
      <ResizablePanelGroup groupRef={outerGroupRef} onLayoutChanged={(l) => { try { localStorage.setItem("rp-greg-outer", JSON.stringify(l)); if ((l[1] ?? 0) > 0) { debugSizeRef.current = l[1]!; localStorage.setItem("greg-debug-size", String(l[1])); } } catch {} }} className="flex flex-1 min-w-0">
        <ResizablePanel id="main" minSize={20}>
          <ResizablePanelGroup groupRef={innerGroupRef} onLayoutChanged={(l) => { try { localStorage.setItem("rp-greg-inner", JSON.stringify(l)); if ((l[1] ?? 0) > 0) { swaggerSizeRef.current = l[1]!; localStorage.setItem("greg-swagger-size", String(l[1])); } } catch {} }}>
            <ResizablePanel id="chat" defaultSize={75} minSize={20}>
              <div className="flex flex-col h-full min-w-0 px-6 pt-2 pb-5" style={chatZoom !== 1 ? { zoom: chatZoom } : undefined}>
                {/* Title bar + zoom/clear controls */}
                <div className="flex items-center gap-2 mb-1 min-w-0 h-8 shrink-0">
                  {activeChatTitle !== null && (
                    <>
                      <span className="shrink-0 text-(--g-text-dim) opacity-40">{Ic.pencil(12)}</span>
                      {renamingTitle ? (
                        <input ref={renameInputRef} value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { const t = renameValue.trim(); if (t && activeChatId) renameChat(activeChatId, t); setRenamingTitle(false); } else if (e.key === "Escape") setRenamingTitle(false); }}
                          onBlur={() => { const t = renameValue.trim(); if (t && activeChatId) renameChat(activeChatId, t); setRenamingTitle(false); }}
                          className="flex-1 min-w-0 bg-transparent border-b border-(--g-accent) text-[0.8125rem] font-medium text-(--g-text) outline-none py-0.5" />
                      ) : (
                        <button onClick={() => { setRenameValue(activeChatTitle); setRenamingTitle(true); setTimeout(() => { renameInputRef.current?.select(); }, 0); }} className="flex-1 min-w-0 text-left text-[0.9375rem] font-semibold text-(--g-text) truncate hover:opacity-80 transition-opacity" title="Click to rename">{activeChatTitle}</button>
                      )}
                    </>
                  )}
                  <div className="ml-auto flex items-center gap-1 shrink-0">
                    <button onClick={() => setChatZoom((z) => Math.max(0.6, parseFloat((z - 0.1).toFixed(1))))} title="Zoom out" className="flex items-center justify-center w-7 h-7 rounded-md text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors">
                      <svg width={16} height={16} viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.3" /><path d="M4.5 6.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                    </button>
                    <span className="text-xs font-mono text-(--g-text-dim) w-8 text-center tabular-nums">{Math.round(chatZoom * 100)}%</span>
                    <button onClick={() => setChatZoom((z) => Math.min(1.6, parseFloat((z + 0.1).toFixed(1))))} title="Zoom in" className="flex items-center justify-center w-7 h-7 rounded-md text-(--g-text-dim) hover:text-(--g-text) hover:bg-(--g-surface-hover) transition-colors">
                      <svg width={16} height={16} viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.3" /><path d="M4.5 6.5h4M6.5 4.5v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                    </button>
                    {chatMessages.length > 0 && (
                      <button onClick={() => { clearChat(); setFollowUpSuggestions([]); }} className="flex items-center gap-1.5 h-7 px-2.5 rounded-md text-sm text-red-400 hover:text-red-300 hover:bg-(--g-surface-hover) transition-colors" title="Clear chat">
                        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-1 gap-5 min-h-0">
                  <div className="relative flex flex-col flex-1 min-w-0">
                    {conversations.length > 1 && (
                      <div className="shrink-0">
                        <TabBar conversations={conversations} activeConversationId={activeConversationId} onSwitch={handleSwitchTab} onClose={handleCloseTab} onRename={renameConversation} />
                      </div>
                    )}

                    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto" onScroll={handleScroll}>
                      {/* Greeting / fork context */}
                      {isBranchActive ? (
                        <ForkContext parentName={parentConversation?.name ?? "Main"} excerpt={forkExcerpt} />
                      ) : (
                        <div className={cn("flex flex-col items-center gap-4 text-(--g-text-dim) px-6", hasChatMessages ? "pt-3 pb-2" : "min-h-full justify-center")}>
                          <img src="https://media0.giphy.com/media/v1.Y2lkPWM4MWI4ODBkMnl2cmJ4ODFic3pwcjNqdGx4eTd0NWZqeHR1Z21jZXk0dmc2NzByeiZlcD12MV9zdGlja2Vyc19zZWFyY2gmY3Q9cw/j0HjChGV0J44KrrlGv/giphy.gif" alt="greg" className="max-h-[45rem] rounded-xl" />
                          <span className="text-lg">{greeting}</span>
                          {suggestions.length > 0 && !hasChatMessages && (
                            <div className="flex flex-wrap justify-center gap-2 max-w-[35rem]">
                              {suggestions.map((s, i) => (
                                <button key={i} onClick={() => handleSuggestion(s)} className="px-3.5 py-1.5 rounded-[1.25rem] border border-(--g-border) bg-(--g-surface) cursor-pointer text-[0.8125rem] text-(--g-text-muted) transition-[border-color,color] duration-150 hover:border-(--g-border-accent) hover:text-(--g-text)">{s}</button>
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
                              msg={item.msg} i={item.msgIndex}
                              onSelectEndpoint={handleSelectEndpoint} onSelectDoc={handleSelectDoc}
                              onShowDebug={setDebugMsgIdx} onRetry={handleRetry} onQuickAction={handleQuickAction}
                              onDelete={handleDelete}
                              {...(isMainActive && { onFork: handleFork })}
                              loadingGif={item.msg.streaming ? loadingGif : null}
                            />
                          </div>
                        );
                      })}

                      {/* Follow-up suggestions */}
                      {(generatingFollowUps || followUpSuggestions.length > 0) && (
                        <div className="w-full max-w-[1000px] mx-auto px-6 pt-3 pb-2">
                          {generatingFollowUps && followUpSuggestions.length === 0 && (
                            <span className="ml-0.5 text-[0.6875rem] text-(--g-text-dim) animate-pulse">generating follow-ups…</span>
                          )}
                          {followUpSuggestions.length > 0 && (
                            <div className="flex flex-col gap-1.5 ml-0.5">
                              {followUpSuggestions.map((s, i) => (
                                <button key={i} onClick={() => handleSuggestion(s)} className="self-start max-w-[70%] px-3 py-1 rounded-[1.25rem] border border-(--g-border) bg-(--g-surface) cursor-pointer text-left text-[0.75rem] text-(--g-text-muted) transition-[border-color,color] duration-150 hover:border-(--g-border-accent) hover:text-(--g-text)">{s}</button>
                              ))}
                              <Button variant="ghost" size="icon-xs" onClick={handleRefreshFollowUps} title="Refresh follow-up suggestions" className={cn("self-start mt-0.5 opacity-40 hover:opacity-100 hover:text-(--g-accent)", generatingFollowUps && "animate-spin opacity-60")} disabled={generatingFollowUps}>
                                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="h-3" />
                    </div>

                    {/* Scroll to bottom */}
                    {userScrolled && (
                      <button onClick={scrollToBottom} className="absolute bottom-[5.625rem] left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-4 py-2 rounded-[1.25rem] border border-(--g-border-accent) bg-(--g-surface) cursor-pointer text-sm text-(--g-accent) shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
                        <svg width={14} height={14} viewBox="0 0 14 14" fill="none"><path d="M3 5.5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        Scroll to bottom
                      </button>
                    )}

                    {/* Input */}
                    <div className="mt-3 shrink-0">
                      <InputBoxWrapper>
                        <textarea
                          ref={inputRef} rows={1}
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
                        <div className="flex items-center gap-2 pt-2" style={{ borderTop: "1px solid var(--g-border)" }}>
                          {/* Personality dropup */}
                          <div className="relative" ref={personalityRef}>
                            <button onClick={() => setPersonalityOpen(!personalityOpen)} className="flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition-colors hover:bg-(--g-surface-hover)" style={{ color: PERSONALITY_COLOR[personality] }}>
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PERSONALITY_COLOR[personality] }} />
                              {personality}
                              <svg width={10} height={10} viewBox="0 0 10 10" fill="none" className={cn("transition-transform duration-150", personalityOpen ? "rotate-180" : "rotate-0")}><path d="M2 6.5l3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </button>
                            {personalityOpen && (
                              <div className="absolute bottom-full mb-1.5 left-0 z-50 min-w-[9rem] rounded-lg border border-(--g-border) bg-(--g-surface) shadow-lg overflow-hidden">
                                {(["greg", "casual", "quick", "explanatory"] as const satisfies Personality[]).map((p, i) => (
                                  <React.Fragment key={p}>
                                    <button onClick={() => { setPersonality(p); setPersonalityOpen(false); }} className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left transition-colors" style={{ color: p === personality ? PERSONALITY_COLOR[p] : "var(--g-text-muted)", background: p === personality ? `color-mix(in srgb, ${PERSONALITY_COLOR[p]} 8%, transparent)` : "transparent" }} onMouseEnter={(e) => { if (p !== personality) (e.currentTarget as HTMLElement).style.background = "var(--g-surface-hover)"; }} onMouseLeave={(e) => { if (p !== personality) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
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
                          <select value={selectedModel || ""} onChange={(e) => { const m = models.find((x) => x.id === e.target.value); if (m) setModel(m.id, m.provider); }} style={{ fieldSizing: "content" } as React.CSSProperties} className="-ml-2 h-8 px-2 rounded-md text-xs text-(--g-text-muted) bg-transparent border-none outline-none cursor-pointer hover:bg-(--g-surface-hover) transition-colors min-w-0 max-w-[14rem] truncate">
                            <option value="">Default model</option>
                            {models.filter((m) => m.provider === "anthropic").length > 0 && <optgroup label="Anthropic">{models.filter((m) => m.provider === "anthropic").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>}
                            {models.filter((m) => m.provider === "ollama").length > 0 && <optgroup label="Ollama">{models.filter((m) => m.provider === "ollama").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>}
                          </select>
                          <TokenCounter chatMessages={tokenCounterMessages} provider={selectedProvider} onCompact={handleCompact} />

                          <span className="flex-1" />

                          <button onClick={() => setAutoCompact((v) => !v)} className="flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition-colors hover:bg-(--g-surface-hover)" style={{ color: autoCompact ? "var(--g-green)" : "var(--g-text-dim)" }} title={autoCompact ? "Auto-compact on" : "Auto-compact off"}>
                            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>
                            <span>Auto-compact</span>
                          </button>

                          <button onClick={() => setApisOpen((v) => !v)} className="flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition-colors hover:bg-(--g-surface-hover)" style={{ color: apisOpen ? "var(--g-accent)" : "var(--g-text-dim)" }} title="Toggle API docs">{Ic.server(14)}<span>APIs</span></button>
                          <button onClick={() => setDocsOpen((v) => !v)} className="flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium transition-colors hover:bg-(--g-surface-hover)" style={{ color: docsOpen ? "var(--g-accent)" : "var(--g-text-dim)" }} title="Toggle markdown docs">{Ic.doc(14)}<span>Docs</span></button>

                          {chatLoading ? (
                            <Button variant="ghost" size="icon" onClick={() => { const pending = abortRef.current; pending?.controller.abort(); abortRef.current = null; setChatLoading(false); if (pending) updateLastAssistantIn(pending.convId, (m) => ({ ...m, streaming: false })); saveChat(); }} className="bg-(--g-danger-muted) text-(--g-danger) h-8 w-8">
                              <svg width={16} height={16} viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="2" /></svg>
                            </Button>
                          ) : (
                            <Button variant="ghost" size="icon" onClick={() => handleSend()} className="bg-(--g-accent-muted) text-(--g-accent) h-8 w-8">
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

            {/* Side panel (APIs / Docs) */}
            <ResizableHandle withHandle className={cn("transition-opacity duration-200", panelOpen ? "opacity-100" : "opacity-0 pointer-events-none")} />
            <ResizablePanel panelRef={swaggerPanelRef} id="swagger" minSize={10} defaultSize={panelOpen ? 25 : 0} collapsible collapsedSize={0} className="transition-all duration-300 ease-in-out overflow-hidden">
              {apisOpen && docsOpen ? (
                <ResizablePanelGroup {...{ direction: "vertical" } as object} className="h-full">
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

        {/* Debug panel */}
        <ResizableHandle withHandle className={cn("transition-opacity duration-200", debugMsgIdx !== null ? "opacity-100" : "opacity-0 pointer-events-none")} />
        <ResizablePanel panelRef={debugPanelRef} id="debug" minSize={8} defaultSize={debugMsgIdx !== null ? 12 : 0} collapsible collapsedSize={0} className="transition-all duration-300 ease-in-out overflow-hidden">
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
