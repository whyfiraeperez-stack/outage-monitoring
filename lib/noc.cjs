const TERMINAL=new Set(['RESTORED','DUPLICATED','NO PROBLEM WHEN CHECKED','DISREGARD','DUPLICATE ENTRY','CANCELLED','CLOSED']);
const clean=v=>String(v??'').replace(/\u00a0/g,' ').replace(/[\t\r\n]+/g,' ').replace(/\s+/g,' ').trim();
const norm=v=>clean(v).toUpperCase();
const compact=v=>norm(v).replace(/[^A-Z0-9]+/g,'');
function d(v){
  const s=clean(v); if(!s)return null;
  const x=new Date(s); if(!Number.isNaN(x.getTime()))return x;
  const m=s.match(/^(\d{1,2})[- /]([A-Za-z]{3,9})[- /](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
  if(!m)return null;
  const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const mo=months.findIndex(x=>m[2].toLowerCase().startsWith(x));
  if(mo<0)return null;
  let h=Number(m[4]||0),ap=(m[7]||'').toUpperCase();
  if(ap==='PM'&&h<12)h+=12;
  if(ap==='AM'&&h===12)h=0;
  return new Date(Number(m[3]),mo,Number(m[1]),h,Number(m[5]||0),Number(m[6]||0));
}
const iso=v=>{const x=d(v);return x?x.toISOString():''};
const dayKey=v=>{const x=d(v);return x?x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0'):''};
const elapsed=(s,e=new Date())=>{const x=d(s);return x?Math.max(0,(e.getTime()-x.getTime())/36e5):null};
const duration=(a,b)=>{const x=d(a),y=d(b);return x&&y?Math.max(0,(y.getTime()-x.getTime())/36e5):null};
const sla=h=>h==null?'Unknown':h<=24?'1. within 24 hrs':h<=48?'2. within 48 hrs':'3. beyond 48 hrs';
function idx(head,map){
  const h=(Array.isArray(head)?head:[]).map(norm),o={};
  for(const[k,a]of Object.entries(map))o[k]=h.findIndex(x=>a.some(alias=>x===alias));
  return o;
}
function findHeaderRow(values,groups,maxScan=60){
  const rows=Array.isArray(values)?values:[];let best={index:-1,score:-1};
  for(let i=0;i<Math.min(rows.length,maxScan);i++){
    const h=(Array.isArray(rows[i])?rows[i]:[]).map(norm);let score=0;
    for(const group of groups)if(group.some(name=>h.includes(name.toUpperCase())))score++;
    if(score>best.score)best={index:i,score};
  }
  return best.score>=3?best.index:-1;
}
const DB={
  timestamp:['TIMESTAMP'],
  concern:['CONCERN GROUP','CONCERN'],
  province:['PROVINCE'],
  municipality:['MUNICIPALITY','CITY/MUNICIPALITY','CITY'],
  barangay:['BARANGAY'],
  facility:['FACILITY'],
  napStatus:['NAP STATUS','NAP_STATUS'],
  restored:['DATE RESTORED','RESTORED DATE'],
  rawStatus:['STATUS'],
  finalStatus:['FINAL STATUS','FINAL STAT','FINAL_STATUS'],
  rfo:['RFO'],
  osp:['OSP TEAM','OPS TEAM'],
  endorsed:['DATE ENDORSED','ENDORSED DATE'],
  etr:['ETR'],
  jo:['JO NUMBER','JO NO','JO#'],
  sla:['SLA','SLA STATUS']
};
const NAP={
  province:['PROVINCE'],
  municipality:['MUNICIPALITY','CITY/MUNICIPALITY','CITY'],
  barangay:['BARANGAY'],
  napCode:['NAP CODE','NAPCODE'],
  coordinates:['COORDINATES','FACILITY COORDINATES'],
  endorsed:['DATE ENDORSED','ENDORSED DATE'],
  duration:['DURATION','AGEING','AGING'],
  finding:['FINDINGS','FINDING'],
  status:['FINAL STATUS','FINAL STAT','STATUS']
};
function parseDb(values){
  const headerRow=findHeaderRow(values,[['TIMESTAMP'],['PROVINCE'],['MUNICIPALITY'],['FACILITY'],['FINAL STATUS'],['DATE ENDORSED']]);
  if(headerRow<0)throw new Error('DATABASE header row not found in first 60 rows.');
  const h=values[headerRow]||[],c=idx(h,DB),rows=[];
  for(let i=headerRow+1;i<values.length;i++){
    const r=Array.isArray(values[i])?values[i]:[];
    if(!r.some(x=>clean(x)!==''))continue;
    const raw=clean(c.rawStatus>=0?r[c.rawStatus]:'');
    const finalCell=clean(c.finalStatus>=0?r[c.finalStatus]:'');
    const finalStatus=finalCell||'BLANK';
    const end=d(c.endorsed>=0?r[c.endorsed]:'')||d(c.timestamp>=0?r[c.timestamp]:'');
    const rest=d(c.restored>=0?r[c.restored]:'');
    const down=end?(rest?duration(end,rest):elapsed(end)):null;
    const up=rest?elapsed(rest):null;
    const facility=clean(c.facility>=0?r[c.facility]:'');
    const napStatus=clean(c.napStatus>=0?r[c.napStatus]:'');
    rows.push({
      rowNumber:i+1,
      timestamp:iso(c.timestamp>=0?r[c.timestamp]:''),
      concern:clean(c.concern>=0?r[c.concern]:''),
      province:clean(c.province>=0?r[c.province]:''),
      municipality:clean(c.municipality>=0?r[c.municipality]:''),
      barangay:clean(c.barangay>=0?r[c.barangay]:''),
      facility,
      napCode:'',
      napStatus,
      finding:napStatus,
      rfo:clean(c.rfo>=0?r[c.rfo]:''),
      ospTeam:clean(c.osp>=0?r[c.osp]:''),
      joNumber:clean(c.jo>=0?r[c.jo]:''),
      etr:clean(c.etr>=0?r[c.etr]:''),
      dateEndorsed:iso(end),
      dateRestored:iso(rest),
      sourceStatus:raw,
      finalStatus,
      status:finalStatus,
      open:finalStatus!=='BLANK'&&!TERMINAL.has(norm(finalStatus)),
      restored:norm(finalStatus)==='RESTORED',
      downHours:down,
      upHours:up,
      operationalSla:sla(down),
      sourceSla:clean(c.sla>=0?r[c.sla]:'')
    });
  }
  return {rows,headerRow,header:h,columnMap:c};
}
function parseNap(values){
  const headerRow=findHeaderRow(values,[['PROVINCE'],['MUNICIPALITY'],['NAP CODE','NAPCODE'],['FINDINGS','FINDING']]);
  if(headerRow<0)throw new Error('NAP DOWN header row not found in first 60 rows.');
  const h=values[headerRow]||[],c=idx(h,NAP),rows=[];
  for(let i=headerRow+1;i<values.length;i++){
    const r=Array.isArray(values[i])?values[i]:[];
    if(!r.some(x=>clean(x)!==''))continue;
    rows.push({
      sourceRow:i+1,
      province:clean(c.province>=0?r[c.province]:''),
      municipality:clean(c.municipality>=0?r[c.municipality]:''),
      barangay:clean(c.barangay>=0?r[c.barangay]:''),
      napCode:clean(c.napCode>=0?r[c.napCode]:''),
      coordinates:clean(c.coordinates>=0?r[c.coordinates]:''),
      dateEndorsed:iso(c.endorsed>=0?r[c.endorsed]:''),
      duration:clean(c.duration>=0?r[c.duration]:''),
      finding:clean(c.finding>=0?r[c.finding]:''),
      sourceStatus:clean(c.status>=0?r[c.status]:'')
    });
  }
  return {rows,headerRow,header:h,columnMap:c};
}
function durationText(s){
  const t=clean(s);
  const d1=t.match(/(\d+)\s*days?/i),h1=t.match(/(\d+)\s*hours?/i);
  return (d1?Number(d1[1])*24:0)+(h1?Number(h1[1]):0);
}
function candidateScore(n,r){
  if(n.province&&r.province&&norm(n.province)!==norm(r.province))return -1;
  if(n.municipality&&r.municipality&&norm(n.municipality)!==norm(r.municipality))return -1;
  let s=20,methods=[];
  const nc=compact(n.napCode),rf=compact(r.facility);
  if(nc&&rf&&(nc===rf||rf.includes(nc)||nc.includes(rf))){s+=120;methods.push('code')}
  if(n.finding&&r.napStatus&&norm(n.finding)===norm(r.napStatus)){s+=70;methods.push('finding')}
  if(n.barangay&&r.barangay&&norm(n.barangay)===norm(r.barangay)){s+=40;methods.push('barangay')}
  const nd=d(n.dateEndorsed),rd=d(r.dateEndorsed);
  if(nd&&rd){
    const diff=Math.abs(nd.getTime()-rd.getTime())/60000;
    if(diff<=15){s+=80;methods.push('date±15m')}
    else if(diff<=60){s+=65;methods.push('date±1h')}
    else if(dayKey(nd)===dayKey(rd)){s+=45;methods.push('same-day')}
  }
  if(norm(r.finalStatus)==='PENDING')s+=3;
  return {score:s,method:methods.join('+')||'area'};
}
function reconcileNap(napRows,dbRows){
  const napOut=[];
  let matched=0;
  for(const n of napRows){
    let best=null;
    for(const r of dbRows){
      const candidate=candidateScore(n,r);
      if(candidate.score<0)continue;
      if(!best||candidate.score>best.score||(candidate.score===best.score&&Math.abs((d(n.dateEndorsed)?.getTime()||0)-(d(r.dateEndorsed)?.getTime()||0))<Math.abs((d(n.dateEndorsed)?.getTime()||0)-(d(best.row.dateEndorsed)?.getTime()||0))))best={row:r,...candidate};
    }
    const hasMatch=!!best&&best.score>=70;
    if(hasMatch)matched++;
    const r=hasMatch?best.row:null;
    const fallbackStatus=n.sourceStatus||'PENDING';
    const finalStatus=r?r.finalStatus:(fallbackStatus||'PENDING');
    const down=r?.downHours??(n.duration?durationText(n.duration):null);
    const restored=r?.dateRestored||'';
    napOut.push({
      ...n,
      status:finalStatus,
      finalStatus,
      sourceStatus:n.sourceStatus||'PENDING',
      statusSource:r?'DATABASE FINAL STATUS':'NAP DOWN SOURCE',
      matchScore:hasMatch?best.score:0,
      matchMethod:hasMatch?best.method:'unmatched',
      matchedDbRow:r?.rowNumber||null,
      concern:r?.concern||'Unspecified',
      rfo:r?.rfo||'',
      ospTeam:r?.ospTeam||'',
      etr:r?.etr||'',
      dateEndorsed:r?.dateEndorsed||n.dateEndorsed,
      dateRestored:restored,
      downHours:down,
      upHours:r?.upHours??(restored?elapsed(restored):null),
      finding:n.finding||r?.finding||r?.napStatus||'Blank',
      open:finalStatus!=='BLANK'&&!TERMINAL.has(norm(finalStatus)),
      restored:norm(finalStatus)==='RESTORED',
      operationalSla:sla(down)
    });
  }
  return {rows:napOut,matched,unmatched:napRows.length-matched};
}
function countStatuses(rows){
  const out={};
  for(const r of rows){const s=clean(r.finalStatus)||'BLANK';out[s]=(out[s]||0)+1}
  return out;
}
function sortedKeys(obj){return Object.keys(obj).sort((a,b)=>a.localeCompare(b))}
function build(dbTab,napTab,version,mode){
  const dbParsed=parseDb(dbTab?.values||[]),db=dbParsed.rows;
  let napParsed={rows:[],headerRow:-1,header:[],columnMap:{}};
  try{napParsed=parseNap(napTab?.values||[])}catch(_){}
  let nap=napParsed.rows||[],napFallback=false;
  if(!nap.length){
    napFallback=true;
    nap=db.filter(r=>norm(r.finalStatus)==='PENDING').map(r=>({
      sourceRow:r.rowNumber,
      province:r.province,
      municipality:r.municipality,
      barangay:r.barangay,
      napCode:r.napCode||'',
      coordinates:'',
      dateEndorsed:r.dateEndorsed,
      duration:'',
      finding:r.finding||r.napStatus||'Blank',
      sourceStatus:'PENDING',
      fallbackFromDatabase:true
    }));
  }
  const rec=reconcileNap(nap,db);
  const statusCounts=countStatuses(db);
  const napStatusCounts=countStatuses(rec.rows);
  const dbPending=statusCounts.PENDING||0;
  const napPending=napStatusCounts.PENDING||0;
  const options={
    province:[...new Set(db.map(r=>r.province).filter(Boolean))].sort(),
    status:sortedKeys(statusCounts),
    finding:[...new Set(db.map(r=>r.finding).filter(Boolean).concat(rec.rows.map(r=>r.finding).filter(Boolean)))].sort(),
    rfo:[...new Set(db.map(r=>r.rfo).filter(Boolean))].sort(),
    concern:[...new Set(db.map(r=>r.concern).filter(Boolean))].sort()
  };
  return {
    ok:true,
    version,
    sourceMode:mode+(napFallback?'-nap-fallback':''),
    rows:db,
    napDownRows:rec.rows,
    statusCounts,
    napStatusCounts,
    pendingCount:dbPending,
    napDownSheetCount:nap.length,
    napDownPendingCount:napPending,
    pendingReconciliation:dbPending===napPending&&rec.unmatched===0,
    napFallback,
    reconciliation:{dbPending,napPending,dbRows:db.length,napRows:nap.length,matchedNapRows:rec.matched,unmatchedNapRows:rec.unmatched},
    options,
    diagnostics:{dbHeaderRow:dbParsed.headerRow+1,napHeaderRow:napParsed.headerRow>=0?napParsed.headerRow+1:null,dbRows:db.length,napRows:nap.length},
    quality:{sourceRows:db.length,parsedRows:db.length,droppedRows:0}
  };
}
module.exports={build};