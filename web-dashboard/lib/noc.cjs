const TERMINAL=new Set(['RESTORED','DUPLICATED','NO PROBLEM WHEN CHECKED','DISREGARD','DUPLICATE ENTRY','CANCELLED','CLOSED']);
const clean=v=>String(v??'').replace(/\u00a0/g,' ').replace(/[\t\r\n]+/g,' ').replace(/\s+/g,' ').trim();
const norm=v=>clean(v).toUpperCase();
function d(v){const s=clean(v);if(!s)return null;let x=new Date(s);if(!Number.isNaN(x.getTime()))return x;const m=s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[- ](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);if(!m)return null;const ms=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'],mo=ms.indexOf(m[2].toLowerCase());if(mo<0)return null;let h=Number(m[4]||0),ap=(m[7]||'').toUpperCase();if(ap==='PM'&&h<12)h+=12;if(ap==='AM'&&h===12)h=0;return new Date(Number(m[3]),mo,Number(m[1]),h,Number(m[5]||0),Number(m[6]||0))}
const iso=v=>{const x=d(v);return x?x.toISOString():''};
const elapsed=(s,e=new Date())=>{const x=d(s);return x?Math.max(0,(e.getTime()-x.getTime())/36e5):null};
const duration=(a,b)=>{const x=d(a),y=d(b);return x&&y?Math.max(0,(y.getTime()-x.getTime())/36e5):null};
const sla=h=>h==null?'Unknown':h<=24?'1. within 24 hrs':h<=48?'2. within 48 hrs':'3. beyond 48 hrs';
function idx(head,map){const h=(Array.isArray(head)?head:[]).map(x=>norm(x)),o={};for(const[k,a]of Object.entries(map))o[k]=h.findIndex(x=>a.includes(x));return o}
const DB={timestamp:['TIMESTAMP'],concern:['CONCERN GROUP','CONCERN'],province:['PROVINCE'],municipality:['MUNICIPALITY'],barangay:['BARANGAY'],facility:['FACILITY'],napStatus:['NAP STATUS'],restored:['DATE RESTORED'],rawStatus:['STATUS'],finalStatus:['FINAL STATUS'],rfo:['RFO'],osp:['OSP TEAM'],endorsed:['DATE ENDORSED'],etr:['ETR'],jo:['JO NUMBER'],sla:['SLA']};
const NAP={province:['PROVINCE'],municipality:['MUNICIPALITY'],barangay:['BARANGAY'],napCode:['NAP CODE','NAPCODE'],coordinates:['COORDINATES','FACILITY COORDINATES'],endorsed:['DATE ENDORSED','ENDORSED DATE'],duration:['DURATION','AGEING','AGING'],finding:['FINDINGS','FINDING'],status:['FINAL STATUS','STATUS']};

function parseDb(v){
  const rowsIn=Array.isArray(v)?v:[],c=idx(rowsIn[0]||[],DB),rows=[];
  for(let i=1;i<rowsIn.length;i++){
    const r=Array.isArray(rowsIn[i])?rowsIn[i]:[]; if(!r.some(x=>clean(x)!==''))continue;
    const raw=clean(r[c.rawStatus]??''),fs=clean(r[c.finalStatus]??''),status=fs||raw,end=d(r[c.endorsed]??'')||d(r[c.timestamp]??''),rest=d(r[c.restored]??''),down=end?(rest?duration(end,rest):elapsed(end)):null,up=rest?elapsed(rest):null,facility=clean(r[c.facility]??''),napStatus=clean(r[c.napStatus]??'');
    rows.push({rowNumber:i+1,timestamp:iso(r[c.timestamp]??''),concern:clean(r[c.concern]??''),province:clean(r[c.province]??''),municipality:clean(r[c.municipality]??''),barangay:clean(r[c.barangay]??''),facility,napCode:'',napStatus,finding:napStatus,rfo:clean(r[c.rfo]??''),ospTeam:clean(r[c.osp]??''),joNumber:clean(r[c.jo]??''),etr:clean(r[c.etr]??''),dateEndorsed:iso(end),dateRestored:iso(rest),rawStatus:raw,finalStatus:status,status,open:Boolean(status)&&!TERMINAL.has(norm(status)),restored:status==='RESTORED',downHours:down,upHours:up,operationalSla:sla(down),sourceSla:clean(r[c.sla]??''),key:[facility,r[c.province],r[c.municipality]].map(norm).filter(Boolean).join('|')});
  }
  return rows;
}
function parseNap(v){
  const rowsIn=Array.isArray(v)?v:[],c=idx(rowsIn[0]||[],NAP),rows=[];
  for(let i=1;i<rowsIn.length;i++){
    const r=Array.isArray(rowsIn[i])?rowsIn[i]:[]; if(!r.some(x=>clean(x)!==''))continue;
    rows.push({sourceRow:i+1,province:clean(r[c.province]??''),municipality:clean(r[c.municipality]??''),barangay:clean(r[c.barangay]??''),napCode:clean(r[c.napCode]??''),coordinates:clean(r[c.coordinates]??''),dateEndorsed:iso(r[c.endorsed]??''),duration:clean(r[c.duration]??''),finding:clean(r[c.finding]??''),status:clean(r[c.status]??'')||'PENDING'});
  }
  return rows;
}
function durationText(s){const m=clean(s).match(/(\d+)\s*days?\s*(\d+)\s*hours?/i);return m?Number(m[1])*24+Number(m[2]):null}
function build(dbTab,napTab,version,mode){
  const db=parseDb(dbTab?.values||[]);
  let nap=parseNap(napTab?.values||[]);
  let napFallback=false;
  if(!nap.length){
    napFallback=true;
    nap=db.filter(r=>r.finalStatus==='PENDING').map(r=>({sourceRow:r.rowNumber,province:r.province,municipality:r.municipality,barangay:r.barangay,napCode:r.napCode,coordinates:'',dateEndorsed:r.dateEndorsed,duration:'',finding:r.finding||r.napStatus||'Blank',status:'PENDING',fallbackFromDatabase:true}));
  }
  const rowsByArea=new Map();
  for(const r of db){const k=(r.province+'|'+r.municipality).toUpperCase();rowsByArea.set(k,[...(rowsByArea.get(k)||[]),r])}
  const napRows=nap.map(n=>{
    const cs=rowsByArea.get((n.province+'|'+n.municipality).toUpperCase())||[],day=n.dateEndorsed?String(n.dateEndorsed).slice(0,10):'';
    const m=cs.find(x=>x.dateEndorsed&&day&&x.dateEndorsed.slice(0,10)===day)||cs.find(x=>x.finalStatus==='PENDING')||cs[0];
    const down=m?.downHours??(n.duration?durationText(n.duration):null),rest=m?.dateRestored||'',status=m?.finalStatus||n.status||'PENDING';
    return{...n,concern:m?.concern||'Unspecified',rfo:m?.rfo||'',ospTeam:m?.ospTeam||'',etr:m?.etr||'',dateEndorsed:m?.dateEndorsed||n.dateEndorsed,dateRestored:rest,downHours:down,upHours:m?.upHours??(rest?elapsed(rest):null),finding:n.finding||m?.finding||m?.napStatus||'Blank',status,finalStatus:status,open:!TERMINAL.has(norm(status)),operationalSla:sla(down)}
  });
  const statusCounts={};for(const r of db){const s=r.finalStatus||'BLANK';statusCounts[s]=(statusCounts[s]||0)+1}
  const options={province:[...new Set(db.map(r=>r.province).filter(Boolean))].sort(),status:Object.keys(statusCounts).sort(),finding:[...new Set(db.map(r=>r.finding).filter(Boolean).concat(napRows.map(r=>r.finding).filter(Boolean)))].sort(),rfo:[...new Set(db.map(r=>r.rfo).filter(Boolean))].sort(),concern:[...new Set(db.map(r=>r.concern).filter(Boolean))].sort()};
  const pendingCount=statusCounts.PENDING||0;
  return{ok:true,version,sourceMode:mode+(napFallback?'-nap-fallback':''),rows:db,napDownRows:napRows,statusCounts,pendingCount,napDownSheetCount:napRows.length,pendingReconciliation:(pendingCount===napRows.length),napFallback,options,quality:{sourceRows:db.length,parsedRows:db.length,droppedRows:0}};
}
module.exports={build};
