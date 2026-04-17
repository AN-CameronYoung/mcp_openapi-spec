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

The UI is a chat-first interface named **greg** — an API documentation assistant that combines conversational AI with interactive API and doc browsing.

### Personalities

Four assistant personalities, each with distinct tone, color, and system prompt:

| Personality | Color | Style |
|-------------|-------|-------|
| `greg` | green | Casual, slangy ("greg here. what api u need") |
| `explanatory` | orange | In-depth technical explanations |
| `quick` | blue | Brief, direct answers |
| `casual` | purple | Relaxed ("ok") |

Switch personalities via the picker in the input bar. Each personality has a configurable custom system prompt.

### Chat

- Real-time streaming with smooth character reveal animation
- Full GitHub-flavored markdown: tables, code blocks, headings, blockquotes, lists, links, images
- Syntax-highlighted code blocks (TypeScript, JavaScript, Python, Bash, JSON, YAML, and more)
- Code blocks >30 lines auto-collapse with a "code: N lines" header and copy button
- Ordered lists >2 items auto-collapse into expandable items
- Sections auto-collapse into dropdowns when 2+ headings are present in a response
- Inline Mermaid diagram rendering (flowchart, sequence, ER, state, C4 architecture) — export as SVG / PNG / PDF or copy to clipboard
- Inline detection of `METHOD /path` patterns in response text; mentioned endpoints are auto-promoted to the top of the results panel
- Per-message metadata: model name, input/output token counts, tool call count badge, copy button, delete button

### Inline Results Panels

After each response, collapsible panels show what the assistant retrieved:

**Endpoint cards** — API endpoints retrieved during the response, sorted by relevance score. Each card shows the HTTP method (color-coded), path with highlighted parameters, API name, description, and any warnings. Click a card to open the Swagger panel and scroll to that endpoint.

**Doc cards** — Documentation sections retrieved, grouped by document name. Each entry shows the doc name, project badge, and matching headings. Click an entry to open the Docs panel and scroll to that heading.

### Quick Actions (per message)

- **Diagram** — dropdown with 5 Mermaid diagram types: Flowchart, Sequence, ER, State, C4 Architecture. Disabled if a diagram already exists in the response.
- **Code** — dropdown for cURL, Python, or JavaScript snippets. Disabled if code already exists.
- **Fork** — branches the conversation from that message into a new tab (main conversation only).

### Tool Call Activity

While the assistant is responding, a live inline panel shows each tool call as it executes: tool name, input parameters, token count, and a preview of the result (first 600 chars, expandable). A summary header shows total tool calls and tokens once complete.

### Verification Badge

When the double-check toggle is on, a verification pass runs after each response:
- **Verified**: green checkmark with verification text and token count
- **Corrected**: orange alert with expandable correction rendered as markdown

### Debug Panel

Click the bug icon on any assistant message (when debug data exists) to open a trace panel showing:
- Per-round token counts (input, output, stop reason)
- Each tool call: name, inputs, result preview
- Token breakdown (primary, verification, tool calls)
- Auto-compact status and token savings
- Estimated USD cost (calculated from Anthropic pricing tables)
- Compacted history sent to the API (when auto-compact is on)

### Input Bar Controls

| Control | Description |
|---------|-------------|
| Personality picker | Switch between greg / explanatory / quick / casual |
| Model selector | Pick any Anthropic or Ollama model; defaults to store default |
| Token counter | Shows context window usage; turns yellow at warning threshold, red at critical; a **Compact** button appears at red |
| Auto-compact toggle | When on, strips code blocks from history after each response to preserve context (full text remains visible in the UI) |
| APIs toggle | Show/hide the Swagger panel |
| Docs toggle | Show/hide the Docs panel |
| Send / Stop | Send message (Enter) or abort streaming (shown while streaming) |

**Keyboard shortcuts:** `Enter` to send, `Shift+Enter` for a new line, `/clear` to add a context boundary (clears API history for the next request while keeping messages visible).

### Sidebar

A collapsible, resizable chat history sidebar (drag to resize, 180–520px, persisted):
- Search bar to filter by title
- New chat button
- Chats grouped by time period (Today, Yesterday, Last 7 days, Earlier)
- Per-chat timestamps, delete on hover
- Bulk selection mode with multi-delete

### Conversation Tabs & Forking

- **Main conversation**: the primary thread
- **Branch conversations**: forked from any message in the main thread; prepends the parent context automatically
- Tab bar shows all open conversations with close buttons
- Fork context header shows the parent name and the message excerpt the fork originated from

### Side Panels

**Swagger / API panel** — full Swagger UI for any ingested API. Includes an API selector (grouped by project), endpoint search with previous/next navigation, zoom controls (0.6×–1.6×, persisted), and a popout button.

**Docs panel** — rendered markdown documentation. Includes a doc selector, search with navigation, pagination for large documents (split at H1/H2 boundaries), zoom controls (50–160%, persisted), and auto-scroll to a specific heading when opened from a doc card.

### Follow-up Suggestions

Inline follow-up question pills appear below each response, generated from a `<followups>` tag in the stream. A refresh button regenerates them. A "generating follow-ups…" indicator is shown while pending.

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
