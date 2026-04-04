import { create } from "zustand";
import type { Store, SearchResult, SpecEntry } from "./types";

const useStore = create<Store>((set, get) => ({
	// State
	query: "",
	results: [],
	isSearching: false,
	resultsOpen: false,
	specs: [],
	selectedSpec: "",

	// Actions
	setQuery: (query: string) => set({ query }),

	search: async () => {
		const { query } = get();
		const q = query.trim();
		if (!q) return;

		set({ isSearching: true, resultsOpen: true, results: [] });

		try {
			const resp = await fetch(`/openapi/search?q=${encodeURIComponent(q)}&n=15`);
			if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
			const items: SearchResult[] = await resp.json();
			set({ results: items, isSearching: false });
		} catch (err: unknown) {
			console.error("Search failed:", err);
			set({ results: [], isSearching: false });
		}
	},

	closeResults: () => set({ resultsOpen: false }),

	setSelectedSpec: (url: string) => set({ selectedSpec: url }),

	fetchSpecs: async () => {
		try {
			const resp = await fetch("/openapi/specs/");
			if (!resp.ok) return;
			const text = await resp.text();
			// Parse directory listing for spec files
			const matches = text.match(/href="([^"]+\.(yaml|yml|json))"/g) ?? [];
			const specs: SpecEntry[] = matches.map((m) => {
				const filename = m.match(/href="([^"]+)"/)?.[1] ?? "";
				const name = filename.replace(/\.(yaml|yml|json)$/, "");
				return { url: `/openapi/specs/${filename}`, name };
			});
			set({ specs, selectedSpec: specs[0]?.url ?? "" });
		} catch {
			// Specs fetch failed — non-critical
		}
	},
}));

export default useStore;
