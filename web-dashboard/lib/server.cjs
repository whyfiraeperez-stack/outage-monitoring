const crypto = require('crypto');
const {google} = require('googleapis');

const CFG = Object.freeze({
  sheetId: process.env.GOOGLE_SHEET_ID || '1yhtm8pTJ9VP0TUrFm2JedYoCZ_M22K196luw3u9Xl4s',
  dbGid: process.env.GOOGLE_SHEET_GID_DATABASE || '946404240',
  napGid: process.env.GOOGLE_SHEET_GID_NAP_DOWN || '1995500191',
  publishedId: process.env.GOOGLE_PUBLISHED_ID || '2PACX-1vSKPMOn6CXZN3xn1zyKGcDyayAHLMuntjJ137x5dWxZzoJstX3Ef_XTtAgh6zId4n1gEyQBeL91lHFi'
});

const SNAPSHOT_TTL_MS = Math.max(5000, Number(process.env.SNAPSHOT_TTL_MS || 20000));

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

async function readByGid(gid) {
  const {sheets} = clients();
  const response = await sheets.spreadsheets.values.batchGetByDataFilter({
    spreadsheetId: CFG.sheetId,
    requestBody: {
      dataFilters: [{
        gridRange: {
          sheetId: Number(gid),
          startRowIndex: 0,
          startColumnIndex: 0
        }
      }],
      majorDimension: 'ROWS',
      valueRenderOption: 'FORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING'
    }
  });
  const vr = response.data?.valueRanges?.[0]?.valueRange;
  return Array.isArray(vr?.values) ? vr.values : [];
}

async function readDirectRaw() {
  const {sheets} = clients();

  async function once() {
    const response = await sheets.spreadsheets.values.batchGetByDataFilter({
      spreadsheetId: CFG.sheetId,
      requestBody: {
        dataFilters: [
          {gridRange: {sheetId: Number(CFG.dbGid), startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 40}},
          {gridRange: {sheetId: Number(CFG.napGid), startRowIndex: 0, startColumnIndex: 0, endColumnIndex: 40}}
        ],
        majorDimension: 'ROWS',
        valueRenderOption: 'FORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING'
      }
    });

    const ranges = response.data?.valueRanges || [];
    const byGid = new Map();
    for (const item of ranges) {
      const gid = item?.dataFilters?.[0]?.gridRange?.sheetId;
      if (gid != null) byGid.set(String(gid), item?.valueRange?.values || []);
    }

    if (!byGid.has(String(CFG.dbGid)) || !byGid.has(String(CFG.napGid))) {
      throw Object.assign(new Error('Google Sheets returned an incomplete DATABASE/NAP DOWN batch.'), {code:'SHEET_RANGE_MISSING'});
    }

    return {
      dbValues: Array.isArray(byGid.get(String(CFG.dbGid))) ? byGid.get(String(CFG.dbGid)) : [],
      napValues: Array.isArray(byGid.get(String(CFG.napGid))) ? byGid.get(String(CFG.napGid)) : []
    };
  }

  let last;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await once();
    } catch (error) {
      last = error;
      const status = Number(error?.response?.status || error?.code || 0);
      if (![408,429,500,502,503,504].includes(status) || attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 400 * (2 ** attempt)));
    }
  }
  throw last;
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
      const fingerprint = crypto.createHash('sha256')
        .update(JSON.stringify(raw))
        .digest('hex')
        .slice(0, 20);

      const built = build(
        {values: raw.dbValues},
        {values: raw.napValues},
        fingerprint,
        'google-sheets-api'
      );

      if (!built.rows.length) {
        throw Object.assign(new Error('DATABASE was readable but no data rows were parsed.'), {code: 'SCHEMA_INVALID'});
      }
      if (!built.napDownHeaderRow) {
        throw Object.assign(new Error('NAP DOWN was readable but its header row could not be detected.'), {code: 'SCHEMA_INVALID'});
      }

      const result = {
        ...built,
        checkedAt: new Date().toISOString(),
        source: 'Google Sheets API',
        sourceMode: 'google-sheets-api',
        syncState: 'SYNCED',
        credential: {
          source: diagnostics.source,
          clientEmail: diagnostics.clientEmail,
          projectId: diagnostics.projectId
        }
      };

      snapshotCache = {at: Date.now(), data: result};
      return result;
    } catch (error) {
      const info = apiErrorInfo(error);
      const nocCode = String(error?.code || '');
      error.noc = ['MISSING_CREDENTIAL','INVALID_CREDENTIAL','SCHEMA_INVALID','SHEET_RANGE_MISSING'].includes(nocCode)
        ? {code:nocCode,status:null,reason:null,message:String(error?.message||'')}
        : info;
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
