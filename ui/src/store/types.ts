export interface SearchResult {
	method: string;
	path: string;
	api: string;
	operation_id: string;
	tag: string;
	tags: string;
	distance: number;
	text: string;
}

export interface SpecEntry {
	url: string;
	name: string;
}

export interface Store {
	// Search
	query: string;
	results: SearchResult[];
	isSearching: boolean;
	resultsOpen: boolean;

	// Specs
	specs: SpecEntry[];
	selectedSpec: string;

	// Actions
	setQuery: (query: string) => void;
	search: () => Promise<void>;
	closeResults: () => void;
	setSelectedSpec: (url: string) => void;
	fetchSpecs: () => Promise<void>;
}
