import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

// Load local index from data/index.json
const indexPath = path.join(__dirname, 'data', 'index.json');
let localIndex = [];
try {
	if (fs.existsSync(indexPath)) {
		const raw = fs.readFileSync(indexPath, 'utf-8');
		localIndex = JSON.parse(raw);
		if (!Array.isArray(localIndex)) {
			localIndex = [];
		}
	}
} catch (err) {
	console.error('Failed to load local index:', err.message);
	localIndex = [];
}

// Helpers
function normalizeString(value) {
	return (value || '').toString().toLowerCase();
}

function searchIndexForKeyword(indexEntries, keyword, limit) {
	const q = normalizeString(keyword);
	const results = [];
	for (const entry of indexEntries) {
		if (results.length >= limit) break;
		const url = entry.url || '';
		const title = entry.title || '';
		const keywords = Array.isArray(entry.keywords) ? entry.keywords.join(' ') : (entry.keywords || '');
		const haystack = `${url} ${title} ${keywords}`.toLowerCase();
		if (haystack.includes(q)) {
			results.push(url);
		}
	}
	return results;
}

function extractEmailsAndNames(html, url) {
	const $ = cheerio.load(html);
	const foundEmails = new Map(); // email -> name|null

	// Collect from mailto anchors first
	$('a[href^="mailto:"]').each((_, el) => {
		const href = $(el).attr('href') || '';
		const email = href.replace(/^mailto:/i, '').split('?')[0].trim();
		if (email && /.+@.+\..+/.test(email)) {
			let name = ($(el).text() || '').trim();
			if (!name) {
				const parentText = ($(el).parent().text() || '').replace(email, '').trim();
				if (parentText && parentText.length <= 80) {
					name = parentText;
				}
			}
			if (name) name = sanitizeName(name);
			if (!foundEmails.has(email)) {
				foundEmails.set(email, name || null);
			}
		}
	});

	// Fallback: regex search in text
	const textContent = $('body').text();
	const htmlContent = $.html();
	const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
	const seenPositions = new Set();
	let match;
	while ((match = emailRegex.exec(htmlContent)) !== null) {
		const email = match[0];
		if (!foundEmails.has(email)) {
			const near = getNameNearPosition(htmlContent, match.index, email);
			foundEmails.set(email, near || null);
		}
		seenPositions.add(match.index);
	}

	const results = [];
	for (const [email, name] of foundEmails.entries()) {
		results.push({ email, name: name || null });
	}
	return results;
}

function sanitizeName(name) {
	let n = name.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
	// If name looks like an email or too long, drop it
	if (/.+@.+\..+/.test(n) || n.length > 80) return '';
	// Prefer capitalized words up to 4 words
	const nameRegex = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/;
	const m = n.match(nameRegex);
	if (m) return m[1].trim();
	return n;
}

function getNameNearPosition(html, index, email) {
	const windowSize = 120; // chars around email
	const start = Math.max(0, index - windowSize);
	const end = Math.min(html.length, index + email.length + windowSize);
	const snippet = html.slice(start, end).replace(/<[^>]+>/g, ' ').replace(/\s{2,}/g, ' ').trim();
	const cleaned = snippet.replace(email, '');
	const namePattern = /([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/;
	const m = cleaned.match(namePattern);
	if (m) {
		return sanitizeName(m[1]);
	}
	return '';
}

app.get('/api/health', (req, res) => {
	res.json({ ok: true });
});

app.get('/api/index', (req, res) => {
	res.json({ count: localIndex.length, index: localIndex });
});

app.post('/api/search', (req, res) => {
	const { keywords, limit } = req.body || {};
	if (!Array.isArray(keywords) || typeof limit !== 'number') {
		return res.status(400).json({ error: 'Invalid payload. Expected { keywords: string[], limit: number }' });
	}
	const perKeyword = {};
	for (const kw of keywords) {
		perKeyword[kw] = searchIndexForKeyword(localIndex, kw, limit);
	}
	res.json({ results: perKeyword });
});

app.post('/api/scrape', async (req, res) => {
	const { url } = req.body || {};
	if (!url || typeof url !== 'string') {
		return res.status(400).json({ error: 'Invalid payload. Expected { url: string }' });
	}
	try {
		const response = await axios.get(url, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
			},
			timeout: 15000,
			maxRedirects: 5,
			responseType: 'text',
			validateStatus: () => true
		});
		if (!response || typeof response.data !== 'string') {
			return res.status(502).json({ error: 'Failed to fetch HTML content' });
		}
		const html = response.data;
		const extracted = extractEmailsAndNames(html, url);
		res.json({ url, results: extracted });
	} catch (err) {
		res.status(502).json({ error: 'Fetch failed', details: err.message });
	}
});

// Optional: serve frontend for local testing if present
const frontendPath = path.join(__dirname, '..', 'frontend');
if (fs.existsSync(frontendPath)) {
	app.use('/', express.static(frontendPath));
}

app.listen(PORT, () => {
	console.log(`API listening on port ${PORT}`);
});