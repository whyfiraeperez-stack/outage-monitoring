import { google } from 'googleapis';

const CFG = {
  sheetId: process.env.GOOGLE_SHEET_ID || '1yhtm8pTJ9VP0TUrFm2JedYoCZ_M22K196luw3u9Xl4s',
  dbGid: process.env.GOOGLE_SHEET_GID_DATABASE || '946404240',
  napGid: process.env.GOOGLE_SHEET_GID_NAP_DOWN || '1995500191',
  publishedId: process.env.GOOGLE_PUBLISHED_ID || '2PACX-1vSKPMOn6CXZN3xn1zyKGcDyayAHLMuntjJ137x5dWxZzoJstX3Ef_XTtAgh6zId4n1gEyQBeL91lHFi'
};

export const sourceConfig = () => ({ ...CFG, apiConfigured: !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 });
export const apiConfigured = () => !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;

function auth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!raw) return null;
  let credentials;
  try { credentials = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); }
  catch { throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is invalid'); }
  return new google.auth.GoogleAuth({ credentials, scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.readonly'
  ]});
}

export async function clients() {
  const a = auth();
  if (!a) throw new Error('Google Sheets API credentials are not configured');
  return { sheets: google.sheets({ version: 'v4', auth: a }), drive: google.drive({ version: 'v3', auth: a }) };
}

export async function getDriveVersion() {
  const { drive } = await clients();
  const r = await drive.files.get({ fileId: CFG.sheetId, fields: 'id,name,modifiedTime,mimeType' });
  return r.data;
}

function colName(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export async function getTabs() {
  const { sheets } = await clients();
  const r = await sheets.spreadsheets.get({
    spreadsheetId: CFG.sheetId,
    includeGridData: false,
    fields: 'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))'
  });
  return r.data.sheets || [];
}

export async function getTabByGid(gid) {
  const tabs = await getTabs();
  const tab = tabs.find(x => String(x.properties?.sheetId) === String(gid));
  if (!tab) throw new Error('Sheet tab GID ' + gid + ' not found');
  return tab.properties;
}

export async function getValuesByGid(gid, render = 'FORMATTED_VALUE') {
  const tab = await getTabByGid(gid);
  const { sheets } = await clients();
  const rows = Number(tab.gridProperties?.rowCount || 1000);
  const cols = Math.min(Number(tab.gridProperties?.columnCount || 40), 100);
  const range = "'" + String(tab.title).replace(/'/g, "''") + "'!A1:" + colName(cols) + rows;
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: CFG.sheetId,
    range,
    majorDimension: 'ROWS',
    valueRenderOption: render,
    dateTimeRenderOption: 'FORMATTED_STRING'
  });
  return { properties: tab, values: r.data.values || [], range };
}

export async function getFormulaValuesByGid(gid) { return getValuesByGid(gid, 'FORMULA'); }

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (c === '"' && quoted && n === '"') { cell += '"'; i++; continue; }
    if (c === '"') { quoted = !quoted; continue; }
    if (c === ',' && !quoted) { row.push(cell); cell = ''; continue; }
    if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && n === '\n') i++;
      row.push(cell); cell = '';
      if (row.some(v => String(v).trim() !== '')) rows.push(row);
      row = []; continue;
    }
    cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); if (row.some(v => String(v).trim() !== '')) rows.push(row); }
  return rows;
}

export async function getPublishedTab(gid) {
  const url = 'https://docs.google.com/spreadsheets/d/e/' + CFG.publishedId + '/pub?gid=' + encodeURIComponent(gid) + '&single=true&output=csv&cachebust=' + Date.now();
  const r = await fetch(url, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'NAP-NOC-Vercel' } });
  if (!r.ok) throw new Error('Published sheet HTTP ' + r.status);
  const t = await r.text();
  if (t.includes('<html') || t.includes('<!DOCTYPE')) throw new Error('Published sheet returned HTML instead of CSV');
  return { properties: { sheetId: Number(gid), title: 'GID ' + gid, gridProperties: {} }, values: parseCsv(t) };
}

export async function getSourceTab(gid) { return apiConfigured() ? getValuesByGid(gid, 'FORMATTED_VALUE') : getPublishedTab(gid); }

export async function getSourceVersion() {
  if (apiConfigured()) return String((await getDriveVersion()).modifiedTime || Date.now());
  const url = 'https://docs.google.com/spreadsheets/d/e/' + CFG.publishedId + '/pub?gid=' + CFG.dbGid + '&single=true&output=csv';
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    const version = r.headers.get('etag') || r.headers.get('last-modified') || r.headers.get('content-length');
    if (version) return version;
  } catch {}
  return String(Math.floor(Date.now() / 60000));
}
