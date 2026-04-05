FROM oven/bun:1-debian

WORKDIR /app

# Copy workspace root config
COPY package.json tsconfig.base.json ./

# Copy shared types package
COPY packages/shared ./packages/shared/

# Copy mcp-server package
COPY packages/mcp-server ./packages/mcp-server/

# Install dependencies
RUN bun install --production

# Specs get mounted at runtime
RUN mkdir -p specs

EXPOSE 3000

CMD ["bun", "run", "packages/mcp-server/main.ts", "serve", "--transport", "http"]
