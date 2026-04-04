import React from "react";
import useStore from "../store/store";
import type { SearchResult } from "../store/types";

const METHOD_COLORS: Record<string, string> = {
	get: "bg-custom-method-get",
	post: "bg-custom-method-post",
	put: "bg-custom-method-put",
	patch: "bg-custom-method-patch",
	delete: "bg-custom-method-delete",
};

interface ResultItemProps {
	result: SearchResult;
	onSelect: (result: SearchResult) => void;
}

const ResultItem: React.FC<ResultItemProps> = ({ result, onSelect }) => {
	const method = result.method.toLowerCase();
	const colorClass = METHOD_COLORS[method] ?? "bg-custom-dark-400";

	return (
		<div
			className="px-5 py-3 border-b border-custom-dark-300 cursor-pointer hover:bg-custom-dark-200"
			onClick={() => onSelect(result)}
		>
			<div className="flex items-center gap-2 mb-1">
				<span className={`${colorClass} text-white font-bold text-xs px-2 py-0.5 rounded uppercase`}>
					{result.method}
				</span>
				<span className="font-mono text-custom-text-100 text-sm">{result.path}</span>
				<span className="text-custom-text-300 text-xs ml-auto">{result.api}</span>
				<span className="text-custom-text-400 text-xs">{result.distance}</span>
			</div>
			{result.tags && (
				<div className="text-custom-text-300 text-xs">{result.tags}</div>
			)}
			<div className="text-custom-text-200 text-sm mt-1 overflow-hidden text-ellipsis whitespace-nowrap max-w-[800px]">
				{result.text.split("\n").slice(0, 3).join(" | ")}
			</div>
		</div>
	);
};

const SearchResults: React.FC = () => {
	const { results, resultsOpen, isSearching, closeResults } = useStore();

	if (!resultsOpen) return null;

	return (
		<div className="bg-custom-dark-100 overflow-y-auto max-h-[80vh] transition-[max-height] duration-300">
			{isSearching && (
				<div className="p-5 text-custom-accent text-center">Searching...</div>
			)}
			{!isSearching && results.length === 0 && (
				<div className="p-5 text-custom-text-300 text-center">No results found.</div>
			)}
			{!isSearching && results.length > 0 && (
				<>
					{results.map((r, i) => (
						<ResultItem
							key={`${r.method}-${r.path}-${i}`}
							result={r}
							onSelect={() => {
								closeResults();
								// Navigate to the swagger view with this endpoint highlighted
								window.dispatchEvent(
									new CustomEvent("navigate-to-endpoint", { detail: r })
								);
							}}
						/>
					))}
					<div
						className="text-center p-2 text-custom-text-300 cursor-pointer text-xs hover:text-custom-text-100"
						onClick={closeResults}
					>
						Close results
					</div>
				</>
			)}
		</div>
	);
};

export default SearchResults;
