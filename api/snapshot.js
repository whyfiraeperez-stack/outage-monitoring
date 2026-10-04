const {getSnapshot} = require('../lib/server.cjs');

const DASHBOARD_BUILD = '2026-10-04-nap-sync-2';

function enforceNapCodeSync(snapshot) {
  const clean = v => String(v ?? '').replace(/\u00a0/g, ' ').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  const norm = v => clean(v).toUpperCase();
  const parseDisplay = value => {
    const m = clean(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (!m) return NaN;
    let hour = Number(m[4]);
    const ap = String(m[7] || '').toUpperCase();
    if (ap === 'PM' && hour < 12) hour += 12;
    if (ap === 'AM' && hour === 12) hour = 0;
    return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), hour, Number(m[5]), Number(m[6] || 0));
  };
  const minute = ms => Number.isNaN(ms) ? '' : new Date(ms).toISOString().slice(0,16);
  const key = r => [norm(r.province), norm(r.municipality), norm(r.finding)].join('|');
  const exact = new Map();
  for (const n of (snapshot.napDownRows || [])) {
    const code = clean(n.napCode);
    const t = parseDisplay(n.dateEndorsedDisplay);
    if (!code || Number.isNaN(t)) continue;
    const k = key(n) + '|' + minute(t);
    const list = exact.get(k) || [];
    list.push(n);
    exact.set(k, list);
  }
  let matched = 0, unmatched = 0;
  for (const row of (snapshot.rows || [])) {
    if (norm(row.finalStatus) !== 'PENDING') continue;
    const t = Date.parse(row.timestamp || '');
    const matches = exact.get(key(row) + '|' + minute(t)) || [];
    if (matches.length === 1) {
      row.napCode = clean(matches[0].napCode);
      matched++;
    } else {
      row.napCode = row.napCode || '';
      unmatched++;
    }
  }
  snapshot.dashboardBuild = DASHBOARD_BUILD;
  snapshot.diagnostics = {
    ...(snapshot.diagnostics || {}),
    napCodeMatched: matched,
    napCodeUnmatchedPending: unmatched,
    napCodeMatchRule: 'exact province + municipality + finding + minute'
  };
  return snapshot;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    const force = String(req?.query?.refresh || '') === '1';
    const snapshot = enforceNapCodeSync(await getSnapshot({force}));
    res.statusCode = 200;
    res.setHeader('X-NOC-Source', snapshot.sourceMode || 'unknown');
    res.setHeader('X-NOC-Version', snapshot.version);
    return res.json(snapshot);
  } catch (error) {
    const diagnostics = error?.noc || {
      code: error?.code || 'SOURCE_ERROR',
      status: error?.response?.status || null,
      message: String(error?.message || error)
    };

    const response = {
      ok: false,
      syncState: 'SOURCE_ERROR',
      sourceMode: 'none',
      checkedAt: new Date().toISOString(),
      diagnostics,
      nextAction: diagnostics.code === 'SHEET_ACCESS_DENIED'
        ? 'Share the spreadsheet with the service-account email shown in the dashboard.'
        : diagnostics.code === 'SHEETS_API_DISABLED'
        ? 'Enable Google Sheets API for the service-account Google Cloud project.'
        : diagnostics.code === 'SHEET_NOT_FOUND'
        ? 'Verify the spreadsheet ID and sheet IDs.'
        : diagnostics.code === 'GOOGLE_AUTH_FAILED'
        ? 'Replace the Production Google service-account credential and redeploy.'
        : 'Review the exact source error and retry.'
    };

    res.statusCode = diagnostics.code === 'MISSING_CREDENTIAL' || diagnostics.code === 'INVALID_CREDENTIAL' ? 200 : 503;
    return res.json(response);
  }
};
