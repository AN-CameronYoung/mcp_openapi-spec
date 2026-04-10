import fs from "fs/promises";
import path from "path";
import { NextRequest } from "next/server";

// Next.js server runs from the package root — swagger-ui-react is in node_modules there
const pkgDir = path.join(process.cwd(), "node_modules", "swagger-ui-react");

const ASSETS: Record<string, { file: string; contentType: string }> = {
	bundle: { file: "swagger-ui-bundle.js", contentType: "application/javascript; charset=utf-8" },
	css: { file: "swagger-ui.css", contentType: "text/css; charset=utf-8" },
};

/**
 * Serves pre-built swagger-ui-react dist files (bundle JS and CSS) so the
 * docs page can load them at runtime via <script>/<link> tags, bypassing
 * Turbopack's ESM bundling which incorrectly resolves @swagger-api/apidom-*
 * modules and causes `refract is not a function` errors.
 */
export const GET = async (
	_req: NextRequest,
	{ params }: { params: Promise<{ file: string }> },
): Promise<Response> => {
	const { file } = await params;
	const asset = ASSETS[file];
	if (!asset) return new Response("not found", { status: 404 });

	try {
		const content = await fs.readFile(path.join(pkgDir, asset.file));
		return new Response(content, {
			headers: {
				"Content-Type": asset.contentType,
				"Cache-Control": "public, max-age=86400, immutable",
			},
		});
	} catch {
		return new Response("not found", { status: 404 });
	}
};
