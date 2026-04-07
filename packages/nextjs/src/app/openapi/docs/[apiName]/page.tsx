"use client";

import { use, useEffect } from "react";
import SwaggerUI from "swagger-ui-react";
import "swagger-ui-dist/swagger-ui.css";
import "./swagger-theme.css";

interface Props {
	params: Promise<{ apiName: string }>;
	searchParams: Promise<{ method?: string; path?: string; theme?: string }>;
}

export default function DocsPage({ params, searchParams }: Props) {
	const { apiName } = use(params);
	const { method, path, theme = "dark" } = use(searchParams);

	useEffect(() => {
		if (theme === "light") {
			document.body.classList.add("light");
		} else {
			document.body.classList.remove("light");
		}
	}, [theme]);

	useEffect(() => {
		if (!method || !path) return;
		const tryScroll = (attempts = 0) => {
			const m = method.toLowerCase();
			// Swagger UI generates IDs like: operations-tagName-methodPath_path
			const candidates = document.querySelectorAll(`[id*="${m}"]`);
			for (const el of candidates) {
				if (el.id.includes(path.replace(/[{}]/g, "").replace(/\//g, "_"))) {
					el.scrollIntoView({ behavior: "smooth", block: "start" });
					(el as HTMLElement).click?.();
					return;
				}
			}
			if (attempts < 20) setTimeout(() => tryScroll(attempts + 1), 300);
		};
		setTimeout(() => tryScroll(), 1200);
	}, [method, path]);

	// Try yaml first, fall back to json
	const specUrl = `/openapi/specs/${apiName}.yaml`;

	return <SwaggerUI url={specUrl} tryItOutEnabled={false} />;
}
