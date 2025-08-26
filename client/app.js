'use strict';

const state = {
	index: [],
	results: [],
	inProgress: false
};

async function loadIndex() {
	try {
		const res = await fetch('./index.json', { cache: 'no-store' });
		if (!res.ok) throw new Error('Failed to load index.json');
		const data = await res.json();
		if (Array.isArray(data)) {
			state.index = data;
		} else if (Array.isArray(data.entries)) {
			state.index = data.entries;
		} else {
			throw new Error('index.json must be an array or {entries: []}');
		}
		document.getElementById('indexSummary').textContent = summarizeIndex(state.index);
		setStatus('Index loaded. Ready.');
	} catch (err) {
		console.error(err);
		setStatus('Failed to load index.json. Add a file at /client/index.json');
	}
}

function summarizeIndex(entries) {
	const totalUrls = entries.reduce((sum, e) => sum + (e.urls ? e.urls.length : 0), 0);
	const sample = entries.slice(0, 5).map(e => `${e.keyword} (${(e.urls||[]).length})`).join(', ');
	return `Entries: ${entries.length}\nTotal URLs: ${totalUrls}\nSample: ${sample}`;
}

function setStatus(text) {
	document.getElementById('statusText').textContent = text;
}

function setProgress(done, total) {
	const el = document.getElementById('progress');
	if (total <= 0) { el.value = 0; el.max = 100; return; }
	el.max = total;
	el.value = done;
}

function parseKeywords(raw) {
	return raw
		.split(',')
		.map(k => k.trim())
		.filter(Boolean)
		.filter((v, i, a) => a.indexOf(v) === i);
}

function findUrlsForKeyword(entries, keyword, limit) {
	const lowered = keyword.toLowerCase();
	// Prefer exact match on keyword field
	let urls = [];
	for (const entry of entries) {
		if (!entry || !entry.keyword || !Array.isArray(entry.urls)) continue;
		if (entry.keyword.toLowerCase() === lowered) {
			urls = entry.urls;
			break;
		}
	}
	// Fallback: partial includes
	if (urls.length === 0) {
		for (const entry of entries) {
			if (!entry || !entry.keyword || !Array.isArray(entry.urls)) continue;
			if (entry.keyword.toLowerCase().includes(lowered)) {
				urls = urls.concat(entry.urls);
			}
		}
	}
	// Dedup and limit
	const deduped = Array.from(new Set(urls));
	return deduped.slice(0, limit);
}

async function scrapeBatch(apiBase, urls) {
	const endpoint = apiBase ? `${apiBase.replace(/\/$/, '')}/api/scrape` : '/api/scrape';
	const res = await fetch(endpoint, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ urls })
	});
	if (!res.ok) throw new Error('API error');
	return res.json();
}

function toWorksheetData(rows) {
	return rows.map(r => ({ Keyword: r.keyword, Name: r.name || '', Email: r.email || '' }));
}

function exportXLSX(rows) {
	const data = toWorksheetData(rows);
	const wb = XLSX.utils.book_new();
	const ws = XLSX.utils.json_to_sheet(data);
	XLSX.utils.book_append_sheet(wb, ws, 'Results');
	XLSX.writeFile(wb, 'extracted_emails.xlsx');
}

async function handleStart() {
	if (state.inProgress) return;
	state.results = [];
	state.inProgress = true;
	setStatus('Processing...');
	document.getElementById('downloadBtn').disabled = true;

	const rawKeywords = document.getElementById('keywords').value || '';
	const maxResults = Math.max(1, parseInt(document.getElementById('maxResults').value || '1', 10));
	const apiBase = (document.getElementById('apiBase').value || '').trim();
	const keywords = parseKeywords(rawKeywords);

	if (keywords.length === 0) {
		setStatus('Enter at least one keyword.');
		state.inProgress = false;
		return;
	}

	let totalUrls = 0;
	const keywordToUrls = new Map();
	for (const kw of keywords) {
		const urls = findUrlsForKeyword(state.index, kw, maxResults);
		keywordToUrls.set(kw, urls);
		totalUrls += urls.length;
	}

	if (totalUrls === 0) {
		setStatus('No URLs matched in the local index.');
		state.inProgress = false;
		return;
	}

	let processed = 0;
	setProgress(0, totalUrls);

	for (const [kw, urls] of keywordToUrls.entries()) {
		if (urls.length === 0) continue;
		try {
			const batchResults = await scrapeBatch(apiBase, urls);
			const rows = [];
			for (const r of batchResults.results || []) {
				if (!r || !r.email) continue;
				rows.push({ keyword: kw, email: r.email, name: r.name || '' });
			}
			state.results.push(...rows);
			processed += urls.length;
			setProgress(processed, totalUrls);
			setStatus(`Processed ${processed}/${totalUrls} URLs...`);
		} catch (err) {
			console.error(err);
			processed += urls.length;
			setProgress(processed, totalUrls);
			setStatus(`Error processing some URLs. Continuing... (${processed}/${totalUrls})`);
		}
	}

	// Deduplicate by keyword+email
	const seen = new Set();
	state.results = state.results.filter(r => {
		const key = `${r.keyword}|${r.email}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	state.inProgress = false;
	setStatus(`Done. ${state.results.length} unique email rows.`);
	document.getElementById('downloadBtn').disabled = state.results.length === 0;
}

function init() {
	document.getElementById('startBtn').addEventListener('click', handleStart);
	document.getElementById('downloadBtn').addEventListener('click', () => exportXLSX(state.results));
	loadIndex();
}

document.addEventListener('DOMContentLoaded', init);