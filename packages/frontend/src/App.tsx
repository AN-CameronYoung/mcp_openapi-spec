import { useEffect } from "react";
import { listApis } from "./lib/api";
import { useStore } from "./store/store";
import Header from "./components/Header";
import GregPage from "./pages/GregPage";
import SearchPage from "./pages/SearchPage";
import DocsPage from "./pages/DocsPage";
import SettingsPage from "./pages/SettingsPage";
import IngestFloat from "./components/IngestFloat";

export default function App() {
	const page = useStore((s) => s.page);
	const setApis = useStore((s) => s.setApis);
	const setDocsApi = useStore((s) => s.setDocsApi);
	const docsApi = useStore((s) => s.docsApi);

	const theme = useStore((s) => s.theme);
	const setTheme = useStore((s) => s.setTheme);

	useEffect(() => {
		listApis()
			.then((apis) => {
				setApis(apis);
				if (!docsApi && apis.length > 0) {
					setDocsApi(apis[0].name);
				}
			})
			.catch(() => {});
	}, []);

	// Re-apply when system preference changes
	useEffect(() => {
		if (theme !== "system") return;
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		const handler = () => setTheme("system");
		mq.addEventListener("change", handler);
		return () => mq.removeEventListener("change", handler);
	}, [theme]);

	return (
		<div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
			<Header />
			{page === "greg" && <GregPage />}
			{page === "search" && <SearchPage />}
			{page === "docs" && <DocsPage />}
			{page === "settings" && <SettingsPage />}
			<IngestFloat />
		</div>
	);
}
