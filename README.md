# cEDH Desk Analyzer

Web app that loads a Moxfield deck and analyzes per-card performance using EDHTop16 stats. It splits cards into positive and negative deltas to highlight which inclusions appear to improve conversion rates.

## Features
- Paste a Moxfield deck URL or ID to load deck data
- Fetch per-card EDHTop16 winrate stats (with/without card)
- Highlights statistically significant positive and negative deltas
- Identifies cards trending up in inclusion vs a longer baseline window
- Simple Express proxy to avoid CORS issues

## Tech Stack
- Node.js + Express
- Vanilla HTML/CSS/JS

## Prerequisites
- Node.js 18+ recommended

## Install
```bash
npm install
```

## Run
```bash
npm start
```

Then open `http://localhost:3000`.

## Deploy on Render
- Create a new **Web Service** connected to this repo.
- Use **Build Command**: `npm install`
- Use **Start Command**: `npm start`
- Render will provide `PORT`; the app already reads it in [`server.js`](/C:/Users/andre/OneDrive/Documents/cEDH Desk Analyzer/server.js).
- Optional health check path: `/health`

If you deploy from this repo as-is, the Express server will host both the frontend and the API routes.

## Usage
1. Paste a Moxfield deck link or public ID.
2. Click **Load Deck**.
3. Wait for EDHTop16 stats to load. The results appear in the Positive/Negative Delta tables.

## API
The server exposes two endpoints:
- `GET /api/deck?id=<moxfield-id-or-url>`  
  Proxies Moxfield deck data from `https://api.moxfield.com/v2/decks/all/<id>`.
- `GET /api/edhtop16?commander=<name>&card=<name>&timePeriod=<period>&minEventSize=<n>`  
  Proxies EDHTop16 card stats. Defaults to `timePeriod=ONE_YEAR` and `minEventSize=50`.

## Configuration
In `app.js`:
- `timePeriod` is set to `THREE_MONTHS`
- `minEventSize` is set to `50`

In `server.js`:
- `PORT` defaults to `3000` (override with `PORT` env var)
- EDHTop16 responses are cached for 1 hour

## Notes
- Some cards may return `n/a` if EDHTop16 has insufficient samples.
- If EDHTop16 rejects a commander string, use the exact commander name used on EDHTop16.
