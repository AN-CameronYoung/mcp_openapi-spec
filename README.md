# openapi-chroma

Give Claude (or any MCP client) the ability to search your API documentation. Point it at any OpenAPI v2/v3 spec — local file or URL — and it chunks, embeds, and indexes every endpoint and schema into ChromaDB. Claude can then semantically search across all your ingested APIs to find relevant endpoints, look up request/response schemas, and understand how services fit together, without you having to paste spec files into the conversation.

Runs as an MCP server over stdio (for Claude Code) or HTTP (for remote/homelab setups), and includes a REST search API, Swagger UI for browsing raw specs, and a React frontend.

## Quick Start

```bash
bun install
cp .env.example .env  # edit as needed
```

### CLI

```bash
# Ingest a spec
bun run main.ts ingest ./specs/zerotier.yaml --api zerotier

# Semantic search
bun run main.ts query "how do I list all devices" --api proxmox

# List ingested APIs
bun run main.ts list

# Start MCP server (stdio)
bun run main.ts serve

# Start MCP server (HTTP)
bun run main.ts serve --transport http --port 3000
```

### Frontend (Next.js)

```bash
cd packages/nextjs
bun install
bun run dev   # runs on port 3001
```

The frontend proxies `/openapi/*` to the backend on port 3000. Start the backend first with `--transport http`.

The UI is a chat-first interface named **greg** with:
- Multiple AI personalities: `greg` (casual), `explanatory`, `curt`, `casual`
- Provider/model selection: Anthropic or Ollama
- Persistent chat history (localStorage), with chat ID stamped into the URL hash
- Endpoint search and inline result cards (parsed from `<endpoint/>` tags the model emits)
- Mermaid diagram rendering with SVG / PNG / PDF / clipboard export, available from both the inline view and the expanded lightbox
- "Diagram" and "Code" quick-action buttons under each reply, disabled only when the content is already present in the response
- Structured follow-up question suggestions after each reply, in a fixed 4-slot shape: **security → high availability → failure modes → open**
- Retry from any user message — always uses the **current** personality and model, not the one that produced the original reply
- Double-check (verification pass) toggle
- Theme switcher: system / light / dark / claude
- Ingest job UI with live progress

## Known Issues

- **Follow-up suggestions don't render.** The structured 4-slot follow-up questions (security → HA → failure modes → open) are generated server-side but do not appear in the Virtuoso footer after an assistant reply completes. Likely caused by `react-virtuoso` not re-rendering `components.Footer` in response to closure-captured state changes. Next step: switch the Footer to receive state via Virtuoso's `context` prop rather than closure, or lift follow-up state into Zustand so the Footer can subscribe directly.

## MCP Configuration

### Stdio (local Claude Code subprocess)

```json
{
  "mcpServers": {
    "openapi": {
      "command": "bun",
      "args": ["/path/to/main.ts", "serve"]
    }
  }
}
```

### HTTP (remote / homelab)

```json
{
  "mcpServers": {
    "openapi": {
      "type": "http",
      "url": "https://mcp.home.itsnotcam.dev/openapi"
    }
  }
}
```

## MCP Tools

| Tool | Description | Auth |
|------|-------------|------|
| `search_endpoints` | Semantic search over API endpoints | read |
| `search_schemas` | Semantic search over data schemas | read |
| `get_endpoint` | Exact lookup by method + path | read |
| `list_apis` | List all ingested API names | read |
| `list_endpoints` | List all endpoints for an API | read |
| `ingest_spec` | Ingest a spec from file/URL | admin |
| `delete_api` | Remove all docs for an API | admin |

## Authentication

Authentication is **only enforced when `NODE_ENV=production`**. Set `MCP_ADMIN_TOKEN` and/or `MCP_READ_TOKEN` in your `.env`.

- **Admin token**: full access to all tools
- **Read token**: read-only tools + Swagger UI + spec files
- **No tokens set in production**: server refuses to start
- **Development mode**: auth is disabled

## Environment Variables

See `.env.example` for all options. Key variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `CHROMA_HOST` | Remote ChromaDB server | _(local)_ |
| `CHROMA_DB_PATH` | Local DB path | `.chroma_db` |
| `OLLAMA_URL` | Ollama server for embeddings | _(none)_ |
| `OLLAMA_MODEL` | Ollama embedding model | `mxbai-embed-large` |
| `MCP_ADMIN_TOKEN` | Admin auth token | _(none)_ |
| `MCP_READ_TOKEN` | Read-only auth token | _(none)_ |
| `PORT` | HTTP server port | `3000` |
| `HOST` | HTTP server bind address | `0.0.0.0` |
| `NODE_ENV` | Environment (enables auth in production) | `development` |

## Helper Scripts

```bash
# Reconstruct a spec from ChromaDB
bun run scripts/reconstructSpec.ts darktrace -o specs/darktrace.yaml

# Convert Postman collection to OpenAPI
bun run scripts/postmanToOpenapi.ts collection.json -o specs/api.yaml

# Enrich Proxmox spec from live API
bun run scripts/proxmoxEnrich.ts

# Debug ChromaDB store
bun run scripts/debugStore.ts
```

## Tech Stack

- **Runtime**: Bun
- **Language**: TypeScript (strict)
- **HTTP**: Hono
- **MCP**: @modelcontextprotocol/sdk
- **Database**: ChromaDB
- **Embeddings**: Ollama or ChromaDB built-in
- **Validation**: Zod
- **Frontend**: Next.js 15 + React 18 + Tailwind CSS v4 + Zustand + shadcn/ui
