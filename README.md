# openapi-chroma

OpenAPI spec ingestion into ChromaDB with an MCP server for Claude. Ingest any OpenAPI v2/v3 spec and search it semantically via MCP tools.

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

### Frontend (React SPA)

```bash
cd ui
bun install
bun run dev
```

The frontend proxies `/openapi/*` to the backend on port 3000. Start the backend first with `--transport http`.

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
- **No tokens set in production**: all endpoints are open (warning logged)
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
- **Frontend**: React + Vite + Tailwind CSS + Zustand + React Router
