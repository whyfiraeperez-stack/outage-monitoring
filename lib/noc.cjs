const clean = v => String(v ?? '').replace(/\u00a0/g,' ').replace(/[\t\r\n]+/g,' ').replace(/\s+/g,' ').trim();
const norm = v => clean(v).toUpperCase();

const EXCLUDED_PENDING = new Set([
  'RESTORED',
  'NO PROBLEM WHEN CHECKED',
  'NOT YET RFS',
  'INCOMPLETE DETAILS',
  'W/ GNOC TICKET',
  'CANCELLED',
  'ENDORSED TO FNO'
]);

const RESTORED_WINDOW_STATUSES = new Set([
  'RESTORED',
  'NO PROBLEM WHEN CHECKED',
  'NOT YET RFS',
  'INCOMPLETE DETAILS',
  'W/ GNOC TICKET',
  'ENDORSED TO FNO'
]);

function parseNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[% ,]/g,''));
  return Number.isFinite(n) ? n : null;
}

function excelSerialToIso(serial) {
  const n = parseNumber(serial);
  if (n === null) return '';
  const ms = (n - 25569) * 86400000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

function parseDate(v) {
  const s = clean(v);
  if (!s) return null;
  const n = parseNumber(s);
  if (n !== null && n > 20000 && n < 80000) {
    const x = new Date((n - 25569) * 86400000);
    return Number.isNaN(x.getTime()) ? null : x;
  }
  const x = new Date(s);
  return Number.isNaN(x.getTime()) ? null : x;
}

function serialDayKey(v) {
  const n = parseNumber(v);
  if (n === null) return '';
  const d = new Date((n - 25569) * 86400000);
  if (Number.isNaN(d.getTime())) return '';
  return [d.getUTCFullYear(),String(d.getUTCMonth()+1).padStart(2,'0'),String(d.getUTCDate()).padStart(2,'0')].join('-');
}

function iso(v) {
  const d = parseDate(v);
  return d ? d.toISOString() : '';
}

function headerIndex(headers, names) {
  const normalized = headers.map(norm);
  return normalized.findIndex(h => names.some(name => h === norm(name)));
}

function currentManilaSerial() {
  const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'})
    .formatToParts(new Date());
  const p = Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return (Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day)) - Date.UTC(1899,11,30)) / 86400000;
}

function rowIsPending(status) {
  return !EXCLUDED_PENDING.has(norm(status));
}

function rowIsRestoredWindowStatus(status) {
  return RESTORED_WINDOW_STATUSES.has(norm(status));
}

function ageDays(row, cols, todaySerial) {
  const endorsed = parseNumber(row[cols.endorsed]);
  if (endorsed === null) return null;
  const restored = parseNumber(row[cols.restored]);
  if (restored !== null && restored > 1) return restored - endorsed;
  return todaySerial - endorsed;
}

function turnaroundHours(row, cols) {
  const endorsed = parseNumber(row[cols.endorsed]);
  const restored = parseNumber(row[cols.restored]);
  if (endorsed === null || restored === null || restored <= 1) return null;
  return (restored - endorsed) * 24;
}

function matchesProvince(row, province) {
  return province === 'ALL' || norm(row.province) === norm(province);
}

function uniqueSorted(values) {
  return [...new Set(values.map(clean).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
}

function groupedCounts(rows, getter) {
  const order = [];
  const map = new Map();
  for (const row of rows) {
    const key = clean(getter(row)) || 'UNSPECIFIED';
    if (!map.has(key)) order.push(key);
    map.set(key,(map.get(key)||0)+1);
  }
  return order.map(key=>({label:key,count:map.get(key)}))
    .sort((a,b)=>b.count-a.count || a.label.localeCompare(b.label,undefined,{sensitivity:'base'}));
}

function parseData(values) {
  if (!Array.isArray(values) || !values.length) {
    throw Object.assign(new Error('DATA sheet is empty.'),{code:'SCHEMA_INVALID'});
  }
  const headers = values[0] || [];
  const cols = {
    jo:headerIndex(headers,['JO NUMBER / TICKET NUMBER','JO NUMBER']),
    account:headerIndex(headers,['ACCOUNT NUMBER']),
    municipality:headerIndex(headers,['MUNICIPALITY']),
    province:headerIndex(headers,['PROVINCE']),
    nap:headerIndex(headers,['NAP ASSIGNMENT']),
    issue:headerIndex(headers,['NAP CONCERN/ISSUE','CONCERN/ISSUE']),
    group:headerIndex(headers,['GROUP NAME']),
    technician:headerIndex(headers,['ASSIGNED TECHNICIAN','TECHNICIAN']),
    endorsed:headerIndex(headers,['DATE ENDORSED']),
    restored:headerIndex(headers,['DATE RESTORED']),
    status:headerIndex(headers,['STATUS']),
    ageing:headerIndex(headers,['AGEING','AGING']),
    rfo:headerIndex(headers,['RFO']),
    at:headerIndex(headers,['A/T']),
    remarks:headerIndex(headers,['OSP Remarks','REMARKS']),
    barangay:headerIndex(headers,['BARANGAY']),
    etr:headerIndex(headers,['ETR']),
    gr:headerIndex(headers,['gr'])
  };
  const required = ['municipality','province','nap','issue','group','technician','endorsed','restored','status','ageing'];
  const missing = required.filter(k=>cols[k] < 0);
  if (missing.length) {
    throw Object.assign(new Error('DATA sheet is missing columns: '+missing.join(', ')),{code:'SCHEMA_INVALID'});
  }

  const todaySerial = currentManilaSerial();
  const rows = [];
  let formulaErrors = 0;

  for (let i=1;i<values.length;i++) {
    const raw = Array.isArray(values[i]) ? values[i] : [];
    if (!raw.some(v=>clean(v)!=='')) continue;
    for (const v of raw) {
      if (/^#(REF!|N\/A|VALUE!|DIV\/0!|NAME\?|ERROR!)/i.test(clean(v))) formulaErrors++;
    }
    const status = clean(raw[cols.status]);
    const row = {
      sourceRow:i+1,
      jo:cols.jo>=0?clean(raw[cols.jo]):'',
      account:cols.account>=0?clean(raw[cols.account]):'',
      municipality:clean(raw[cols.municipality]),
      province:clean(raw[cols.province]),
      napAssignment:clean(raw[cols.nap]),
      issue:clean(raw[cols.issue]),
      groupName:clean(raw[cols.group]),
      technician:clean(raw[cols.technician]),
      dateEndorsed:iso(raw[cols.endorsed]),
      dateRestored:iso(raw[cols.restored]),
      endorsedSerial:parseNumber(raw[cols.endorsed]),
      restoredSerial:parseNumber(raw[cols.restored]),
      status,
      ageingDays:ageDays(raw,cols,todaySerial),
      rfo:cols.rfo>=0?clean(raw[cols.rfo]):'',
      at:cols.at>=0?clean(raw[cols.at]):'',
      ospRemarks:cols.remarks>=0?clean(raw[cols.remarks]):'',
      barangay:cols.barangay>=0?clean(raw[cols.barangay]):'',
      etr:cols.etr>=0?clean(raw[cols.etr]):'',
      gr:cols.gr>=0?clean(raw[cols.gr]):''
    };
    row.pending = rowIsPending(status);
    row.turnaroundHours = turnaroundHours(raw,cols);
    rows.push(row);
  }

  return {rows,headers,formulaErrors,columns:cols};
}

function build(dataTab, controls, version, sourceMode) {
  const parsed = parseData(dataTab?.values || []);
  const rows = parsed.rows;
  const provinceOptions = uniqueSorted(rows.map(r=>r.province));
  const statusOptions = uniqueSorted(rows.map(r=>r.status));
  const issueOptions = uniqueSorted(rows.map(r=>r.issue));
  const technicianOptions = uniqueSorted(rows.map(r=>r.technician));

  const latestRestored = rows.filter(r=>rowIsRestoredWindowStatus(r.status) && r.restoredSerial !== null);
  const restoredDates = latestRestored.map(r=>serialDayKey(r.restoredSerial)).filter(Boolean).sort();
  const defaultTo = restoredDates.length ? restoredDates[restoredDates.length-1] : '';
  const defaultFrom = restoredDates.length ? restoredDates[Math.max(0,restoredDates.length-8)] : '';

  return {
    ok:true,
    version,
    sourceMode,
    syncState:'SYNCED',
    rows,
    controls:{
      provinceOptions,
      statusOptions,
      issueOptions,
      technicianOptions,
      defaultFrom: controls?.defaultFrom || defaultFrom,
      defaultTo: controls?.defaultTo || defaultTo
    },
    diagnostics:{
      dataRows:rows.length,
      formulaErrors:parsed.formulaErrors
    }
  };
}

module.exports = {
  build,
  parseData,
  parseDate,
  excelSerialToIso,
  serialDayKey,
  clean,
  norm,
  rowIsPending,
  rowIsRestoredWindowStatus
};
