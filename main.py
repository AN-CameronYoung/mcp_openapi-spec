#!/usr/bin/env python3
"""
openapi-chroma CLI

Usage:
    python main.py ingest ./petstore.yaml --api petstore
    python main.py ingest https://example.com/openapi.yaml --api myapi
    python main.py query "how do I list all customers" --api stripe
    python main.py serve --port 3000
    python main.py list
"""

from __future__ import annotations

import argparse
import json
import sys


def cmd_ingest(args: argparse.Namespace) -> None:
    from src.retriever import Retriever

    r = Retriever()
    print(f"Ingesting '{args.source}' as API '{args.api}' ...")
    summary = r.ingest(args.source, args.api)
    print(
        f"Done. Ingested {summary['endpoints_ingested']} endpoints "
        f"and {summary['schemas_ingested']} schemas "
        f"({summary['total']} total documents)."
    )


def cmd_query(args: argparse.Namespace) -> None:
    from src.retriever import Retriever

    r = Retriever()
    results = r.search_endpoints(
        query=args.query,
        api=args.api or None,
        method=args.method or None,
        tag=args.tag or None,
        n=args.n,
    )
    if not results:
        print("No results found.")
        return
    for i, res in enumerate(results, 1):
        meta = res["metadata"]
        dist = res.get("distance", 0)
        print(f"\n─── Result {i}  (distance: {dist:.4f}) ─────────────────────────")
        print(f"  {meta.get('method', '')} {meta.get('path', meta.get('name', ''))}")
        print(res["text"])


def cmd_list(args: argparse.Namespace) -> None:
    from src.retriever import Retriever

    r = Retriever()
    apis = r.list_apis()
    if not apis:
        print("No APIs ingested yet.")
    else:
        print("Ingested APIs:")
        for api in apis:
            print(f"  - {api}")


def cmd_serve(args: argparse.Namespace) -> None:
    import asyncio
    from src.mcp_server import run_server

    asyncio.run(run_server(port=args.port, host=args.host, transport=args.transport))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="openapi-chroma",
        description="OpenAPI → ChromaDB → Claude retrieval tool",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # ingest
    p_ingest = sub.add_parser("ingest", help="Ingest an OpenAPI spec into ChromaDB")
    p_ingest.add_argument("source", help="File path or URL to the OpenAPI spec")
    p_ingest.add_argument("--api", required=True, help="Short name for this API (e.g. stripe)")
    p_ingest.set_defaults(func=cmd_ingest)

    # query
    p_query = sub.add_parser("query", help="Semantic search over ingested endpoints")
    p_query.add_argument("query", help="Natural language query")
    p_query.add_argument("--api", help="Filter to a specific API name")
    p_query.add_argument("--method", help="Filter by HTTP method (GET, POST, ...)")
    p_query.add_argument("--tag", help="Filter by tag (substring match)")
    p_query.add_argument("--n", type=int, default=5, help="Number of results (default: 5)")
    p_query.set_defaults(func=cmd_query)

    # list
    p_list = sub.add_parser("list", help="List all ingested APIs")
    p_list.set_defaults(func=cmd_list)

    # serve
    p_serve = sub.add_parser("serve", help="Start the MCP server")
    p_serve.add_argument("--port", type=int, default=3000, help="Port (default: 3000)")
    p_serve.add_argument("--host", default="0.0.0.0", help="Bind host (default: 0.0.0.0)")
    p_serve.add_argument(
        "--transport",
        choices=["stdio", "http"],
        default="stdio",
        help="Transport mode: stdio (local) or http (remote/homelab). Default: stdio",
    )
    p_serve.set_defaults(func=cmd_serve)

    return parser


def cli() -> None:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    cli()
