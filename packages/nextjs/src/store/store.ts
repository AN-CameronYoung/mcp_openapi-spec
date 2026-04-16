"use client";

import { create } from "zustand";

import { generateTitle } from "../lib/api";
import type { ApiInfo, SearchResult, EndpointCard, DocCard, DocInfo } from "../lib/api";
import type { Personality } from "@greg/shared/chat";

// ---------------------------------------------------------------------------
// Chat message with optional endpoint cards
// ---------------------------------------------------------------------------

export interface ChatMsg {
	role: "user" | "assistant";
	text: string;
	endpoints?: EndpointCard[];
	docs?: DocCard[];
	streaming?: boolean;
	model?: string;
	personality?: Personality;
	usage?: { input: number; output: number; toolCalls: number };
	verificationUsage?: { input: number; output: number };
	verificationText?: string;
	verificationStreaming?: boolean;
	debug?: Record<string, unknown>[];
	compactedTokens?: number;
	compactedHistory?: Array<{ role: string; content: string }>;
}

// ---------------------------------------------------------------------------
// Conversation — single-depth branches inside a chat session
// ---------------------------------------------------------------------------

export interface Conversation {
	id: string;
	name: string;
	parentId: string | null;       // null for Main; Main's id for branches
	forkIndex: number | null;      // index into Main.messages; null for Main
	messages: ChatMsg[];
	contextBoundaries: number[];   // per-convo /clear markers
	createdAt: number;
}

// ---------------------------------------------------------------------------
// Chat history entry (persisted in localStorage key `greg-history`)
// ---------------------------------------------------------------------------

export interface ChatHistoryEntry {
	id: string;
	title: string;
	conversations: Conversation[];
	activeConversationId: string;
	ts: number;
}

// Pre-branching shape, kept around for migration
interface LegacyChatHistoryEntry {
	id: string;
	title: string;
	messages: ChatMsg[];
	ts: number;
}

let mainIdCounter = 0;

const createMainConversation = (): Conversation => ({
	id: `conv-main-${Date.now()}-${++mainIdCounter}`,
	name: "Main",
	parentId: null,
	forkIndex: null,
	messages: [],
	contextBoundaries: [],
	createdAt: Date.now(),
});

const randId = (): string => Math.random().toString(36).slice(2, 10);

const migrateHistoryEntry = (raw: unknown): ChatHistoryEntry | null => {
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Partial<ChatHistoryEntry> & Partial<LegacyChatHistoryEntry>;
	if (!obj.id || !obj.title || typeof obj.ts !== "number") return null;
	if (Array.isArray(obj.conversations) && typeof obj.activeConversationId === "string") {
		return { id: obj.id, title: obj.title, ts: obj.ts, conversations: obj.conversations, activeConversationId: obj.activeConversationId };
	}
	if (Array.isArray(obj.messages)) {
		const mainId = `conv-${obj.id}`;
		const main: Conversation = {
			id: mainId,
			name: "Main",
			parentId: null,
			forkIndex: null,
			messages: obj.messages,
			contextBoundaries: [],
			createdAt: obj.ts,
		};
		return { id: obj.id, title: obj.title, ts: obj.ts, conversations: [main], activeConversationId: mainId };
	}
	return null;
};

// ---------------------------------------------------------------------------
// Ingest job
// ---------------------------------------------------------------------------

export interface IngestJob {
	id: string;
	apiName: string;
	status: "queued" | "running" | "done" | "error";
	message: string;
	done?: number;
	total?: number;
}

let jobIdCounter = 0;

/**
 * Returns a monotonically increasing job ID string for new ingest jobs.
 */
export const nextJobId = (): string => {
	return `job-${++jobIdCounter}`;
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export type ThemePref = "light" | "dark" | "system" | "claude";

/**
 * Reads the persisted theme preference from localStorage.
 * Falls back to "system" if unavailable.
 */
const getStoredTheme = (): ThemePref => {
	try { return (localStorage.getItem("greg-theme") as ThemePref) ?? "system"; } catch { return "system"; }
};

/**
 * Applies a theme preference to the document by toggling the `dark` class
 * and persisting the preference to localStorage.
 *
 * @param pref - The theme preference to apply
 */
const applyTheme = (pref: ThemePref): void => {
	if (typeof window === "undefined") return;
	const el = document.documentElement;
	el.classList.remove("dark", "claude");
	if (pref === "claude") el.classList.add("claude");
	else if (pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)) el.classList.add("dark");
	try { localStorage.setItem("greg-theme", pref); } catch {}
};

// Apply on load immediately (before React renders, client-only)
if (typeof window !== "undefined") applyTheme(getStoredTheme());

const VALID_PAGES = new Set(["greg", "search", "apis", "docs", "settings", "admin"]);

/**
 * Parses the current URL hash to determine the active page.
 *
 * @param hash - The hash string to parse; defaults to the current window hash
 * @returns The matching page name, or null if the hash is unrecognized
 */
export const pageFromHash = (hash = typeof window !== "undefined" ? window.location.hash : ""): AppState["page"] | null => {
	const seg = hash.replace(/^#\/?/, "").split("/")[0] || "greg";
	return VALID_PAGES.has(seg)
		? (seg as AppState["page"])
		: null;
};

/**
 * Extracts a chat ID from the URL hash when on the greg page.
 * Expects the format `#/greg/<chatId>` or `#/greg/<chatId>/<branchIdx>`.
 *
 * @param hash - The hash string to parse; defaults to the current window hash
 * @returns The chat ID string, or null if none is present
 */
export const chatIdFromHash = (hash = typeof window !== "undefined" ? window.location.hash : ""): string | null => {
	const segs = hash.replace(/^#\/?/, "").split("/");
	const page = segs[0] || "greg";
	const candidate = page === "greg" ? segs[1] : null;
	return (candidate && candidate.startsWith("chat-")) ? candidate : null;
};

/**
 * Extracts the active branch index from the URL hash.
 * Expects `#/greg/<chatId>/<n>` where n is a positive integer branch index.
 * Returns 0 (Main) when no valid branch segment is present.
 *
 * @param hash - The hash string to parse; defaults to the current window hash
 * @returns The branch index (0 for Main)
 */
export const branchIndexFromHash = (hash = typeof window !== "undefined" ? window.location.hash : ""): number => {
	const segs = hash.replace(/^#\/?/, "").split("/");
	if ((segs[0] || "greg") !== "greg") return 0;
	if (!segs[1]?.startsWith("chat-")) return 0;
	const raw = segs[2];
	if (!raw) return 0;
	const n = parseInt(raw, 10);
	return Number.isInteger(n) && n > 0 ? n : 0;
};

/**
 * Builds the URL hash path for the greg page given a chat id and branch index.
 * Main (index 0) and unsaved chats omit the branch segment.
 *
 * @param chatId - The active chat id, or null for an unsaved chat
 * @param branchIdx - Index of the active conversation (0 = Main)
 */
export const buildGregHash = (chatId: string | null, branchIdx: number): string => {
	if (!chatId) return "/";
	return branchIdx > 0 ? `/greg/${chatId}/${branchIdx}` : `/greg/${chatId}`;
};

// ---------------------------------------------------------------------------
// Selectors (pure, derive-from-state helpers)
// ---------------------------------------------------------------------------

type ConvState = Pick<AppState, "conversations" | "activeConversationId">;

/**
 * Returns the currently active conversation, falling back to Main if the
 * active id is missing (shouldn't happen, but keeps types tight).
 */
export const getActiveConversation = (s: ConvState): Conversation => {
	return s.conversations.find((c) => c.id === s.activeConversationId) ?? s.conversations[0]!;
};

/**
 * Returns the messages of the active conversation.
 */
export const getActiveMessages = (s: ConvState): ChatMsg[] => getActiveConversation(s).messages;

/**
 * Builds the full message history for the LLM. For Main this is just the
 * conversation's own messages; for a branch it's Main's messages up to and
 * including the fork point, followed by the branch's own messages.
 */
export const getFullHistory = (conversations: Conversation[], convId: string): ChatMsg[] => {
	const conv = conversations.find((c) => c.id === convId);
	if (!conv) return [];
	if (!conv.parentId || conv.forkIndex === null) return [...conv.messages];
	const parent = conversations.find((c) => c.id === conv.parentId);
	if (!parent) return [...conv.messages];
	const inherited = parent.messages.slice(0, conv.forkIndex + 1);
	return [...inherited, ...conv.messages];
};

type AppState = {
	// Theme
	theme: ThemePref;
	setTheme: (t: ThemePref) => void;

	// Navigation
	page: "greg" | "search" | "apis" | "docs" | "settings" | "admin";
	setPage: (p: "greg" | "search" | "apis" | "docs" | "settings" | "admin") => void;

	// APIs metadata
	apis: ApiInfo[];
	setApis: (a: ApiInfo[]) => void;

	// Docs metadata
	docs: DocInfo[];
	setDocs: (d: DocInfo[]) => void;

	// APIs tab (Swagger/OpenAPI viewer)
	apisApi: string;
	apisAnchor: { method: string; path: string; operationId?: string; tag?: string } | null;
	setApisApi: (api: string) => void;
	viewApis: (api: string, method: string, path: string, operationId?: string, tag?: string) => void;

	// Docs tab (markdown viewer)
	selectedDoc: string;
	setSelectedDoc: (doc: string) => void;

	// Chat — multi-conversation model (single-depth branches)
	conversations: Conversation[];
	activeConversationId: string;
	personality: Personality;
	chatLoading: boolean;
	selectedModel: string;
	selectedProvider: string;
	setChatMessages: (msgs: ChatMsg[]) => void;
	addChatMessage: (msg: ChatMsg) => void;
	updateLastAssistant: (updater: (msg: ChatMsg) => ChatMsg) => void;
	// Conversation-scoped variants — for in-flight streams that must stick to
	// the originating tab even if the user switches the active conversation.
	addChatMessageTo: (convId: string, msg: ChatMsg) => void;
	updateLastAssistantIn: (convId: string, updater: (msg: ChatMsg) => ChatMsg) => void;
	setChatMessagesIn: (convId: string, msgs: ChatMsg[]) => void;
	deleteMessage: (msgIdx: number) => void;
	addContextBoundary: () => void;
	setContextBoundaries: (boundaries: number[]) => void;
	setPersonality: (v: Personality) => void;
	setChatLoading: (v: boolean) => void;
	setModel: (model: string, provider: string) => void;
	clearChat: () => void;

	// Branching
	forkConversation: (fromMessageIndex: number) => string | null;
	switchConversation: (conversationId: string) => void;
	closeConversation: (conversationId: string) => void;
	renameConversation: (conversationId: string, name: string) => void;

	// Chat history
	chatHistory: ChatHistoryEntry[];
	activeChatId: string | null;
	saveChat: () => void;
	loadChat: (id: string) => void;
	renameChat: (id: string, title: string) => void;
	deleteChat: (id: string) => void;
	newChat: () => void;

	// Double check (verification pass)
	doubleCheck: boolean;
	setDoubleCheck: (v: boolean) => void;

	// Custom system prompt
	customGregPrompt: string;
	customExplainerPrompt: string;
	customProPrompt: string;
	customCasualPrompt: string;
	setCustomGregPrompt: (v: string) => void;
	setCustomExplainerPrompt: (v: string) => void;
	setCustomProPrompt: (v: string) => void;
	setCustomCasualPrompt: (v: string) => void;

	// Ingest jobs
	ingestJobs: IngestJob[];
	addIngestJob: (job: IngestJob) => void;
	updateIngestJob: (id: string, updates: Partial<IngestJob>) => void;
	removeIngestJob: (id: string) => void;
	clearDoneJobs: () => void;

	// Auto-ingest status
	autoIngest: {
		active: boolean;
		specs: Array<{ name: string; status: "pending" | "running" | "done" | "error"; message: string; done?: number; total?: number }>;
		currentIndex: number;
	};
	setAutoIngest: (u: Partial<AppState["autoIngest"]>) => void;
	updateAutoIngestSpec: (name: string, u: Partial<AppState["autoIngest"]["specs"][0]>) => void;

	// Code dropdown open states (persists across re-renders)
	openCodeBlocks: Record<string, boolean>;
	toggleCodeBlock: (key: string) => void;

	// Search
	searchResults: SearchResult[];
	setSearchResults: (r: SearchResult[]) => void;

	// Detail panel
	detailItem: SearchResult | EndpointCard | null;
	detailType: "endpoints" | "schemas" | "docs" | "apis";
	setDetail: (item: SearchResult | EndpointCard | null, type?: "endpoints" | "schemas" | "docs" | "apis") => void;

	// Client-side hydration from localStorage (call once in useEffect)
	hydrateFromStorage: () => void;
};

const INITIAL_MAIN = createMainConversation();

// Update messages of the currently-active conversation.
const mapActiveMessages = (s: ConvState, fn: (msgs: ChatMsg[]) => ChatMsg[]): Conversation[] =>
	s.conversations.map((c) => (c.id === s.activeConversationId ? { ...c, messages: fn(c.messages) } : c));

export const useStore = create<AppState>()((set) => ({
	theme: "system" as ThemePref,
	setTheme: (t) => { applyTheme(t); set({ theme: t }); },

	page: "greg",
	setPage: (p) => {
		set((s) => {
			if (typeof window !== "undefined") {
				// Preserve the chat ID + active branch when navigating to/from greg
				const chatId = s.activeChatId;
				const branchIdx = s.conversations.findIndex((c) => c.id === s.activeConversationId);
				const hash = p === "greg" ? buildGregHash(chatId, branchIdx > 0 ? branchIdx : 0) : `/${p}`;
				window.history.pushState(null, "", `#${hash}`);
			}
			return { page: p, ...(p !== "apis" && { apisAnchor: null }) };
		});
	},

	apis: [],
	setApis: (apis) => set({ apis }),

	docs: [],
	setDocs: (docs) => set({ docs }),

	apisApi: "",
	apisAnchor: null,
	setApisApi: (api) => set({ apisApi: api, apisAnchor: null }),
	viewApis: (api, method, path, operationId, tag) => {
		set({ page: "apis", apisApi: api, apisAnchor: { method, path, ...(operationId !== undefined && { operationId }), ...(tag !== undefined && { tag }) } });
		if (typeof window !== "undefined") window.history.pushState(null, "", "#/apis");
	},

	selectedDoc: "",
	setSelectedDoc: (doc) => set({ selectedDoc: doc }),

	conversations: [INITIAL_MAIN],
	activeConversationId: INITIAL_MAIN.id,
	personality: "greg" as Personality,
	chatLoading: false,
	selectedModel: "",
	selectedProvider: "",
	setChatMessages: (msgs) => set((s) => ({ conversations: mapActiveMessages(s, () => msgs) })),
	addChatMessage: (msg) => set((s) => ({ conversations: mapActiveMessages(s, (prev) => [...prev, msg]) })),
	updateLastAssistant: (updater) =>
		set((s) => ({
			conversations: mapActiveMessages(s, (prev) => {
				const next = [...prev];
				for (let i = next.length - 1; i >= 0; i--) {
					const msg = next[i];
					if (msg?.role === "assistant") {
						next[i] = updater(msg);
						break;
					}
				}
				return next;
			}),
		})),
	addChatMessageTo: (convId, msg) => set((s) => ({
		conversations: s.conversations.map((c) => (c.id === convId ? { ...c, messages: [...c.messages, msg] } : c)),
	})),
	updateLastAssistantIn: (convId, updater) => set((s) => ({
		conversations: s.conversations.map((c) => {
			if (c.id !== convId) return c;
			const next = [...c.messages];
			for (let i = next.length - 1; i >= 0; i--) {
				const msg = next[i];
				if (msg?.role === "assistant") {
					next[i] = updater(msg);
					break;
				}
			}
			return { ...c, messages: next };
		}),
	})),
	setChatMessagesIn: (convId, msgs) => set((s) => ({
		conversations: s.conversations.map((c) => (c.id === convId ? { ...c, messages: msgs } : c)),
	})),
	deleteMessage: (msgIdx) => set((s) => ({
		conversations: s.conversations.map((c) => {
			if (c.id !== s.activeConversationId) return c;
			if (msgIdx < 0 || msgIdx >= c.messages.length) return c;
			const messages = [...c.messages.slice(0, msgIdx), ...c.messages.slice(msgIdx + 1)];
			// Shift context boundaries that pointed past the removed index
			const contextBoundaries = c.contextBoundaries
				.map((b) => (b > msgIdx ? b - 1 : b))
				.filter((b) => b >= 0 && b <= messages.length);
			return { ...c, messages, contextBoundaries };
		}),
	})),
	addContextBoundary: () => set((s) => ({
		conversations: s.conversations.map((c) =>
			c.id === s.activeConversationId
				? { ...c, contextBoundaries: [...c.contextBoundaries, c.messages.length] }
				: c,
		),
	})),
	setContextBoundaries: (boundaries) => set((s) => ({
		conversations: s.conversations.map((c) =>
			c.id === s.activeConversationId ? { ...c, contextBoundaries: boundaries } : c,
		),
	})),
	setPersonality: (v) => { try { localStorage.setItem("greg-personality", v); } catch {} set({ personality: v }); },
	setChatLoading: (v) => set({ chatLoading: v }),
	setModel: (model, provider) => {
		try { localStorage.setItem("greg-model", model); localStorage.setItem("greg-provider", provider); } catch {}
		set({ selectedModel: model, selectedProvider: provider });
	},
	clearChat: () => set((s) => {
		s.saveChat();
		const main = createMainConversation();
		if (typeof window !== "undefined") window.history.replaceState(null, "", "#/");
		return { conversations: [main], activeConversationId: main.id, chatLoading: false, activeChatId: null };
	}),

	forkConversation: (fromMessageIndex) => {
		let newId: string | null = null;
		set((s) => {
			const main = s.conversations[0];
			if (!main) return {};
			// Single-depth guard: can only fork from Main
			if (s.activeConversationId !== main.id) return {};
			if (fromMessageIndex < 0 || fromMessageIndex >= main.messages.length) return {};
			const branchNumber = s.conversations.length + 1;
			const id = `conv-${Date.now()}-${randId()}`;
			newId = id;
			const branch: Conversation = {
				id,
				name: `Branch ${branchNumber}`,
				parentId: main.id,
				forkIndex: fromMessageIndex,
				messages: [],
				contextBoundaries: [],
				createdAt: Date.now(),
			};
			const conversations = [...s.conversations, branch];
			if (typeof window !== "undefined" && s.activeChatId) {
				window.history.replaceState(null, "", `#${buildGregHash(s.activeChatId, conversations.length - 1)}`);
			}
			return { conversations, activeConversationId: id };
		});
		return newId;
	},
	switchConversation: (id) => set((s) => {
		const idx = s.conversations.findIndex((c) => c.id === id);
		if (idx < 0) return {};
		if (typeof window !== "undefined" && s.activeChatId) {
			window.history.replaceState(null, "", `#${buildGregHash(s.activeChatId, idx)}`);
		}
		return { activeConversationId: id };
	}),
	closeConversation: (id) => set((s) => {
		const main = s.conversations[0];
		if (!main || id === main.id) return {};
		const conversations = s.conversations.filter((c) => c.id !== id);
		const activeConversationId = s.activeConversationId === id ? main.id : s.activeConversationId;
		if (typeof window !== "undefined" && s.activeChatId) {
			const idx = conversations.findIndex((c) => c.id === activeConversationId);
			window.history.replaceState(null, "", `#${buildGregHash(s.activeChatId, idx > 0 ? idx : 0)}`);
		}
		return { conversations, activeConversationId };
	}),
	renameConversation: (id, name) => set((s) => ({
		conversations: s.conversations.map((c) => (c.id === id ? { ...c, name } : c)),
	})),

	chatHistory: [] as ChatHistoryEntry[],
	activeChatId: null,
	saveChat: () => set((s) => {
		const hasAny = s.conversations.some((c) => c.messages.length > 0);
		if (!hasAny) return {};
		const isNew = s.activeChatId === null;
		const id = s.activeChatId ?? `chat-${Date.now()}`;
		const main = s.conversations[0];
		const userMsg = main?.messages.find((m) => m.role === "user")?.text ?? "";
		const existingEntry = s.chatHistory.find((c) => c.id === id);
		// Preserve a manually-set (or previously auto-generated) title; only derive from
		// message text on the very first save so manual renames are never clobbered.
		const title = existingEntry?.title ?? (userMsg.slice(0, 50) || "New chat");
		const existing = s.chatHistory.filter((c) => c.id !== id);
		const entry: ChatHistoryEntry = {
			id,
			title,
			ts: Date.now(),
			conversations: s.conversations,
			activeConversationId: s.activeConversationId,
		};
		const history = [entry, ...existing].slice(0, 50);
		try { localStorage.setItem("greg-history", JSON.stringify(history)); } catch {}
		// Stamp the chat ID (and active branch) into the URL the first time this chat is saved
		if (isNew && typeof window !== "undefined") {
			const idx = s.conversations.findIndex((c) => c.id === s.activeConversationId);
			window.history.replaceState(null, "", `#${buildGregHash(id, idx > 0 ? idx : 0)}`);
		}
		// Generate a better title only for brand-new chats — never overwrite an existing title
		if (userMsg && isNew) {
			generateTitle(userMsg).then(({ title: t }) => {
				set((cur) => {
					const updated = cur.chatHistory.map((c) => c.id === id ? { ...c, title: t } : c);
					try { localStorage.setItem("greg-history", JSON.stringify(updated)); } catch {}
					return { chatHistory: updated };
				});
			});
		}
		return { chatHistory: history, activeChatId: id };
	}),
	loadChat: (id) => set((s) => {
		const chat = s.chatHistory.find((c) => c.id === id);
		if (!chat) return {};
		const idx = chat.conversations.findIndex((c) => c.id === chat.activeConversationId);
		if (typeof window !== "undefined") {
			window.history.pushState(null, "", `#${buildGregHash(id, idx > 0 ? idx : 0)}`);
		}
		return {
			conversations: chat.conversations,
			activeConversationId: chat.activeConversationId,
			activeChatId: id,
		};
	}),
	renameChat: (id, title) => set((s) => {
		const updated = s.chatHistory.map((c) => c.id === id ? { ...c, title } : c);
		try { localStorage.setItem("greg-history", JSON.stringify(updated)); } catch {}
		return { chatHistory: updated };
	}),
	deleteChat: (id) => set((s) => {
		const history = s.chatHistory.filter((c) => c.id !== id);
		try { localStorage.setItem("greg-history", JSON.stringify(history)); } catch {}
		const updates: Partial<AppState> = { chatHistory: history };
		if (s.activeChatId === id) {
			const main = createMainConversation();
			updates.conversations = [main];
			updates.activeConversationId = main.id;
			updates.activeChatId = null;
			if (typeof window !== "undefined") window.history.replaceState(null, "", "#/");
		}
		return updates;
	}),
	newChat: () => set((s) => {
		s.saveChat();
		const main = createMainConversation();
		if (typeof window !== "undefined") window.history.pushState(null, "", "#/");
		return { conversations: [main], activeConversationId: main.id, activeChatId: null };
	}),

	doubleCheck: false,
	setDoubleCheck: (v) => { try { localStorage.setItem("greg-double-check", String(v)); } catch {} set({ doubleCheck: v }); },

	customGregPrompt: "",
	customExplainerPrompt: "",
	customProPrompt: "",
	customCasualPrompt: "",
	setCustomGregPrompt: (v) => set({ customGregPrompt: v }),
	setCustomExplainerPrompt: (v) => set({ customExplainerPrompt: v }),
	setCustomProPrompt: (v) => set({ customProPrompt: v }),
	setCustomCasualPrompt: (v) => set({ customCasualPrompt: v }),

	ingestJobs: [],
	addIngestJob: (job) => set((s) => ({ ingestJobs: [...s.ingestJobs, job] })),
	updateIngestJob: (id, updates) =>
		set((s) => ({
			ingestJobs: s.ingestJobs.map((j) => (j.id === id ? { ...j, ...updates } : j)),
		})),
	removeIngestJob: (id) => set((s) => ({ ingestJobs: s.ingestJobs.filter((j) => j.id !== id) })),
	clearDoneJobs: () => set((s) => ({ ingestJobs: s.ingestJobs.filter((j) => j.status === "queued" || j.status === "running") })),

	autoIngest: { active: false, specs: [], currentIndex: 0 },
	setAutoIngest: (u) => set((s) => ({ autoIngest: { ...s.autoIngest, ...u } })),
	updateAutoIngestSpec: (name, u) => set((s) => ({
		autoIngest: { ...s.autoIngest, specs: s.autoIngest.specs.map((sp) => sp.name === name ? { ...sp, ...u } : sp) },
	})),

	openCodeBlocks: {},
	toggleCodeBlock: (key) => set((s) => ({
		openCodeBlocks: { ...s.openCodeBlocks, [key]: !s.openCodeBlocks[key] },
	})),

	searchResults: [],
	setSearchResults: (r) => set({ searchResults: r }),

	detailItem: null,
	detailType: "endpoints",
	setDetail: (item, type) => set({ detailItem: item, detailType: type ?? "endpoints" }),

	hydrateFromStorage: () => {
		try {
			// Read persisted values
			const theme = (localStorage.getItem("greg-theme") as ThemePref) ?? "system";
			const pv = localStorage.getItem("greg-personality");
			const PERSONALITIES: Personality[] = ["greg", "explanatory", "quick", "casual"];
			const personality = (pv !== null && (PERSONALITIES as string[]).includes(pv))
				? pv
				: localStorage.getItem("greg-mode") === "false" ? "quick" : "greg";
			const selectedModel = localStorage.getItem("greg-model") ?? "";
			const selectedProvider = localStorage.getItem("greg-provider") ?? "";
			const rawHistory = JSON.parse(localStorage.getItem("greg-history") ?? "[]") as unknown[];
			const chatHistory = rawHistory.map(migrateHistoryEntry).filter((e): e is ChatHistoryEntry => e !== null);
			// Re-serialize if any legacy entries were migrated so the next read is clean
			if (chatHistory.length > 0 && chatHistory.length === rawHistory.length) {
				try { localStorage.setItem("greg-history", JSON.stringify(chatHistory)); } catch {}
			}
			const doubleCheck = localStorage.getItem("greg-double-check") === "true";
			const page = pageFromHash() ?? "greg";

			// Restore active chat from URL hash (e.g. #/greg/chat-1234[/<branchIdx>])
			const chatId = chatIdFromHash();
			const chatFromUrl = chatId ? chatHistory.find((c) => c.id === chatId) : null;
			const branchIdx = branchIndexFromHash();
			const activeFromUrl = chatFromUrl && branchIdx > 0 && branchIdx < chatFromUrl.conversations.length
				? chatFromUrl.conversations[branchIdx]!.id
				: chatFromUrl?.activeConversationId;

			// Apply and commit
			applyTheme(theme);
			set({
				theme, personality: personality as Personality, selectedModel, selectedProvider, chatHistory, doubleCheck, page,
				...(chatFromUrl
					? { conversations: chatFromUrl.conversations, activeConversationId: activeFromUrl!, activeChatId: chatFromUrl.id }
					: {}),
			});
		} catch {}
	},
}));
