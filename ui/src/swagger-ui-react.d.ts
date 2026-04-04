declare module "swagger-ui-react" {
	import React from "react";

	interface SwaggerUIProps {
		url?: string;
		spec?: Record<string, unknown>;
		layout?: string;
		docExpansion?: "list" | "full" | "none";
		defaultModelsExpandDepth?: number;
		defaultModelExpandDepth?: number;
		filter?: boolean | string;
		requestInterceptor?: (req: Record<string, unknown>) => Record<string, unknown>;
		responseInterceptor?: (res: Record<string, unknown>) => Record<string, unknown>;
		onComplete?: () => void;
	}

	const SwaggerUI: React.FC<SwaggerUIProps>;
	export default SwaggerUI;
}
