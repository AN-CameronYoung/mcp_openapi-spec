import React from "react";
import useStore from "../store/store";

const SearchBar: React.FC = () => {
	const { query, setQuery, search, isSearching } = useStore();

	const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
		if (e.key === "Enter") search();
	};

	return (
		<div className="sticky top-0 z-50 bg-custom-dark-100 border-b border-custom-dark-400 p-3 flex gap-2 items-center flex-wrap">
			<span className="text-custom-accent font-bold text-sm whitespace-nowrap">AI Search</span>
			<input
				type="text"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder="Describe what you're looking for... (e.g. 'list all devices', 'authenticate user')"
				className="flex-1 min-w-[200px] px-3 py-2 border border-custom-dark-400 rounded bg-custom-dark-200 text-custom-text-100 text-sm placeholder:text-custom-text-300 focus:outline-none focus:border-custom-accent"
			/>
			<button
				onClick={search}
				disabled={isSearching}
				className="px-4 py-2 border-none rounded bg-custom-accent text-custom-dark font-bold cursor-pointer text-sm hover:bg-custom-accent-hover disabled:opacity-50"
			>
				{isSearching ? "Searching..." : "Search"}
			</button>
		</div>
	);
};

export default SearchBar;
