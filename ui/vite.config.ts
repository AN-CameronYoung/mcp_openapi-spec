import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	resolve: {
		alias: {
			"@components": path.resolve(__dirname, "src/components"),
			"@routes": path.resolve(__dirname, "src/routes"),
			"@store": path.resolve(__dirname, "src/store"),
			"@styles": path.resolve(__dirname, "src/styles"),
		},
	},
	server: {
		proxy: {
			"/openapi": {
				target: "http://localhost:3000",
				changeOrigin: true,
			},
		},
	},
	build: {
		outDir: "dist",
	},
});
