const TERMINAL=new Set(['RESTORED','DUPLICATED','NO PROBLEM WHEN CHECKED','DISREGARD','DUPLICATE ENTRY','CANCELLED','CLOSED']);
const clean=v=>String(v??'').replace(/\u00a0/g,' ').replace(/[\t\r\n]+/g,' ').replace(/\s+/g,' ').trim();
const norm=v=>clean(v).toUpperCase();
function d(v){const s=clean(v);if(!s)return null;let x=new Date(s);if(!Number.isNaN(x.getTime()))return x;const m=s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);if(!m)return null;const ms=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'],mo=ms.indexOf(m[2].toLowerCase());if(mo<0)return null;let h=Number(m[4]||0),ap=(m[7]||'').toUpperCase();if(ap==='PM'&&h<12)h+=12;if(ap==='AM'&&h===12)h=0;return new Date(Number(m[3]),mo,Number(m[1]),h,Number(m[5]||0),Number(m[6]||0))}
const iso=v=>{const x=d(v);return x?x.toISOString():''};
const elapsed=(s,e=new Date())=>{const x=d(s);return x?Math.max(0,(e.getTime()-x.getTime())/36e5):null};
const duration=(a,b)=>{const x=d(a),y=d(b);return x&&y?Math.max(0,(y.getTime()-x.getTime())/36e5):null};
const sla=h=>h==null?'Unknown':h<=24?'1. within 24 hrs':h<=48?'2. within 48 hrs':'3. beyond 48 hrs';
function idx(head,map){const h=(Array.isArray(head)?head:[]).map(x=>norm(x)),o={};for(const[k,a]of Object.entries(map))o[k]=h.findIndex(x=>a.includes(x));return o}
function findHeaderRow(values,groups,maxScan=40){
  const rows=Array.isArray(values)?values:[];
  let best={index:-1,score:-1};
  for(let i=0;i<Math.min(rows.length,maxScan);i++){
    const h=(Array.isArray(rows[i])?rows[i]:[]).map(norm);
    let score=0;
    for(const group of groups){if(group.some(name=>h.includes(name.toUpperCase())))score++}
    if(score>best.score)best={index:i,score};
  }
  return best.score>=3?best.index:-1;
}
const DB={timestamp:['TIMESTAMP'],concern:['CONCERN GROUP','CONCERN'],province:['PROVINCE'],municipality:['MUNICIPALITY'],barangay:['BARANGAY'],facility:['FACILITY'],napStatus:['NAP STATUS'],restored:['DATE RESTORED'],rawStatus:['STATUS'],finalStatus:['FINAL STATUS'],rfo:['RFO'],osp:['OSP TEAM','OPS TEAM'],endorsed:['DATE ENDORSED','ENDORSED DATE'],etr:['ETR'],jo:['JO NUMBER'],sla:['SLA']};
const NAP={province:['PROVINCE'],municipality:['MUNICIPALITY'],barangay:['BARANGAY'],napCode:['NAP CODE','NAPCODE'],coordinates:['COORDINATES','FACILITY COORDINATES'],endorsed:['DATE ENDORSED','ENDORSED DATE'],duration:['DURATION','AGEING','AGING'],finding:['FINDINGS','FINDING'],status:['FINAL STATUS','FINAL STAT','STATUS']};
function parseDb(v){
  const values=Array.isArray(v)?v:[],headerRow=findHeaderRow(values,[...Object.values(DB).flat(), 'TIMESTAMP','PROVINCE','MUNICIPALITY','FACILITY','FINAL STATUS','DATE ENDORSED']);
  const hIndex=headerRow>=0?headerRow:0,c=idx(values[hIndex]||[],DB),rows=[];
  for(let i=hIndex+1;i<values.length;i++){
    const r=Array.isArray(values[i])?values[i]:[]; if(!r.some(x=>clean(x)!==''))continue;
    const raw=clean(c.rawStatus>=0?r[c.rawStatus]:'');const fs=clean(c.finalStatus>=0?r[c.finalStatus]:'');const status=fs||raw;
    const end=d(c.endorsed>=0?r[c.endorsed]:'')||d(c.timestamp>=0?r[c.timestamp]:'');const rest=d(c.restored>=0?r[c.restored]:'');
    const down=end?(rest?duration(end,rest):elapsed(end)):null,up=rest?elapsed(rest):null;
    const facility=clean(c.facility>=0?r[c.facility]:'');const napStatus=clean(c.napStatus>=0?r[c.napStatus]:'');
    rows.push({rowNumber:i+1,timestamp:iso(c.timestamp>=0?r[c.timestamp]:''),concern:clean(c.concern>=0?r[c.concern]:''),province:clean(c.province>=0?r[c.province]:''),municipality:clean(c.municipality>=0?r[c.municipality]:''),barangay:clean(c.barangay>=0?r[c.barangay]:''),facility,napCode:'',napStatus,finding:napStatus,rfo:clean(c.rfo>=0?r[c.rfo]:''),ospTeam:clean(c.osp>=0?r[c.osp]:''),joNumber:clean(c.jo>=0?r[c.jo]:''),etr:clean(c.etr>=0?r[c.etr]:''),dateEndorsed:iso(end),dateRestored:iso(rest),rawStatus:raw,finalStatus:status,status,open:Boolean(status)&&!TERMINAL.has(norm(status)),restored:status==='RESTORED',downHours:down,upHours:up,operationalSla:sla(down),sourceSla:clean(c.sla>=0?r[c.sla]:''),key:[facility,r[c.province],r[c.municipality]].map(norm).filter(Boolean).join('|')});
  }
  return {rows,headerRow:hIndex,header:values[hIndex]||[],columnMap:c};
}
function parseNap(v){
  const values=Array.isArray(v)?v:[],headerRow=findHeaderRow(values,[...Object.values(NAP).flat(),'PROVINCE','MUNICIPALITY','NAP CODE','FINDINGS']);
  const hIndex=headerRow>=0?headerRow:0,c=idx(values[hIndex]||[],NAP),rows=[];
  for(let i=hIndex+1;i<values.length;i++){
    const r=Array.isArray(values[i])?values[i]:[]; if(!r.some(x=>clean(x)!==''))continue;
    rows.push({sourceRow:i+1,province:clean(c.province>=0?r[c.province]:''),municipality:clean(c.municipality>=0?r[c.municipality]:''),barangay:clean(c.barangay>=0?r[c.barangay]:''),napCode:clean(c.napCode>=0?r[c.napCode]:''),coordinates:clean(c.coordinates>=0?r[c.coordinates]:''),dateEndorsed:iso(c.endorsed>=0?r[c.endorsed]:''),duration:clean(c.duration>=0?r[c.duration]:''),finding:clean(c.finding>=0?r[c.finding]:''),status:clean(c.status>=0?r[c.status]:'')||'PENDING'});
  }
  return {rows,headerRow:hIndex,header:values[hIndex]||[],columnMap:c};
}
function durationText(s){const m=clean(s).match(/(\d+)\s*days?\s*(\d+)\s*hours?/i);return m?Number(m[1])*24+Number(m[2]):null}
function build(dbTab,napTab,version,mode){
  const dbParsed=parseDb(dbTab?.values||[]),db=dbParsed.rows;
  const napParsed=parseNap(napTab?.values||[]);let nap=napParsed.rows,napFallback=false;
  if(!nap.length){napFallback=true;nap=db.filter(r=>r.finalStatus==='PENDING').map(r=>({sourceRow:r.rowNumber,province:r.province,municipality:r.municipality,barangay:r.barangay,napCode:r.napCode,coordinates:'',dateEndorsed:r.dateEndorsed,duration:'',finding:r.finding||r.napStatus||'Blank',status:'PENDING',fallbackFromDatabase:true}))}
  const rowsByArea=new Map();for(const r of db){const k=(r.province+'|'+r.municipality).toUpperCase();rowsByArea.set(k,[...(rowsByArea.get(k)||[]),r])}
  const napRows=nap.map(n=>{const cs=rowsByArea.get((n.province+'|'+n.municipality).toUpperCase())||[],day=n.dateEndorsed?String(n.dateEndorsed).slice(0,10):'',m=cs.find(x=>x.dateEndorsed&&day&&x.dateEndorsed.slice(0,10)===day)||cs.find(x=>x.finalStatus==='PENDING')||cs[0],down=m?.downHours??(n.duration?durationText(n.duration):null),rest=m?.dateRestored||'',status=m?.finalStatus||n.status||'PENDING';return{...n,concern:m?.concern||'Unspecified',rfo:m?.rfo||'',ospTeam:m?.ospTeam||'',etr:m?.etr||'',dateEndorsed:m?.dateEndorsed||n.dateEndorsed,dateRestored:rest,downHours:down,upHours:m?.upHours??(rest?elapsed(rest):null),finding:n.finding||m?.finding||m?.napStatus||'Blank',status,finalStatus:status,open:!TERMINAL.has(norm(status)),operationalSla:sla(down)}})
  const statusCounts={};for(const r of db){const s=r.finalStatus||'BLANK';statusCounts[s]=(statusCounts[s]||0)+1}
  const options={province:[...new Set(db.map(r=>r.province).filter(Boolean))].sort(),status:Object.keys(statusCounts).sort(),finding:[...new Set(db.map(r=>r.finding).filter(Boolean).concat(napRows.map(r=>r.finding).filter(Boolean)))].sort(),rfo:[...new Set(db.map(r=>r.rfo).filter(Boolean))].sort(),concern:[...new Set(db.map(r=>r.concern).filter(Boolean))].sort()};
  return{ok:true,version,sourceMode:mode+(napFallback?'-nap-fallback':''),rows:db,napDownRows:napRows,statusCounts,pendingCount:statusCounts.PENDING||0,napDownSheetCount:napRows.length,pendingReconciliation:(statusCounts.PENDING||0)===napRows.length,napFallback,options,diagnostics:{dbHeaderRow:dbParsed.headerRow+1,napHeaderRow:napParsed.headerRow+1,dbRows:db.length,napRows:napRows.length},quality:{sourceRows:db.length,parsedRows:db.length,droppedRows:0}};
}
module.exports={build};