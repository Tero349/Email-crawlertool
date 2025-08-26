(function(){
	const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || '';
	const keywordsInput = document.getElementById('keywordsInput');
	const maxResultsInput = document.getElementById('maxResultsInput');
	const startBtn = document.getElementById('startBtn');
	const progressText = document.getElementById('progressText');
	const progressFill = document.getElementById('progressFill');
	const downloadLink = document.getElementById('downloadLink');
	const uploadRow = document.getElementById('uploadRow');
	const indexFileInput = document.getElementById('indexFile');
	const indexSourceRadios = document.querySelectorAll('input[name="indexSource"]');

	let uploadedIndex = [];

	indexSourceRadios.forEach(r => {
		r.addEventListener('change', () => {
			const val = getIndexSource();
			uploadRow.style.display = val === 'upload' ? '' : 'none';
		});
	});

	startBtn.addEventListener('click', async () => {
		try {
			resetProgress();
			downloadLink.style.display = 'none';
			const { keywords, limit } = getInputs();
			validateInputs(keywords, limit);

			const indexSource = getIndexSource();
			let perKeywordUrls = {};
			if (indexSource === 'server') {
				perKeywordUrls = await postJson(`${API_BASE}/api/search`, { keywords, limit });
				perKeywordUrls = perKeywordUrls.results || {};
			} else {
				if (!uploadedIndex || uploadedIndex.length === 0) {
					throw new Error('Please upload an index file first.');
				}
				perKeywordUrls = searchLocalIndex(uploadedIndex, keywords, limit);
			}

			const tasks = [];
			for (const kw of keywords) {
				const urls = perKeywordUrls[kw] || [];
				for (const url of urls) {
					tasks.push({ keyword: kw, url });
				}
			}
			if (tasks.length === 0) {
				setProgress(100, 'No URLs matched the keywords.');
				return;
			}

			const results = await runScrapeTasks(tasks, (done, total) => {
				const pct = Math.round((done / total) * 100);
				setProgress(pct, `Processed ${done}/${total} pages...`);
			});

			const rows = [];
			for (const r of results) {
				for (const item of r.results) {
					rows.push({ Keyword: r.keyword, Name: item.name || '', Email: item.email });
				}
			}

			if (rows.length === 0) {
				setProgress(100, 'Done. No emails found.');
				return;
			}

			const wb = XLSX.utils.book_new();
			const ws = XLSX.utils.json_to_sheet(rows, { header: ['Keyword', 'Name', 'Email'] });
			XLSX.utils.book_append_sheet(wb, ws, 'Results');
			const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
			const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
			const url = URL.createObjectURL(blob);
			downloadLink.href = url;
			downloadLink.style.display = '';
			setProgress(100, `Done. Found ${rows.length} emails. Download ready.`);
		} catch (err) {
			setProgress(0, `Error: ${err.message}`);
		}
	});

	indexFileInput.addEventListener('change', async () => {
		const file = indexFileInput.files && indexFileInput.files[0];
		if (!file) return;
		const ext = (file.name.split('.').pop() || '').toLowerCase();
		if (ext === 'json') {
			uploadedIndex = await readJsonFile(file);
		} else if (ext === 'csv') {
			uploadedIndex = await readCsvFile(file);
		} else {
			setProgress(0, 'Unsupported file type. Upload .json or .csv');
		}
	});

	function getIndexSource(){
		const el = document.querySelector('input[name="indexSource"]:checked');
		return el ? el.value : 'server';
	}
	function getInputs(){
		const keywords = (keywordsInput.value || '').split(',').map(s => s.trim()).filter(Boolean);
		const limit = parseInt(maxResultsInput.value, 10) || 5;
		return { keywords, limit };
	}
	function validateInputs(keywords, limit){
		if (!keywords || keywords.length === 0) throw new Error('Enter at least one keyword');
		if (limit < 1 || limit > 50) throw new Error('Max results must be between 1 and 50');
	}

	function resetProgress(){
		progressFill.style.width = '0%';
		progressText.textContent = 'Idle.';
	}
	function setProgress(pct, text){
		progressFill.style.width = `${pct}%`;
		progressText.textContent = text;
	}

	async function postJson(url, body){
		const res = await axios.post(url, body, { headers: { 'Content-Type': 'application/json' } });
		return res.data;
	}

	function searchLocalIndex(indexEntries, keywords, limit){
		const map = {};
		for (const kw of keywords) {
			const results = [];
			const q = (kw || '').toLowerCase();
			for (const entry of indexEntries) {
				if (results.length >= limit) break;
				const url = entry.url || '';
				const title = entry.title || '';
				const keywordsText = Array.isArray(entry.keywords) ? entry.keywords.join(' ') : (entry.keywords || '');
				const haystack = `${url} ${title} ${keywordsText}`.toLowerCase();
				if (haystack.includes(q)) results.push(url);
			}
			map[kw] = results;
		}
		return map;
	}

	async function runScrapeTasks(tasks, onProgress){
		const results = [];
		let done = 0;
		const concurrency = 4;
		let i = 0;
		async function worker(){
			while (i < tasks.length) {
				const task = tasks[i++];
				try {
					const resp = await postJson(`${API_BASE}/api/scrape`, { url: task.url });
					results.push({ keyword: task.keyword, url: task.url, results: resp.results || [] });
				} catch (e) {
					results.push({ keyword: task.keyword, url: task.url, results: [] });
				}
				done++;
				onProgress(done, tasks.length);
			}
		}
		const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
		await Promise.all(workers);
		return results;
	}

	function readJsonFile(file){
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				try { resolve(JSON.parse(reader.result)); } catch (e) { reject(e); }
			};
			reader.onerror = () => reject(new Error('Failed to read file'));
			reader.readAsText(file);
		});
	}

	function readCsvFile(file){
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => {
				try {
					const text = String(reader.result || '');
					const lines = text.split(/\r?\n/).filter(Boolean);
					const header = lines[0].split(',').map(h => h.trim().toLowerCase());
					const urlIdx = header.indexOf('url');
					const titleIdx = header.indexOf('title');
					const keywordsIdx = header.indexOf('keywords');
					if (urlIdx === -1) throw new Error('CSV must include a url column');
					const arr = [];
					for (let i = 1; i < lines.length; i++) {
						const cols = lines[i].split(',');
						const url = cols[urlIdx] || '';
						const title = titleIdx !== -1 ? (cols[titleIdx] || '') : '';
						const keywords = keywordsIdx !== -1 ? (cols[keywordsIdx] || '').split(';').map(s => s.trim()).filter(Boolean) : [];
						if (url) arr.push({ url, title, keywords });
					}
					resolve(arr);
				} catch (e) { reject(e); }
			};
			reader.onerror = () => reject(new Error('Failed to read file'));
			reader.readAsText(file);
		});
	}
})();