import React, { useEffect, useRef } from "react";
import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";
import useStore from "../store/store";
import type { SearchResult } from "../store/types";

const SwaggerView: React.FC = () => {
	const { selectedSpec } = useStore();
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handleNavigate = (e: Event): void => {
			const detail = (e as CustomEvent<SearchResult>).detail;
			if (!detail) return;

			// Find and expand the matching operation block
			setTimeout(() => {
				const method = detail.method.toLowerCase();
				const opblocks = document.querySelectorAll(`.opblock-${method}`);

				for (const block of opblocks) {
					const pathEl = block.querySelector(
						".opblock-summary-path, .opblock-summary-path__deprecated"
					);
					if (pathEl) {
						const pathText = pathEl.textContent?.trim().replace(/\s+/g, "") ?? "";
						if (pathText === detail.path || pathText.endsWith(detail.path)) {
							const summary = block.querySelector(".opblock-summary");
							const isCollapsed = !block.classList.contains("is-open");
							if (isCollapsed && summary) (summary as HTMLElement).click();
							setTimeout(() => {
								block.scrollIntoView({ behavior: "smooth", block: "start" });
							}, 100);
							return;
						}
					}
				}

				// Fallback: broader search
				const allBlocks = document.querySelectorAll(".opblock");
				for (const block of allBlocks) {
					if (block.textContent?.includes(detail.path)) {
						const summary = block.querySelector(".opblock-summary");
						const isCollapsed = !block.classList.contains("is-open");
						if (isCollapsed && summary) (summary as HTMLElement).click();
						setTimeout(() => {
							block.scrollIntoView({ behavior: "smooth", block: "start" });
						}, 100);
						return;
					}
				}
			}, 300);
		};

		window.addEventListener("navigate-to-endpoint", handleNavigate);
		return () => window.removeEventListener("navigate-to-endpoint", handleNavigate);
	}, []);

	if (!selectedSpec) {
		return (
			<div className="flex items-center justify-center h-64 text-custom-text-300">
				No spec selected. Add spec files to the specs/ directory.
			</div>
		);
	}

	return (
		<div ref={containerRef} className="swagger-wrapper">
			<SwaggerUI url={selectedSpec} />
		</div>
	);
};

export default SwaggerView;
