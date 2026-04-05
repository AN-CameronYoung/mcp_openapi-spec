import { create } from "zustand";
import type { ApiInfo, SearchResult, EndpointCard } from "../lib/api";

// ---------------------------------------------------------------------------
// Chat message with optional endpoint cards
// ---------------------------------------------------------------------------

export interface ChatMsg {
	role: "user" | "assistant";
	text: string;
	endpoints?: EndpointCard[];
	streaming?: boolean;
}

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
export function nextJobId(): string {
	return `job-${++jobIdCounter}`;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export type ThemePref = "light" | "dark" | "system";

function getStoredTheme(): ThemePref {
	try { return (localStorage.getItem("greg-theme") as ThemePref) ?? "system"; } catch { return "system"; }
}

function applyTheme(pref: ThemePref) {
	const isDark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
	document.documentElement.classList.toggle("light", !isDark);
	try { localStorage.setItem("greg-theme", pref); } catch {}
}

// Apply on load immediately (before React renders)
applyTheme(getStoredTheme());

interface AppState {
	// Theme
	theme: ThemePref;
	setTheme: (t: ThemePref) => void;

	// Navigation
	page: "greg" | "search" | "docs" | "settings";
	setPage: (p: "greg" | "search" | "docs" | "settings") => void;

	// APIs metadata
	apis: ApiInfo[];
	setApis: (a: ApiInfo[]) => void;

	// Docs tab
	docsApi: string;
	docsAnchor: { method: string; path: string; operationId?: string; tag?: string } | null;
	setDocsApi: (api: string) => void;
	viewDocs: (api: string, method: string, path: string, operationId?: string, tag?: string) => void;

	// Chat
	chatMessages: ChatMsg[];
	gregMode: boolean;
	chatLoading: boolean;
	setChatMessages: (msgs: ChatMsg[]) => void;
	addChatMessage: (msg: ChatMsg) => void;
	updateLastAssistant: (updater: (msg: ChatMsg) => ChatMsg) => void;
	setGregMode: (v: boolean) => void;
	setChatLoading: (v: boolean) => void;
	clearChat: () => void;

	// Custom system prompt
	customGregPrompt: string;
	customProPrompt: string;
	setCustomGregPrompt: (v: string) => void;
	setCustomProPrompt: (v: string) => void;

	// Ingest jobs
	ingestJobs: IngestJob[];
	addIngestJob: (job: IngestJob) => void;
	updateIngestJob: (id: string, updates: Partial<IngestJob>) => void;
	removeIngestJob: (id: string) => void;
	clearDoneJobs: () => void;

	// Search
	searchResults: SearchResult[];
	setSearchResults: (r: SearchResult[]) => void;

	// Detail panel
	detailItem: SearchResult | EndpointCard | null;
	detailType: "endpoints" | "schemas";
	setDetail: (item: SearchResult | EndpointCard | null, type?: "endpoints" | "schemas") => void;
}

export const useStore = create<AppState>((set) => ({
	theme: getStoredTheme(),
	setTheme: (t) => { applyTheme(t); set({ theme: t }); },

	page: "greg",
	setPage: (p) => set({ page: p, docsAnchor: p !== "docs" ? null : undefined }),

	apis: [],
	setApis: (apis) => set({ apis }),

	docsApi: "",
	docsAnchor: null,
	setDocsApi: (api) => set({ docsApi: api, docsAnchor: null }),
	viewDocs: (api, method, path, operationId, tag) => set({ page: "docs", docsApi: api, docsAnchor: { method, path, operationId, tag } }),

	chatMessages: [],
	gregMode: (() => { try { return localStorage.getItem("greg-mode") !== "false"; } catch { return true; } })(),
	chatLoading: false,
	setChatMessages: (msgs) => set({ chatMessages: msgs }),
	addChatMessage: (msg) => set((s) => ({ chatMessages: [...s.chatMessages, msg] })),
	updateLastAssistant: (updater) =>
		set((s) => {
			const msgs = [...s.chatMessages];
			for (let i = msgs.length - 1; i >= 0; i--) {
				if (msgs[i].role === "assistant") {
					msgs[i] = updater(msgs[i]);
					break;
				}
			}
			return { chatMessages: msgs };
		}),
	setGregMode: (v) => { try { localStorage.setItem("greg-mode", String(v)); } catch {} set({ gregMode: v }); },
	setChatLoading: (v) => set({ chatLoading: v }),
	clearChat: () => set({ chatMessages: [], chatLoading: false }),

	customGregPrompt: "",
	customProPrompt: "",
	setCustomGregPrompt: (v) => set({ customGregPrompt: v }),
	setCustomProPrompt: (v) => set({ customProPrompt: v }),

	ingestJobs: [],
	addIngestJob: (job) => set((s) => ({ ingestJobs: [...s.ingestJobs, job] })),
	updateIngestJob: (id, updates) =>
		set((s) => ({
			ingestJobs: s.ingestJobs.map((j) => (j.id === id ? { ...j, ...updates } : j)),
		})),
	removeIngestJob: (id) => set((s) => ({ ingestJobs: s.ingestJobs.filter((j) => j.id !== id) })),
	clearDoneJobs: () => set((s) => ({ ingestJobs: s.ingestJobs.filter((j) => j.status === "queued" || j.status === "running") })),

	searchResults: [],
	setSearchResults: (r) => set({ searchResults: r }),

	detailItem: null,
	detailType: "endpoints",
	setDetail: (item, type) => set({ detailItem: item, detailType: type ?? "endpoints" }),
}));
