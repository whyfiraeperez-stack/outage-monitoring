# NAP NOC Agent

Install the Vercel coding-agent plugin with:
npx plugins add vercel/vercel-plugin

Rules:
- Treat raw incident fields as authoritative.
- NAP DOWN is exactly STATUS = PENDING.
- Never silently overwrite manual/raw fields.
- Audit the actual live formulas before repairing them.
- Repair only approved derived formula columns.
- Use exact elapsed hours for operational SLA.
- Prefer the Google Sheets API for fast synchronization; published CSV is fallback only.
