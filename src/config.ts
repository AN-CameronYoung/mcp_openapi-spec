import { AppConfig } from "../types/config";

const config = AppConfig.parse({
	chromaHost: process.env.CHROMA_HOST,
	chromaPort: process.env.CHROMA_PORT,
	chromaSsl: process.env.CHROMA_SSL === "true",
	chromaAuthToken: process.env.CHROMA_AUTH_TOKEN,
	chromaDbPath: process.env.CHROMA_DB_PATH,
	chromaCollection: process.env.CHROMA_COLLECTION,

	ollamaUrl: process.env.OLLAMA_URL,
	ollamaModel: process.env.OLLAMA_MODEL,
	embeddingModel: process.env.EMBEDDING_MODEL,

	mcpAdminToken: process.env.MCP_ADMIN_TOKEN,
	mcpReadToken: process.env.MCP_READ_TOKEN,

	nodeEnv: process.env.NODE_ENV,
});

export default config;
