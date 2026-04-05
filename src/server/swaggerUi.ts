interface SpecEntry {
	url: string;
	name: string;
}

export function renderSwaggerUi(specs: SpecEntry[]): string {
	const urlsJson = JSON.stringify(specs);

	return `<!DOCTYPE html>
<html>
<head>
	<title>API Specs</title>
	<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
	<style>
	#ai-search {
		background: #1b1b1b;
		padding: 12px 20px;
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
		border-bottom: 1px solid #333;
		position: sticky;
		top: 0;
		z-index: 1000;
	}
	#ai-search input[type="text"] {
		flex: 1;
		min-width: 200px;
		padding: 8px 12px;
		border: 1px solid #555;
		border-radius: 4px;
		background: #2b2b2b;
		color: #e0e0e0;
		font-size: 14px;
	}
	#ai-search input[type="text"]::placeholder { color: #888; }
	#ai-search input[type="text"]:focus { outline: none; border-color: #89bf04; }
	#ai-search button {
		padding: 8px 16px;
		border: none;
		border-radius: 4px;
		background: #89bf04;
		color: #1b1b1b;
		font-weight: bold;
		cursor: pointer;
		font-size: 14px;
	}
	#ai-search button:hover { background: #9bd015; }
	#ai-search .label { color: #89bf04; font-weight: bold; font-size: 13px; white-space: nowrap; }
	#search-results {
		max-height: 0;
		overflow: hidden;
		transition: max-height 0.3s ease;
		background: #1e1e1e;
	}
	#search-results.open { max-height: 80vh; overflow-y: auto; }
	.sr-item {
		padding: 12px 20px;
		border-bottom: 1px solid #2a2a2a;
		cursor: pointer;
	}
	.sr-item:hover { background: #252525; }
	.sr-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 4px;
	}
	.sr-method {
		font-weight: bold;
		font-size: 12px;
		padding: 2px 8px;
		border-radius: 3px;
		color: #fff;
		text-transform: uppercase;
	}
	.sr-method.get { background: #61affe; }
	.sr-method.post { background: #49cc90; }
	.sr-method.put { background: #fca130; }
	.sr-method.patch { background: #50e3c2; }
	.sr-method.delete { background: #f93e3e; }
	.sr-path { font-family: monospace; color: #e0e0e0; font-size: 14px; }
	.sr-api { color: #888; font-size: 12px; margin-left: auto; }
	.sr-tags { color: #aaa; font-size: 12px; }
	.sr-desc {
		color: #999;
		font-size: 13px;
		margin-top: 4px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 800px;
	}
	.sr-dist { color: #666; font-size: 11px; }
	.sr-close {
		text-align: center;
		padding: 6px;
		color: #888;
		cursor: pointer;
		font-size: 12px;
	}
	.sr-close:hover { color: #e0e0e0; }
	.sr-empty { padding: 20px; color: #888; text-align: center; }
	.sr-loading { padding: 20px; color: #89bf04; text-align: center; }
	</style>
</head>
<body>
	<div id="ai-search">
		<span class="label">AI Search</span>
		<input type="text" id="search-input" placeholder="Describe what you're looking for... (e.g. 'list all devices', 'authenticate user')" />
		<button onclick="doSearch()">Search</button>
	</div>
	<div id="search-results"></div>
	<div id="swagger-ui"></div>
	<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
	<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js"></script>
	<script>
	const swaggerUI = SwaggerUIBundle({
		urls: ${urlsJson},
		dom_id: '#swagger-ui',
		presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
		layout: "StandaloneLayout"
	});

	const searchInput = document.getElementById('search-input');
	const resultsDiv = document.getElementById('search-results');

	searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

	async function doSearch() {
		const q = searchInput.value.trim();
		if (!q) return;
		resultsDiv.innerHTML = '<div class="sr-loading">Searching...</div>';
		resultsDiv.classList.add('open');
		try {
			const token = document.cookie.match(/token=([^;]+)/)?.[1] || '';
			const headers = {};
			if (token) headers['Authorization'] = 'Bearer ' + token;
			const resp = await fetch('/openapi/search?q=' + encodeURIComponent(q) + '&n=15', { headers });
			if (!resp.ok) throw new Error('HTTP ' + resp.status);
			const items = await resp.json();
			if (!items.length) {
				resultsDiv.innerHTML = '<div class="sr-empty">No results found.</div>';
				return;
			}
			let html = items.map(r => \`
				<div class="sr-item" onclick='jumpTo(\${JSON.stringify(JSON.stringify(r))})'>
					<div class="sr-header">
						<span class="sr-method \${r.method.toLowerCase()}">\${r.method}</span>
						<span class="sr-path">\${r.path}</span>
						<span class="sr-api">\${r.api}</span>
						<span class="sr-dist">\${r.distance}</span>
					</div>
					<div class="sr-tags">\${r.tags}</div>
					<div class="sr-desc">\${r.text.split('\\n').slice(0, 3).join(' | ')}</div>
				</div>
			\`).join('');
			html += '<div class="sr-close" onclick="closeResults()">Close results</div>';
			resultsDiv.innerHTML = html;
		} catch (err) {
			resultsDiv.innerHTML = '<div class="sr-empty">Search failed: ' + err.message + '</div>';
		}
	}

	function closeResults() {
		resultsDiv.classList.remove('open');
	}

	function jumpTo(jsonStr) {
		const r = JSON.parse(jsonStr);
		closeResults();

		function sanitize(s) { return s.replace(/[^a-zA-Z0-9_]/g, '_'); }

		function findAndExpand() {
			if (r.operation_id && r.tag) {
				const elId = 'operations-' + sanitize(r.tag) + '-' + sanitize(r.operation_id);
				const el = document.getElementById(elId);
				if (el) { expandAndScroll(el); return; }
			}

			const method = r.method.toLowerCase();
			const opblocks = document.querySelectorAll('.opblock-' + method);
			for (const block of opblocks) {
				const pathEl = block.querySelector('.opblock-summary-path, .opblock-summary-path__deprecated');
				if (pathEl) {
					const pathText = pathEl.textContent.trim().replace(/\\s+/g, '');
					if (pathText === r.path || pathText.endsWith(r.path)) {
						expandAndScroll(block);
						return;
					}
				}
			}

			const allBlocks = document.querySelectorAll('.opblock');
			for (const block of allBlocks) {
				if (block.textContent.includes(r.path)) {
					expandAndScroll(block);
					return;
				}
			}
		}

		function expandAndScroll(el) {
			const summary = el.querySelector('.opblock-summary');
			const isCollapsed = !el.classList.contains('is-open');
			if (isCollapsed && summary) summary.click();
			setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
		}

		const specs = ${urlsJson};
		const currentSelect = document.querySelector('.topbar select');
		const currentUrl = currentSelect ? currentSelect.value : '';
		const match = specs.find(s => s.name.toLowerCase().startsWith(r.api.toLowerCase()));

		if (match && currentUrl !== match.url) {
			if (currentSelect) {
				for (let opt of currentSelect.options) {
					if (opt.value === match.url) {
						currentSelect.value = match.url;
						currentSelect.dispatchEvent(new Event('change'));
						break;
					}
				}
			}
			let attempts = 0;
			const poll = setInterval(() => {
				attempts++;
				const opblocks = document.querySelectorAll('.opblock');
				if (opblocks.length > 0 || attempts > 30) {
					clearInterval(poll);
					setTimeout(findAndExpand, 300);
				}
			}, 200);
		} else {
			findAndExpand();
		}
	}
	</script>
</body>
</html>`;
}
