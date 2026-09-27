const TERMINAL = new Set(['RESTORED','DUPLICATED','NO PROBLEM WHEN CHECKED','DISREGARD','DUPLICATE ENTRY','CANCELLED','CLOSED']);
const clean = v => String(v ?? '').replace(/\u00a0/g, ' ').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
const norm = v => clean(v).toUpperCase();

function parseDate(v) {
  const s = clean(v);
  if (!s) return null;
  let d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d;
  const m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if (!m) return null;
  const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const mo = months.indexOf(m[2].toLowerCase());
  if (mo < 0) return null;
  let h = Number(m[4] || 0);
  if ((m[7] || '').toUpperCase() === 'PM' && h < 12) h += 12;
  if ((m[7] || '').toUpperCase() === 'AM' && h === 12) h = 0;
  return new Date(Number(m[3]), mo, Number(m[1]), h, Number(m[5] || 0), Number(m[6] || 0));
}

const iso = v => { const d = parseDate(v); return d ? d.toISOString() : ''; };
const elapsedHours = (start, end = new Date()) => {
  const a = parseDate(start);
  if (!a) return null;
  return Math.max(0, (end.getTime() - a.getTime()) / 36e5);
};
const durationHours = (start, end) => {
  const a = parseDate(start);
  const b = parseDate(end);
  if (!a || !b) return null;
  return Math.max(0, (b.getTime() - a.getTime()) / 36e5);
};
const sla = h => h == null ? 'Unknown' : h <= 24 ? '1. within 24 hrs' : h <= 48 ? '2. within 48 hrs' : '3. beyond 48 hrs';
const headers = (row, aliases) => {
  const h = row.map(x => norm(x));
  const o = {};
  for (const [k, list] of Object.entries(aliases)) o[k] = h.findIndex(x => list.includes(x));
  return o;
};
const key = (...v) => v.map(x => norm(x)).filter(Boolean).join('|');

const DB = {
  timestamp:['TIMESTAMP'], concern:['CONCERN GROUP','CONCERN'], province:['PROVINCE'],
  municipality:['MUNICIPALITY'], barangay:['BARANGAY'], facility:['FACILITY'],
  napStatus:['NAP STATUS'], restored:['DATE RESTORED'], status:['STATUS','FINAL STATUS'],
  rfo:['RFO'], osp:['OSP TEAM'], endorsed:['DATE ENDORSED'], etr:['ETR'], jo:['JO NUMBER'], sla:['SLA']
};
const NAP = {
  province:['PROVINCE'], municipality:['MUNICIPALITY'], barangay:['BARANGAY'],
  napCode:['NAP CODE','NAPCODE'], coordinates:['COORDINATES','FACILITY COORDINATES'],
  endorsed:['DATE ENDORSED','ENDORSED DATE'], duration:['DURATION','AGEING','AGING'],
  finding:['FINDINGS','FINDING'], status:['FINAL STATUS','STATUS']
};

function parseDatabase(values) {
  if (!values.length) return { rows: [], issues:['DATABASE returned no rows'] };
  const h = headers(values[0], DB);
  const rows = [];
  for (let i=1; i<values.length; i++) {
    const r = values[i] || [];
    if (!r.some(v => clean(v) !== '')) continue;

    const status = clean(r[h.status] ?? '');
    const endorsed = parseDate(r[h.endorsed] ?? '') || parseDate(r[h.timestamp] ?? '');
    const restored = parseDate(r[h.restored] ?? '');

    // Correct source-equivalent duration:
    // restored -> DATE RESTORED - DATE ENDORSED
    // active   -> now - DATE ENDORSED
    const down = endorsed
      ? (restored ? durationHours(endorsed, restored) : elapsedHours(endorsed))
      : null;
    const up = restored ? elapsedHours(restored) : null;

    const facility = clean(r[h.facility] ?? '');
    const napStatus = clean(r[h.napStatus] ?? '');

    rows.push({
      rowNumber:i+1,
      timestamp:iso(r[h.timestamp] ?? ''),
      concern:clean(r[h.concern] ?? ''),
      province:clean(r[h.province] ?? ''),
      municipality:clean(r[h.municipality] ?? ''),
      barangay:clean(r[h.barangay] ?? ''),
      facility,
      napCode:facility,
      napStatus,
      finding:napStatus,
      rfo:clean(r[h.rfo] ?? ''),
      ospTeam:clean(r[h.osp] ?? ''),
      joNumber:clean(r[h.jo] ?? ''),
      etr:clean(r[h.etr] ?? ''),
      dateEndorsed:iso(endorsed),
      dateRestored:iso(restored),
      status,
      finalStatus:status,
      open:Boolean(status) && !TERMINAL.has(norm(status)),
      restored:status === 'RESTORED',
      napDown:status === 'PENDING',
      downHours:down,
      upHours:up,
      operationalSla:sla(down),
      sourceSla:clean(r[h.sla] ?? ''),
      key:key(facility, r[h.province], r[h.municipality])
    });
  }
  return { rows, issues:[], header:h };
}

function parseDurationHours(text) {
  const s = clean(text);
  if (!s) return null;
  const d = /([0-9]+)\s*day/i.exec(s);
  const h = /([0-9]+)\s*hour/i.exec(s);
  const m = /([0-9]+)\s*min/i.exec(s);
  if (d || h || m) {
    return Number(d?.[1] || 0) * 24 + Number(h?.[1] || 0) + Number(m?.[1] || 0) / 60;
  }
  const n = /([0-9]+(?:\.[0-9]+)?)/.exec(s);
  return n ? Number(n[1]) * 24 : null;
}

function parseNapDown(values) {
  if (!values.length) return { rows: [], issues:['NAP DOWN returned no rows'] };
  const h = headers(values[0], NAP);
  const rows = [];

  for (let i=1; i<values.length; i++) {
    const r = values[i] || [];
    if (!r.some(v => clean(v) !== '')) continue;

    rows.push({
      sourceRow:i+1,
      province:clean(r[h.province] ?? ''),
      municipality:clean(r[h.municipality] ?? ''),
      barangay:clean(r[h.barangay] ?? ''),
      napCode:clean(r[h.napCode] ?? ''),
      coordinates:clean(r[h.coordinates] ?? ''),
      dateEndorsed:iso(r[h.endorsed] ?? ''),
      duration:clean(r[h.duration] ?? ''),
      finding:clean(r[h.finding] ?? ''),
      status:clean(r[h.status] ?? '') || 'PENDING',
      key:key(r[h.napCode] ?? '', r[h.province] ?? '', r[h.municipality] ?? '')
    });
  }
  return { rows, issues:[], header:h };
}

export function buildSnapshot(dbTab, napTab, version, sourceMode) {
  const db = parseDatabase(dbTab.values || []);
  const nap = parseNapDown(napTab.values || []);
  const map = new Map();

  for (const r of db.rows) {
    if (r.key && !map.has(r.key)) map.set(r.key, r);
  }

  const napDownRows = nap.rows.map(n => {
    const d =
      map.get(n.key) ||
      [...map.values()].find(
        x =>
          x.province === n.province &&
          x.municipality === n.municipality &&
          x.dateEndorsed?.slice(0,10) === n.dateEndorsed?.slice(0,10)
      );

    const endorsed = d?.dateEndorsed || n.dateEndorsed;
    const restored = d?.dateRestored || '';

    const down =
      endorsed
        ? (restored
            ? durationHours(endorsed, restored)
            : elapsedHours(endorsed))
        : parseDurationHours(n.duration);

    const up = restored ? elapsedHours(restored) : null;

    return {
      ...n,
      concern:d?.concern || 'Unspecified',
      rfo:d?.rfo || '',
      ospTeam:d?.ospTeam || '',
      joNumber:d?.joNumber || '',
      etr:d?.etr || '',
      dateEndorsed:endorsed,
      dateRestored:restored,
      downHours:down,
      upHours:up,
      operationalSla:sla(down),
      open:d?.open ?? (norm(n.status) === 'PENDING'),
      finding:n.finding || d?.finding || d?.napStatus || 'Blank',
      status:d?.status || n.status || 'PENDING'
    };
  });

  const statusCounts = {};
  for (const r of db.rows) {
    statusCounts[r.status || 'BLANK'] = (statusCounts[r.status || 'BLANK'] || 0) + 1;
  }

  const options = {
    province:[...new Set(db.rows.map(r => r.province).filter(Boolean))].sort(),
    status:Object.keys(statusCounts).sort(),
    rfo:[...new Set(db.rows.map(r => r.rfo).filter(Boolean))].sort(),
    finding:[...new Set(db.rows.map(r => r.finding).filter(Boolean))].sort(),
    concern:[...new Set(db.rows.map(r => r.concern).filter(Boolean))].sort()
  };

  const pendingCount = statusCounts.PENDING || 0;

  return {
    ok:true,
    version,
    generatedAt:Date.now(),
    rows:db.rows,
    napDownRows,
    statusCounts,
    pendingCount,
    options,
    quality:{
      sourceRows:db.rows.length,
      parsedRows:db.rows.length,
      droppedRows:0,
      rawPendingCount:pendingCount,
      napDownRows:napDownRows.length,
      issues:[...db.issues, ...nap.issues].length
    },
    sourceMode
  };
}
