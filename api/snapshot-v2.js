const {getSnapshot} = require('../lib/server.cjs');

const BUILD = 'NAP-SYNC-V2-2026-10-04';

const clean = v => String(v ?? '').replace(/\u00a0/g, ' ').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const norm = v => clean(v).toUpperCase();

function parseDisplay(value) {
  const m = clean(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!m) return NaN;
  let hour = Number(m[4]);
  const ap = String(m[7] || '').toUpperCase();
  if (ap === 'PM' && hour < 12) hour += 12;
  if (ap === 'AM' && hour === 12) hour = 0;
  return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), hour, Number(m[5]), Number(m[6] || 0));
}

function reconcile(snapshot) {
  const minute = ms => Number.isNaN(ms) ? '' : new Date(ms).toISOString().slice(0,16);
  const key = r => [norm(r.province), norm(r.municipality), norm(r.finding)].join('|');
  const exact = new Map();
  for (const n of snapshot.napDownRows || []) {
    const code = clean(n.napCode);
    const t = parseDisplay(n.dateEndorsedDisplay);
    if (!code || Number.isNaN(t)) continue;
    const k = key(n) + '|' + minute(t);
    const list = exact.get(k) || [];
    list.push(n);
    exact.set(k, list);
  }
  let matched = 0, unmatched = 0;
  for (const row of snapshot.rows || []) {
    if (norm(row.finalStatus) !== 'PENDING') continue;
    const k = key(row) + '|' + minute(Date.parse(row.timestamp || ''));
    const matches = exact.get(k) || [];
    row.napCode = matches.length === 1 ? clean(matches[0].napCode) : (row.napCode || '');
    if (matches.length === 1) matched++; else unmatched++;
  }
  snapshot.dashboardBuild = BUILD;
  snapshot.diagnostics = {...(snapshot.diagnostics || {}), napCodeMatched:matched, napCodeUnmatchedPending:unmatched, napCodeMatchRule:'exact province + municipality + finding + minute'};
  return snapshot;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma','no-cache');
  res.setHeader('Expires','0');
  res.setHeader('X-NOC-BUILD',BUILD);
  try {
    const force = String(req?.query?.refresh || '') === '1';
    const snapshot = reconcile(await getSnapshot({force}));
    snapshot.apiBuild = BUILD;
    return res.status(200).json(snapshot);
  } catch (error) {
    return res.status(503).json({ok:false,syncState:'SOURCE_ERROR',sourceMode:'none',dashboardBuild:BUILD,diagnostics:{code:error?.code||'SOURCE_ERROR',message:String(error?.message||error)}});
  }
};
