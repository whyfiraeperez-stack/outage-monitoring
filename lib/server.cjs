const crypto = require('crypto');
const {google} = require('googleapis');

const CFG = Object.freeze({
  sheetId: process.env.GOOGLE_SHEET_ID || '1yhtm8pTJ9VP0TUrFm2JedYoCZ_M22K196luw3u9Xl4s',
  dbGid: process.env.GOOGLE_SHEET_GID_DATABASE || '946404240',
  napGid: process.env.GOOGLE_SHEET_GID_NAP_DOWN || process.env.GOOGLE_SHEET_GID || '1995500191',
  publishedId: process.env.GOOGLE_PUBLISHED_ID || '2PACX-1vSKPMOn6CXZN3xn1zyKGcDyayAHLMuntjJ137x5dWxZzoJstX3Ef_XTtAgh6zId4n1gEyQBeL91lHFi'
});

const SNAPSHOT_TTL_MS = Math.max(5000, Number(process.env.SNAPSHOT_TTL_MS || 15000));
const SOURCE_AGENT_RETRIES = Math.max(1, Number(process.env.SOURCE_AGENT_RETRIES || 3));
const SOURCE_AGENT_BACKOFF_MS = Math.max(250, Number(process.env.SOURCE_AGENT_BACKOFF_MS || 900));
const SOURCE_AGENT_TIMEOUT_MS = Math.max(5000, Number(process.env.SOURCE_AGENT_TIMEOUT_MS || 12000));

let snapshotCache = {at: 0, data: null};
let inflight = null;

const envText = name => String(process.env[name] || '').trim();

function parseJsonCandidate(value) {
  try {
    const parsed = JSON.parse(String(value || '').replace(/^\uFEFF/, '').trim());
    return typeof parsed === 'string' ? JSON.parse(parsed) : parsed;
  } catch (_) {
    return null;
  }
}

function decodeBase64Json(value) {
  try {
    let s = String(value || '').trim()
      .replace(/^['"]|['"]$/g, '')
      .replace(/^data:.*?;base64,/i, '')
      .replace(/^base64:/i, '')
      .replace(/\s+/g, '')
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    while (s.length % 4) s += '=';
    const decoded = Buffer.from(s, 'base64').toString('utf8').replace(/^\uFEFF/, '').trim();
    return parseJsonCandidate(decoded);
  } catch (_) {
    return null;
  }
}

function validServiceAccount(obj) {
  return !!(
    obj &&
    obj.type === 'service_account' &&
    typeof obj.client_email === 'string' &&
    obj.client_email.includes('@') &&
    typeof obj.private_key === 'string' &&
    obj.private_key.includes('BEGIN PRIVATE KEY')
  );
}

function parseServiceAccount() {
  const raw = envText('GOOGLE_SERVICE_ACCOUNT_JSON');
  const b64 = envText('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64');

  let obj = parseJsonCandidate(raw);
  if (!validServiceAccount(obj) && raw) obj = decodeBase64Json(raw);
  if (validServiceAccount(obj)) return obj;

  obj = parseJsonCandidate(b64);
  if (!validServiceAccount(obj) && b64) obj = decodeBase64Json(b64);
  if (validServiceAccount(obj)) return obj;

  throw new Error(!raw && !b64
    ? 'Google service-account credential is missing.'
    : 'Google service-account credential is invalid.');
}

function credentialDiagnostics() {
  const raw = envText('GOOGLE_SERVICE_ACCOUNT_JSON');
  const b64 = envText('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64');
  const rawObj = parseJsonCandidate(raw);
  const b64Obj = decodeBase64Json(b64);
  const rawValid = validServiceAccount(rawObj);
  const b64Valid = validServiceAccount(b64Obj);

  if (rawValid) {
    return {
      configured: true,
      source: 'GOOGLE_SERVICE_ACCOUNT_JSON',
      rawPresent: true,
      base64Present: !!b64,
      rawValid: true,
      base64Valid: b64Valid,
      clientEmail: rawObj.client_email,
      projectId: rawObj.project_id || null
    };
  }
  if (b64Valid) {
    return {
      configured: true,
      source: 'GOOGLE_SERVICE_ACCOUNT_JSON_BASE64',
      rawPresent: !!raw,
      base64Present: true,
      rawValid: false,
      base64Valid: true,
      clientEmail: b64Obj.client_email,
      projectId: b64Obj.project_id || null
    };
  }
  return {
    configured: false,
    source: raw || b64 ? 'INVALID_CREDENTIAL' : 'MISSING_CREDENTIAL',
    rawPresent: !!raw,
    base64Present: !!b64,
    rawValid: false,
    base64Valid: false,
    error: !raw && !b64
      ? 'No Google service-account credential is available in this deployment.'
      : 'A Google credential variable exists, but it is not valid service-account JSON or Base64 JSON.'
  };
}

function auth() {
  return new google.auth.GoogleAuth({
    credentials: parseServiceAccount(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
}

function clients() {
  return {sheets: google.sheets({version: 'v4', auth: auth()})};
}

function parseCsv(text) {
  const out = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i], next = text[i + 1];
    if (ch === '"' && quoted && next === '"') { cell += '"'; i += 1; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === ',' && !quoted) { row.push(cell); cell = ''; continue; }
    if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some(v => String(v).trim() !== '')) out.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    if (row.some(v => String(v).trim() !== '')) out.push(row);
  }
  return out;
}

function publishedLooksUsable(rows, kind) {
  if (!Array.isArray(rows) || rows.length < 2) return false;
  const header = (rows[0] || []).map(v => String(v || '').trim().toUpperCase());
  const needed = kind === 'db'
    ? ['PROVINCE']
    : ['PROVINCE', 'MUNICIPALITY'];
  return needed.every(x => header.includes(x));
}

async function readPublishedTab(gid, kind) {
  const urls = [
    'https://docs.google.com/spreadsheets/d/e/' + CFG.publishedId + '/pub?gid=' + gid + '&single=true&output=csv&cachebust=' + Date.now(),
    'https://docs.google.com/spreadsheets/d/e/' + CFG.publishedId + '/gviz/tq?tqx=out:csv&gid=' + gid + '&cachebust=' + Date.now()
  ];
  let last = 'unavailable';
  for (const url of urls) {
    try {
      const response = await fetch(url, {cache:'no-store'});
      if (!response.ok) { last = 'HTTP ' + response.status; continue; }
      const text = await response.text();
      if (/^\s*</.test(text)) { last = 'HTML response'; continue; }
      const rows = parseCsv(text);
      if (publishedLooksUsable(rows, kind)) return rows;
      last = 'unexpected headers';
    } catch (error) {
      last = String(error?.message || error);
    }
  }
  throw Object.assign(new Error('Published Google Sheets feed unavailable: ' + last), {code:'PUBLISHED_UNAVAILABLE'});
}

async function readPublishedRaw() {
  const [dbValues, napValues] = await Promise.all([
    readPublishedTab(CFG.dbGid, 'db'),
    readPublishedTab(CFG.napGid, 'nap')
  ]);
  return {dbValues, napValues};
}

function apiErrorInfo(error) {
  const status = Number(error?.response?.status || error?.code || 0) || null;
  const body = error?.response?.data?.error || error?.response?.data || {};
  const reason = Array.isArray(body?.errors) && body.errors[0]?.reason
    ? String(body.errors[0].reason)
    : String(body?.status || body?.reason || '');
  const message = String(body?.message || error?.message || error || 'Unknown Google API error');
  const lower = (reason + ' ' + message).toLowerCase();

  let code = 'GOOGLE_API_ERROR';
  if (status === 401 || /invalid_grant|unauthenticated|invalid credentials?|invalid authentication/.test(lower)) {
    code = 'GOOGLE_AUTH_FAILED';
  } else if (status === 403 && /accessnotconfigured|has not been used|disabled|not enabled/.test(lower)) {
    code = 'SHEETS_API_DISABLED';
  } else if (status === 403 && /permission|forbidden|does not have permission|caller does not have permission/.test(lower)) {
    code = 'SHEET_ACCESS_DENIED';
  } else if (status === 404 || /requested entity was not found|not found/.test(lower)) {
    code = 'SHEET_NOT_FOUND';
  } else if (status === 429 || /quota|rate.?limit|too many requests/.test(lower)) {
    code = 'GOOGLE_QUOTA';
  } else if (status === 408 || status === 504 || /timeout|timed out/.test(lower)) {
    code = 'GOOGLE_TIMEOUT';
  } else if (status === 503 || /service unavailable|backend error/.test(lower)) {
    code = 'GOOGLE_UNAVAILABLE';
  }

  return {code, status, reason: reason || null, message};
}

async function readByGid(gid, kind) {
  const {sheets} = clients();
  const range = kind === 'db'
    ? "'DATABASE'!A:AN"
    : "'NAP DOWN'!A:Z";
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: CFG.sheetId,
    ranges: [range],
    majorDimension: 'ROWS',
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING'
  });
  return response.data?.valueRanges?.[0]?.values || [];
}

async function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function withSourceAgent(task, label) {
  let lastError = null;
  for (let attempt = 1; attempt <= SOURCE_AGENT_RETRIES; attempt += 1) {
    try {
      return await Promise.race([
        Promise.resolve().then(task),
        new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error(label + ' timed out after ' + SOURCE_AGENT_TIMEOUT_MS + 'ms'), {code:'GOOGLE_TIMEOUT'})), SOURCE_AGENT_TIMEOUT_MS))
      ]);
    } catch (error) {
      lastError = error;
      if (attempt < SOURCE_AGENT_RETRIES) await sleep(SOURCE_AGENT_BACKOFF_MS * attempt);
    }
  }
  throw lastError;
}

async function readDirectRaw() {
  return withSourceAgent(async () => {
    const {sheets} = clients();
    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: CFG.sheetId,
      ranges: ["'DATABASE'!A:AN", "'NAP DOWN'!A:Z"],
      majorDimension: 'ROWS',
      valueRenderOption: 'FORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    });
    const ranges = response.data?.valueRanges || [];
    if (ranges.length < 2) {
      throw Object.assign(new Error('Google Sheets returned an incomplete DATABASE/NAP DOWN response.'), {
        code: 'SHEET_RANGE_MISSING'
      });
    }
    return {
      dbValues: Array.isArray(ranges[0]?.values) ? ranges[0].values : [],
      napValues: Array.isArray(ranges[1]?.values) ? ranges[1].values : []
    };
  }, 'Google Sheets source agent');
}

async function healthProbe() {
  const {sheets} = clients();
  await sheets.spreadsheets.get({
    spreadsheetId: CFG.sheetId,
    includeGridData: false,
    fields: 'spreadsheetId,properties(title)'
  });
  return {reachable: true};
}

async function getSnapshot({force = false} = {}) {
  const now = Date.now();
  if (!force && snapshotCache.data && now - snapshotCache.at < SNAPSHOT_TTL_MS) {
    return snapshotCache.data;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const diagnostics = credentialDiagnostics();
      if (!diagnostics.configured) {
        throw Object.assign(new Error(diagnostics.error), {code: diagnostics.source});
      }

      const raw = await readDirectRaw();
      const {build} = require('./noc.cjs');
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex').slice(0, 20);
      const built = build({values:raw.dbValues},{values:raw.napValues},fingerprint,'google-sheets-api');

      if (!built.rows.length) {
        throw Object.assign(new Error('DATABASE was readable but no data rows were parsed.'), {code:'SCHEMA_INVALID'});
      }

      const result = {
        ...built,
        checkedAt:new Date().toISOString(),
        source:'Google Sheets API',
        sourceMode:'google-sheets-api',
        syncState:'SYNCED',
        agent:{status:'HEALTHY',attempts:SOURCE_AGENT_RETRIES,mode:'direct-google-sheets',checkedAt:new Date().toISOString()},
        credential:{source:diagnostics.source,clientEmail:diagnostics.clientEmail,projectId:diagnostics.projectId}
      };
      snapshotCache={at:Date.now(),data:result};
      return result;
    } catch (error) {
      const knownCode=String(error?.code||'');
      const info = error?.noc || (
        ['SCHEMA_INVALID','NAP_SCHEMA_INVALID','SHEET_RANGE_MISSING'].includes(knownCode)
          ? {code:knownCode,status:null,reason:null,message:String(error?.message||'')}
          : apiErrorInfo(error)
      );

      // Operational fallback for transient or configuration-related Google Sheets API failures.
      // The published workbook remains read-only and is explicitly marked as degraded;
      // it is never presented as a direct API sync.
      if (['MISSING_CREDENTIAL','INVALID_CREDENTIAL','SHEETS_API_DISABLED','GOOGLE_AUTH_FAILED','SHEET_ACCESS_DENIED','SHEET_NOT_FOUND','GOOGLE_QUOTA','GOOGLE_TIMEOUT','GOOGLE_UNAVAILABLE','GOOGLE_API_ERROR'].includes(info.code)) {
        try {
          const raw = await readPublishedRaw();
          const {build} = require('./noc.cjs');
          const fingerprint = crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex').slice(0, 20);
          const built = build({values:raw.dbValues},{values:raw.napValues},fingerprint,'published-feed-fallback');
          if (!built.rows.length) throw new Error('Published DATABASE feed returned no usable rows.');
          const fallback = {
            ...built,
            checkedAt:new Date().toISOString(),
            source:'Google Sheets Publish to web',
            sourceMode:'published-feed-fallback',
            syncState:'DEGRADED',
            agent:{status:'RECOVERING',attempts:SOURCE_AGENT_RETRIES,mode:'published-fallback',checkedAt:new Date().toISOString()},
            directError:{code:info.code,status:info.status,reason:info.reason,message:info.message}
          };
          snapshotCache={at:Date.now(),data:fallback};
          return fallback;
        } catch (fallbackError) {
          fallbackError.noc = {
            code:'PUBLISHED_FALLBACK_FAILED',
            status:fallbackError?.response?.status || null,
            reason:null,
            message:String(fallbackError?.message || fallbackError),
            directError:info
          };
          throw fallbackError;
        }
      }

      error.noc = info;
      throw error;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
async function source(gid, kind) {
  const values = await readByGid(gid);
  return {
    properties: {sheetId: Number(gid), title: kind === 'db' ? 'DATABASE' : 'NAP DOWN'},
    values,
    live: true,
    sourceType: 'google-sheets-api'
  };
}

async function version() {
  const snap = snapshotCache.data || await getSnapshot();
  return snap.version;
}

function configured() {
  try {
    parseServiceAccount();
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  CFG,
  configured,
  credentialDiagnostics,
  parseServiceAccount,
  clients,
  source,
  version,
  getSnapshot,
  readDirectRaw,
  readByGid,
  healthProbe
};
