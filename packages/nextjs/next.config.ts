import type { NextConfig } from "next";

// Packages that contain native binaries or are otherwise un-bundleable
const SERVER_EXTERNAL = [
	"chromadb",
	"chromadb-default-embed",
	"onnxruntime-node",
	"@anthropic-ai/sdk",
	"@apidevtools/json-schema-ref-parser",
	"@jsdevtools/ono",
	"yaml",
];

const nextConfig: NextConfig = {
	// Transpile the shared workspace package (exports raw .ts source)
	transpilePackages: ["@greg/shared"],

	// Hint to Next.js's bundler to not process these server-side
	serverExternalPackages: SERVER_EXTERNAL,

	webpack(config, { isServer }) {
		if (isServer) {
			// Externalize native addons and un-bundleable packages
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			config.externals = [
				...(Array.isArray(config.externals) ? config.externals : config.externals ? [config.externals] : []),
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(ctx: { request?: string }, callback: any) => {
					const req = ctx.request ?? "";
					const shouldExternalize =
						req.endsWith(".node") ||
						SERVER_EXTERNAL.some((pkg) => req === pkg || req.startsWith(pkg + "/"));
					if (shouldExternalize) {
						callback(null, `commonjs ${req}`);
					} else {
						callback();
					}
				},
			];
		}
		return config;
	},
};

export default nextConfig;
