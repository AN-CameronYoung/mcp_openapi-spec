export const METHOD_COLORS: Record<string, { bg: string; text: string; border: string }> = {
	GET: { bg: "var(--g-method-get-bg)", text: "var(--g-method-get-text)", border: "var(--g-method-get-border)" },
	POST: { bg: "var(--g-method-post-bg)", text: "var(--g-method-post-text)", border: "var(--g-method-post-border)" },
	PUT: { bg: "var(--g-method-put-bg)", text: "var(--g-method-put-text)", border: "var(--g-method-put-border)" },
	DELETE: { bg: "var(--g-method-del-bg)", text: "var(--g-method-del-text)", border: "var(--g-method-del-border)" },
	PATCH: { bg: "var(--g-method-patch-bg)", text: "var(--g-method-patch-text)", border: "var(--g-method-patch-border)" },
};
