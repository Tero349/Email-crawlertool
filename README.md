# Email & Name Extractor (Static + Serverless)

A static web tool with a minimal serverless-style API that:
- Searches a local JSON index for URLs by keyword
- Fetches each page and extracts emails and names
- Exports results to an Excel (.xlsx) file using SheetJS

No third-party search engines or external APIs are used.

## Project Structure

```
client/          # Static site (index.html, app.js, style.css, index.json)
api/             # Node/Express API for scraping (axios + cheerio)
render.yaml      # Render blueprint (static + web service)
```

## Local Development

1. Install API deps:

```bash
cd api && npm install
```

2. Run API locally (default :3001):

```bash
npm start
```

3. Serve the static client (any static server). For quick testing:

```bash
# from project root
python3 -m http.server 3000 --directory client
```

4. Open the app: http://localhost:3000

- Leave API base URL empty if you reverse-proxy; otherwise set it to `http://localhost:3001` in the UI.
- Edit `client/index.json` to provide your own keywords and URLs.

## Index Format

`client/index.json` can be either an array or an object with `entries`:

```json
[
  { "keyword": "plumber", "urls": ["https://site1/contact", "https://site2/"] },
  { "keyword": "electrician", "urls": ["https://..."] }
]
```

Each `urls` item should be a fully qualified URL. The UI will cap per-keyword URLs based on the "Max results" field.

## Outputs

- Columns: `Keyword`, `Name`, `Email`
- Downloaded as `extracted_emails.xlsx`

## Deployment on Render

This repo includes `render.yaml` defining two services:
- Web service: Node API in `api/`
- Static site: `client/`

1. Push to GitHub.
2. In Render, "New +" → "Blueprint" → connect your repo.
3. Review and create resources. Once deployed:
   - API URL will look like `https://<api-service>.onrender.com`
   - Static site will be available at its own URL
4. In the UI, set API base URL to the API service URL.

## Notes

- The scraper performs simple name inference using nearby text and metadata; results vary by site.
- The API does not return source URLs by design; only `email` and `name` are returned.
- Respect target website robots and terms; use responsibly. 
