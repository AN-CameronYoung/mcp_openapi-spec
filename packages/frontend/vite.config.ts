import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const apiTarget = process.env.VITE_API_URL ?? "http://localhost:3000";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		proxy: {
			"/api": apiTarget,
			"/openapi": apiTarget,
		},
	},
	build: {
		rollupOptions: {
			output: {
				manualChunks: {
					"syntax-highlight": ["react-syntax-highlighter"],
					"markdown": ["react-markdown", "remark-gfm"],
				},
			},
		},
	},
});
