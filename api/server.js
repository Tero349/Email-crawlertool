"use strict";

const express = require('express');
const axios = require('axios').default;
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors());

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}/g;

function extractCandidateNames($) {
	const candidates = new Set();
	const metaAuthor = $('meta[name="author"]').attr('content');
	if (metaAuthor) candidates.add(metaAuthor.trim());
	const ogSite = $('meta[property="og:site_name"]').attr('content');
	if (ogSite) candidates.add(ogSite.trim());
	const title = $('title').first().text();
	if (title) candidates.add(title.trim());
	const h1 = $('h1').first().text();
	if (h1) candidates.add(h1.trim());
	$('p, h2, h3').slice(0, 10).each((_, el) => {
		const t = $(el).text().trim();
		if (t) candidates.add(t);
	});
	return Array.from(candidates);
}

function findNameNearEmail($, email) {
	try {
		const el = $(`*:contains('${email}')`).first();
		if (el && el.length) {
			const context = el.closest('p, li, div, section').text() || el.text();
			const name = bestNameFromText(context);
			if (name) return name;
		}
	} catch (e) {
		// ignore selector errors
	}
	return null;
}

function bestNameFromText(text) {
	if (!text) return null;
	const NAME_REGEX = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b/g;
	let best = null;
	let match;
	while ((match = NAME_REGEX.exec(text)) !== null) {
		const cand = match[1].trim();
		if (cand.length >= 4 && cand.length <= 60) {
			best = cand;
			break;
		}
	}
	return best;
}

async function fetchHtml(url) {
	const res = await axios.get(url, {
		responseType: 'text',
		headers: {
			'User-Agent': 'Mozilla/5.0 (compatible; EmailNameExtractor/1.0)'
		},
		timeout: 15000,
		validateStatus: s => s >= 200 && s < 400
	});
	return res.data || '';
}

async function processUrl(url) {
	try {
		const html = await fetchHtml(url);
		const $ = cheerio.load(html);
		const pageText = $('body').text();
		const emails = new Set((pageText.match(EMAIL_REGEX) || []).map(e => e.trim().toLowerCase()));
		if (emails.size === 0) return [];

		const nameCandidates = extractCandidateNames($).join(' \n ');
		const results = [];
		for (const email of emails) {
			let name = findNameNearEmail($, email);
			if (!name) name = bestNameFromText(nameCandidates);
			results.push({ email, name: name || '' });
		}
		return results;
	} catch (err) {
		return [];
	}
}

app.post('/api/scrape', async (req, res) => {
	try {
		const urls = Array.isArray(req.body && req.body.urls) ? req.body.urls : [];
		if (!urls || urls.length === 0) return res.json({ results: [] });
		const all = [];
		for (const url of urls) {
			const rows = await processUrl(url);
			all.push(...rows);
		}
		// Dedup by email
		const seen = new Set();
		const deduped = [];
		for (const r of all) {
			if (!r || !r.email) continue;
			if (seen.has(r.email)) continue;
			seen.add(r.email);
			deduped.push({ email: r.email, name: r.name || '' });
		}
		res.json({ results: deduped });
	} catch (err) {
		res.status(500).json({ error: 'Internal error' });
	}
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
	console.log(`API listening on :${PORT}`);
});