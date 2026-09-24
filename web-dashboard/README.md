# NAP NOC Live Monitoring — Vercel Dashboard

A dark, NOC-style live dashboard modeled on the supplied reference image.

## Stack
- Next.js 14
- React
- Recharts
- Vercel
- Google Sheets GViz CSV reader

## Source
Default spreadsheet:
- ID: `1yhtm8pTJ9VP0TUrFm2JedYoCZ_M22K196luw3u9Xl4s`
- DATABASE GID: `946404240`

## Vercel deployment
Set the Vercel project root to **web-dashboard**.

Environment variables:
```
GOOGLE_SHEET_ID=1yhtm8pTJ9VP0TUrFm2JedYoCZ_M22K196luw3u9Xl4s
GOOGLE_SHEET_GID=946404240
```

The server route refreshes from Google Sheets with `cache: no-store`; the browser refreshes the dashboard every 60 seconds.

## Data-quality agent
The API normalizes headers, statuses, dates, SLA labels, blank RFO values, and invalid/missing source fields for dashboard use. It does not overwrite the Google Sheet. Source-writing repairs should remain in the Apps Script layer.

## Access
The default GViz reader requires the Google Sheet to be accessible to the Vercel server. If the sheet is confidential, replace the GViz reader with a Google Sheets API service-account implementation and store credentials only in Vercel Environment Variables.
