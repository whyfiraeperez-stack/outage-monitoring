const clean = v => String(v ?? '')
  .replace(/\u00a0/g, ' ')
  .replace(/[\t\r\n]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const norm = v => clean(v).toUpperCase();

function parseDate(v) {
  const s = clean(v);
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const x = new Date(s);
    if (!Number.isNaN(x.getTime())) return x;
  }

  let m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (m) {
    let hour = Number(m[5] || 0);
    const minute = Number(m[6] || 0);
    const second = Number(m[7] || 0);
    const ap = String(m[8] || '').toUpperCase();
    if (ap === 'PM' && hour < 12) hour += 12;
    if (ap === 'AM' && hour === 12) hour = 0;
    return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), hour, minute, second);
  }

  m = s.match(/^(\d{1,2})[- /]([A-Za-z]{3,9})[- /](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (m) {
    const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const month = months.findIndex(x => m[2].toLowerCase().startsWith(x));
    if (month >= 0) {
      let hour = Number(m[4] || 0);
      const ap = String(m[7] || '').toUpperCase();
      if (ap === 'PM' && hour < 12) hour += 12;
      if (ap === 'AM' && hour === 12) hour = 0;
      return new Date(Number(m[3]), month, Number(m[1]), hour, Number(m[5] || 0), Number(m[6] || 0));
    }
  }

  const x = new Date(s);
  return Number.isNaN(x.getTime()) ? null : x;
}

const iso = v => {
  const x = parseDate(v);
  return x ? x.toISOString() : '';
};

const dayKey = v => {
  const x = parseDate(v);
  return x
    ? [x.getFullYear(), String(x.getMonth() + 1).padStart(2, '0'), String(x.getDate()).padStart(2, '0')].join('-')
    : '';
};

function headerRow(values, required, maxScan = 100) {
  let best = {index: -1, score: 0};
  for (let i = 0; i < Math.min(maxScan, values.length); i += 1) {
    const header = (values[i] || []).map(norm);
    const score = required.reduce((n, aliases) =>
      n + (aliases.some(a => header.includes(norm(a))) ? 1 : 0), 0);
    if (score > best.score) best = {index: i, score};
  }
  return best.index;
}

function columnMap(header, schema) {
  const H = header.map(norm);
  const out = {};
  for (const [key, aliases] of Object.entries(schema)) {
    out[key] = H.findIndex(v => aliases.some(alias => v === norm(alias)));
  }
  return out;
}

function cell(row, index) {
  return index >= 0 ? clean(row[index]) : '';
}

const DB_SCHEMA = {
  timestamp: ['TIMESTAMP'],
  concern: ['CONCERN GROUP', 'CONCERN'],
  province: ['PROVINCE'],
  municipality: ['MUNICIPALITY', 'CITY/MUNICIPALITY', 'CITY'],
  barangay: ['BARANGAY'],
  facility: ['FACILITY'],
  napStatus: ['NAP STATUS', 'NAP_STATUS'],
  rawStatus: ['STATUS'],
  finalStatus: ['FINAL STATUS', 'FINAL STAT', 'FINAL_STATUS'],
  endorsed: ['DATE ENDORSED', 'ENDORSED DATE'],
  restored: ['DATE RESTORED', 'RESTORED DATE'],
  rfo: ['RFO'],
  osp: ['OSP TEAM', 'OPS TEAM'],
  etr: ['ETR'],
  jo: ['JO NUMBER', 'JO NO', 'JO#']
};

const NAP_SCHEMA = {
  province: ['PROVINCE'],
  municipality: ['MUNICIPALITY', 'CITY/MUNICIPALITY', 'CITY'],
  barangay: ['BARANGAY'],
  napCode: ['NAP CODE', 'NAPCODE'],
  coordinates: ['COORDINATES', 'FACILITY COORDINATES'],
  endorsed: ['DATE ENDORSED', 'ENDORSED DATE'],
  duration: ['DURATION', 'AGEING', 'AGING'],
  finding: ['FINDINGS', 'FINDING'],
  status: ['FINAL STATUS', 'FINAL STAT', 'STATUS']
};

function parseDatabase(values) {
  const idx = headerRow(values, [
    ['TIMESTAMP'],
    ['PROVINCE'],
    ['MUNICIPALITY', 'CITY/MUNICIPALITY', 'CITY'],
    ['FINAL STATUS', 'FINAL STAT', 'FINAL_STATUS'],
    ['DATE ENDORSED', 'ENDORSED DATE']
  ]);
  if (idx < 0) throw Object.assign(new Error('DATABASE header row not found.'), {code: 'SCHEMA_INVALID'});

  const header = values[idx] || [];
  const c = columnMap(header, DB_SCHEMA);
  if (c.finalStatus < 0) throw Object.assign(new Error('DATABASE FINAL STATUS column is missing.'), {code: 'SCHEMA_INVALID'});

  const rows = [];
  let dataRows = 0;
  let formulaErrors = 0;

  for (let i = idx + 1; i < values.length; i += 1) {
    const row = Array.isArray(values[i]) ? values[i] : [];
    if (!row.some(v => clean(v) !== '')) continue;
    dataRows += 1;

    for (const value of row) {
      if (/^#(REF!|N\/A|VALUE!|DIV\/0!|NAME\?|ERROR!)/i.test(clean(value))) {
        formulaErrors += 1;
      }
    }

    const finalStatus = cell(row, c.finalStatus) || 'BLANK';
    rows.push({
      rowNumber: i + 1,
      timestamp: iso(cell(row, c.timestamp)),
      concern: cell(row, c.concern),
      province: cell(row, c.province),
      municipality: cell(row, c.municipality),
      barangay: cell(row, c.barangay),
      facility: cell(row, c.facility),
      napStatus: cell(row, c.napStatus),
      finding: cell(row, c.napStatus),
      rfo: cell(row, c.rfo),
      ospTeam: cell(row, c.osp),
      etr: cell(row, c.etr),
      joNumber: cell(row, c.jo),
      dateEndorsed: iso(cell(row, c.endorsed)),
      dateRestored: iso(cell(row, c.restored)),
      sourceStatus: cell(row, c.rawStatus),
      finalStatus,
      status: finalStatus
    });
  }

  return {
    rows,
    headerRow: idx + 1,
    header,
    formulaErrors,
    dataRows
  };
}

function parseNapDown(values) {
  const groups = [
    ['PROVINCE'],
    ['MUNICIPALITY','CITY/MUNICIPALITY','CITY'],
    ['BARANGAY'],
    ['NAP CODE','NAPCODE'],
    ['COORDINATES','FACILITY COORDINATES','COORDINATE'],
    ['DATE ENDORSED','ENDORSED DATE'],
    ['DURATION','AGEING','AGING'],
    ['FINDINGS','FINDING']
  ];

  let best = {index:-1,score:-1};
  for (let i=0;i<Math.min(100,values.length);i++){
    const h=(Array.isArray(values[i])?values[i]:[]).map(norm);
    let score=0;
    for(const aliases of groups){
      if(aliases.some(a=>h.includes(norm(a)))) score++;
    }
    if(score>best.score) best={index:i,score};
  }

  if(best.index<0 || best.score<5){
    throw Object.assign(
      new Error('NAP DOWN header row could not be detected. Observed header candidates: ' +
        JSON.stringify((values.slice(0,12)||[]).map(r=>(r||[]).map(clean)))),
      {code:'NAP_SCHEMA_INVALID'}
    );
  }

  const idx=best.index;
  const header=values[idx]||[];
  const c=columnMap(header,{
    province:['PROVINCE'],
    municipality:['MUNICIPALITY','CITY/MUNICIPALITY','CITY'],
    barangay:['BARANGAY'],
    napCode:['NAP CODE','NAPCODE'],
    coordinates:['COORDINATES','FACILITY COORDINATES','COORDINATE'],
    endorsed:['DATE ENDORSED','ENDORSED DATE'],
    duration:['DURATION','AGEING','AGING'],
    finding:['FINDINGS','FINDING'],
    status:['FINAL STATUS','FINAL STAT','STATUS']
  });

  const required=['province','municipality','napCode','endorsed','duration','finding'];
  const missing=required.filter(k=>c[k]<0);
  if(missing.length){
    throw Object.assign(
      new Error('NAP DOWN is missing required columns: '+missing.join(', ') +
        '. Detected headers: '+JSON.stringify(header.map(clean))),
      {code:'NAP_SCHEMA_INVALID'}
    );
  }

  const rows=[];
  for(let i=idx+1;i<values.length;i++){
    const row=Array.isArray(values[i])?values[i]:[];
    if(!row.some(v=>clean(v)!=='')) continue;
    rows.push({
      sourceRow:i+1,
      province:cell(row,c.province),
      municipality:cell(row,c.municipality),
      barangay:cell(row,c.barangay),
      napCode:cell(row,c.napCode),
      coordinates:cell(row,c.coordinates),
      dateEndorsed:iso(cell(row,c.endorsed)),
      dateEndorsedDisplay:cell(row,c.endorsed),
      duration:cell(row,c.duration),
      finding:cell(row,c.finding),
      sourceStatus:cell(row,c.status)
    });
  }

  return {rows,headerRow:idx+1,header};
}

function counts(rows) {
  const out = {};
  for (const row of rows) {
    const status = clean(row.finalStatus) || 'BLANK';
    out[status] = (out[status] || 0) + 1;
  }
  return out;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

function build(dbTab, napTab, version, sourceMode) {
  const db = parseDatabase(dbTab?.values || []);
  const nap = parseNapDown(napTab?.values || []);

  // Match each DATABASE ticket to the live NAP DOWN record.
  // The NAP DOWN tab already contains the authoritative NAP CODE. The most
  // reliable ticket identity available across both tabs is municipality +
  // finding + endorsed timestamp. We therefore compare the NAP DOWN display
  // timestamp (MM/DD/YYYY HH:MM:SS) directly with the DATABASE ticket
  // timestamp, preferring an exact minute match and then the nearest record.
  const napDisplayTime = value => {
    const raw = clean(value);
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?/i);
    if (!m) return NaN;
    let hour = Number(m[4] || 0);
    const ap = String(m[7] || '').toUpperCase();
    if (ap === 'PM' && hour < 12) hour += 12;
    if (ap === 'AM' && hour === 12) hour = 0;
    return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), hour, Number(m[5] || 0), Number(m[6] || 0));
  };

  const napByLocation = new Map();
  for (const n of nap.rows) {
    if (!n.napCode) continue;
    const k = [norm(n.province), norm(n.municipality), norm(n.finding)].join('||');
    const list = napByLocation.get(k) || [];
    list.push(n);
    napByLocation.set(k, list);
  }

  for (const row of db.rows) {
    row.napCode = '';
    if (clean(row.finalStatus).toUpperCase() !== 'PENDING') continue;

    const k = [norm(row.province), norm(row.municipality), norm(row.finding)].join('||');
    const candidates = napByLocation.get(k) || [];
    if (!candidates.length) continue;

    const ticketTime = row.timestamp ? new Date(row.timestamp).getTime() : NaN;
    if (Number.isNaN(ticketTime)) continue;

    candidates.sort((a, b) => {
      const at = napDisplayTime(a.dateEndorsedDisplay);
      const bt = napDisplayTime(b.dateEndorsedDisplay);
      const ad = Number.isNaN(at) ? Number.MAX_SAFE_INTEGER : Math.abs(at - ticketTime);
      const bd = Number.isNaN(bt) ? Number.MAX_SAFE_INTEGER : Math.abs(bt - ticketTime);
      return ad - bd;
    });

    const best = candidates[0];
    const bestTime = napDisplayTime(best.dateEndorsedDisplay);
    // A NAP DOWN record should belong to the ticket if it is on the same
    // calendar date, or if it is the closest available record for that
    // municipality/finding. This handles sheets where the displayed date is
    // authoritative but the raw Google date value is locale-shifted.
    if (!Number.isNaN(bestTime)) row.napCode = best.napCode;
  }

  const statusCounts = counts(db.rows);
  const napStatusCounts = counts(nap.rows.map(r => ({finalStatus: r.sourceStatus || 'BLANK'})));

  const options = {
    province: uniqueSorted(db.rows.map(r => r.province)),
    status: Object.keys(statusCounts).sort((a, b) => a.localeCompare(b)),
    finding: uniqueSorted(db.rows.map(r => r.finding).concat(nap.rows.map(r => r.finding))),
    rfo: uniqueSorted(db.rows.map(r => r.rfo)),
    concern: uniqueSorted(db.rows.map(r => r.concern))
  };

  const dates = uniqueSorted(db.rows.map(r => dayKey(r.dateEndorsed)).filter(Boolean)).sort().reverse();

  return {
    ok: true,
    version,
    sourceMode,
    syncState: 'SYNCED',
    rows: db.rows,
    napDownRows: nap.rows,
    statusCounts,
    napStatusCounts,
    pendingCount: statusCounts.PENDING || 0,
    restoredCount: statusCounts.RESTORED || 0,
    napDownSheetCount: nap.rows.length,
    options,
    dates,
    diagnostics: {
      dbHeaderRow: db.headerRow,
      napDownHeaderRow: nap.headerRow,
      databaseRows: db.dataRows,
      napDownRows: nap.rows.length,
      formulaErrors: db.formulaErrors,
      droppedRows: 0
    },
    napDownHeaderRow: nap.headerRow
  };
}

module.exports = {build, parseDate, dayKey, clean, norm};
