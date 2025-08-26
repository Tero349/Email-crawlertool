# Keyword Email Extractor (Self-hosted)

A static web UI with a small Node API that searches a local index of URLs per keyword, fetches webpages, extracts emails and nearby names, and exports results to Excel (.xlsx). No external search engines or third-party APIs.

## Features
- Keyword input (comma-separated) and per-keyword result limit
- Local index search (server-provided or user-uploaded JSON/CSV)
- Scraping via axios with HTML parsing via Cheerio
- Email + nearby name extraction
- Excel export via SheetJS (client-side)
- Single service deploy: Express serves API and static frontend

## Project Structure
- `server/`: Express API, also serves `frontend/`
  - `data/index.json`: Example local index entries
- `frontend/`: Static UI (`index.html`, `app.js`, `styles.css`, `config.js`)

## Local Development
1. Start the API + frontend:
```
cd server
npm install
npm start
```
2. Open http://localhost:3001
3. Enter keywords and max results, choose index source:
   - Use server index (default)
   - Or upload your own JSON/CSV with columns/fields: `url`, `title` (optional), `keywords` (optional; CSV uses `;`-separated list)
4. Click Start to scrape and then download the `results.xlsx` file.

## CSV Format
- Header required: `url` (required), `title` (optional), `keywords` (optional; `;`-separated)

Example:
```
url,title,keywords
https://example.com,Example,"contact;team"
```

## Configuration
- `frontend/config.js` allows setting `API_BASE_URL` if the API is hosted on a different origin. Leave empty when Express serves the frontend.

## Deployment on Render
You can deploy as a single Web Service that serves both API and static frontend.

Option A: Using render.yaml (recommended)
- Push this repo to GitHub.
- In Render, create a new Blueprint from repository.
- Render will read `render.yaml` and create the service.

Option B: Manual Web Service
- New Web Service → Select repo
- Runtime: Node
- Root Directory: `server`
- Build Command: `npm install`
- Start Command: `npm start`

After deploy, visit the Render URL. The frontend is served at `/` and calls API endpoints under `/api/*`.

## Notes
- The example index is small. Replace `server/data/index.json` with your own dataset, or upload an index file via the UI.
- The scraper uses a simple heuristic to associate names near emails. It may not always find a name; in that case the Name cell is left blank.
- Respect robots.txt and site policies for any URLs in your local index.

## License
MIT 
