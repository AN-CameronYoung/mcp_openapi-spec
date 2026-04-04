import z from "zod";

export type AppConfig = z.infer<typeof AppConfig>;
export const AppConfig = z.object({
	chromaHost: z.string().optional(),
	chromaPort: z.coerce.number().default(8000),
	chromaSsl: z.boolean().default(false),
	chromaAuthToken: z.string().optional(),
	chromaDbPath: z.string().default(".chroma_db"),
	chromaCollection: z.string().default("openapi_specs"),

	ollamaUrl: z.string().optional(),
	ollamaModel: z.string().default("mxbai-embed-large"),
	embeddingModel: z.string().default("all-MiniLM-L6-v2"),

	mcpAdminToken: z.string().optional(),
	mcpReadToken: z.string().optional(),

	nodeEnv: z.string().default("development"),
});
