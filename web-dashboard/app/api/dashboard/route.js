import {NextResponse} from 'next/server';

export const dynamic='force-dynamic';
export const revalidate=0;

const SHEET_ID='1yhtm8pTJ9VP0TUrFm2JedYoCZ_M22K196luw3u9Xl4s';
const NAP_DOWN_GID='1995500191';
const DATABASE_GID='946404240';
const PUBLISHED_CSV='https://docs.google.com/spreadsheets/d/e/2PACX-1vSKPMOn6CXZN3xn1zyKGcDyayAHLMuntjJ137x5dWxZzoJstX3Ef_XTtAgh6zId4n1gEyQBeL91lHFi/pub';

const napAliases={
 province:['province','prov'],municipality:['municipality','city/municipality','city'],barangay:['barangay','brgy'],napCode:['nap code','napcode','nap_code'],
 endorsed:['date endorsed','endorsed date','endorsement date'],duration:['duration','ageing','aging','ageing (days)','ageing days'],findings:['findings','finding'],
 status:['final status','final_status','status','nap status'],restored:['date restored','restored date'],sla:['sla','sla status','sla category','sla classification'],facility:['facility','site','location']
};
const dbAliases={
 concern:['concern group','concern_group','concern'],province:['province','prov'],municipality:['municipality','city/municipality','city'],barangay:['barangay','brgy'],
 napCode:['nap code','napcode','nap_code'],facility:['facility','site','location'],status:['final status','final_status','status','nap status'],
 endorsed:['date endorsed','endorsed date','endorsement date','timestamp'],restored:['date restored','restored date'],ageing:['ageing','aging','ageing (days)','ageing days'],
 sla:['sla','sla status','sla category','sla classification']
};

const norm=s=>String(s??'').replace(/\u00a0/g,' ').replace(/[\u2000-\u200b\u202f\u205f\u3000]/g,' ').trim().toLowerCase().replace(/\s+/g,' ');
const cleanText=s=>String(s??'').replace(/\u00a0/g,' ').replace(/[\u2000-\u200b\u202f\u205f\u3000]/g,' ').replace(/[\t\r\n]+/g,' ').trim().replace(/\s+/g,' ');

function normalizeStatus(s,fallback='PENDING'){
 const v=cleanText(s).toUpperCase();
 if(v==='PENDING'||v==='OPEN'||v==='ONGOING'||v==='FOR ACTION')return 'PENDING';
 if(v==='RESTORED'||v==='RESOLVED')return 'RESTORED';
 if(v==='DUPLICATED'||v==='DUPLICATE')return 'DUPLICATED';
 if(v==='CLOSED')return 'CLOSED';
 return v||fallback;
}
function csv(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];
  if(c==='"'&&quoted&&n==='"'){cell+='"';i++;continue}
  if(c==='"'){quoted=!quoted;continue}
  if(c===','&&!quoted){row.push(cell);cell='';continue}
  if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&n==='\n')i++;row.push(cell);cell='';if(row.some(v=>String(v).trim()!==''))rows.push(row);row=[];continue}
  cell+=c;
 }
 if(cell!==''||row.length){row.push(cell);if(row.some(v=>String(v).trim()!==''))rows.push(row)}
 return rows;
}
function headerIndexes(h,aliases){const n=h.map(norm),o={};for(const[k,a]of Object.entries(aliases))o[k]=n.findIndex(x=>a.includes(x));return o}
function headerScore(row,aliases){const n=row.map(norm);let score=0;for(const a of Object.values(aliases))if(n.some(x=>a.includes(x)))score++;return score}
function findHeader(raw,aliases){let best=-1,bestScore=-1;for(let i=0;i<Math.min(raw.length,100);i++){const score=headerScore(raw[i]||[],aliases);if(score>bestScore){best=i;bestScore=score}}return{index:best>=0?best:0,score:bestScore}}
function dt(v){const s=cleanText(v);if(!s)return null;const d=new Date(s);return isNaN(d)?null:d}
function dateKey(v){const d=dt(v);return d?d.toISOString().slice(0,10):''}
function keyPart(v){return norm(v).replace(/[^a-z0-9]+/g,' ')}
function makeKeys(row,c){
 const p=keyPart(c.province>=0?row[c.province]:''),m=keyPart(c.municipality>=0?row[c.municipality]:''),b=keyPart(c.barangay>=0?row[c.barangay]:''),n=keyPart(c.napCode>=0?row[c.napCode]:''),f=keyPart(c.facility>=0?row[c.facility]:''),d=dateKey(c.endorsed>=0?row[c.endorsed]:'');
 const keys=[];if(n)keys.push('n|'+n);if(p&&m&&b&&d)keys.push('pmbd|'+p+'|'+m+'|'+b+'|'+d);if(p&&m&&d)keys.push('pmd|'+p+'|'+m+'|'+d);if(p&&m&&f)keys.push('pmf|'+p+'|'+m+'|'+f);if(p&&f)keys.push('pf|'+p+'|'+f);return keys;
}
async function fetchPublished(gid){
 const u=PUBLISHED_CSV+'?gid='+encodeURIComponent(gid)+'&single=true&output=csv&cachebust='+Date.now();
 const r=await fetch(u,{cache:'no-store',redirect:'follow',headers:{'Cache-Control':'no-cache','User-Agent':'Mozilla/5.0'}});
 if(!r.ok)throw new Error('Published Google Sheet returned HTTP '+r.status+' for GID '+gid);
 const t=await r.text();if(t.includes('<html')||t.includes('<!DOCTYPE'))throw new Error('Published Google Sheet returned HTML instead of CSV for GID '+gid);
 return csv(t);
}
async function fetchPrivate(gid){
 const u='https://docs.google.com/spreadsheets/d/'+encodeURIComponent(SHEET_ID)+'/export?format=csv&gid='+encodeURIComponent(gid)+'&cachebust='+Date.now();
 const r=await fetch(u,{cache:'no-store',redirect:'follow'});if(!r.ok)throw new Error('Google Sheets returned HTTP '+r.status+' for GID '+gid);
 const t=await r.text();if(t.includes('<html'))throw new Error('Google Sheets returned HTML for GID '+gid);return csv(t);
}
async function fetchTab(gid){
 try{return{raw:await fetchPublished(gid),source:'published'}}
 catch(pub){try{return{raw:await fetchPrivate(gid),source:'sheet-export'}}catch(priv){throw new Error('Unable to read GID '+gid+'. Published CSV: '+pub.message+'; Sheet export: '+priv.message)}}
}

function parseDatabase(raw){
 if(!raw.length)return{records:[],maps:new Map(),concerns:[],provinces:[],issues:['DATABASE returned no rows']};
 const h=findHeader(raw,dbAliases),c=headerIndexes(raw[h.index]||[],dbAliases),records=[],maps=new Map(),concerns=new Set(),provinces=new Set(),issues=[];
 for(let i=h.index+1;i<raw.length;i++){
  const r=raw[i];if(!r||!r.some(v=>cleanText(v)!==''))continue;
  const concern=cleanText(c.concern>=0?r[c.concern]:''),province=cleanText(c.province>=0?r[c.province]:'');if(concern)concerns.add(concern);if(province)provinces.add(province);
  const rec={status:normalizeStatus(c.status>=0?r[c.status]:'',''),concern,province,restored:dt(c.restored>=0?r[c.restored]:''),endorsed:dt(c.endorsed>=0?r[c.endorsed]:''),ageing:cleanText(c.ageing>=0?r[c.ageing]:''),sla:cleanText(c.sla>=0?r[c.sla]:'')};
  records.push(rec);for(const k of makeKeys(r,c)){if(!maps.has(k))maps.set(k,rec)}
 }
 if(c.concern<0)issues.push('DATABASE CONCERN GROUP column was not detected.');
 if(c.status<0)issues.push('DATABASE FINAL STATUS column was not detected.');
 return{records,maps,concerns:[...concerns].sort(),provinces:[...provinces].sort(),issues,headerRow:h.index+1,headerMap:c};
}
function extractHours(duration){
 const s=cleanText(duration);if(!s)return null;const days=/(\d+)\s*day/i.exec(s),hrs=/(\d+)\s*hour/i.exec(s),mins=/(\d+)\s*min/i.exec(s);
 if(days||hrs||mins)return Number(days?.[1]||0)*24+Number(hrs?.[1]||0)+Number(mins?.[1]||0)/60;
 const n=/(-?\d+(?:\.\d+)?)/.exec(s);return n?Number(n[1])*24:null;
}
function normalizeSla(raw,hours){
 const s=cleanText(raw).toLowerCase();if(s.includes('beyond'))return'3. beyond 48 hrs';if(s.includes('48'))return'2. within 48 hrs';if(s.includes('24'))return'1. within 24 hrs';
 if(hours==null)return'Unknown';return hours<=24?'1. within 24 hrs':hours<=48?'2. within 48 hrs':'3. beyond 48 hrs';
}
function parseNap(raw,db){
 if(!raw.length)throw new Error('NAP DOWN returned no rows');
 const h=findHeader(raw,napAliases),c=headerIndexes(raw[h.index]||[],napAliases),out=[],statusCounts={},provinceStatusCounts={},rfoSet=new Set(),provinceSet=new Set(),issues=[];let droppedRows=0,matched=0;
 if(c.province<0)issues.push('NAP DOWN PROVINCE column was not detected.');
 if(c.findings<0)issues.push('NAP DOWN FINDINGS column was not detected.');
 if(c.endorsed<0)issues.push('NAP DOWN DATE ENDORSED column was not detected.');
 for(let i=h.index+1;i<raw.length;i++){
  const r=raw[i];if(!r||!r.some(v=>cleanText(v)!=='')){droppedRows++;continue}
  const province=cleanText(c.province>=0?r[c.province]:'')||'Unspecified',municipality=cleanText(c.municipality>=0?r[c.municipality]:''),napCode=cleanText(c.napCode>=0?r[c.napCode]:''),findings=cleanText(c.findings>=0?r[c.findings]:'')||'Blank',endorsed=dt(c.endorsed>=0?r[c.endorsed]:''),duration=cleanText(c.duration>=0?r[c.duration]:''),keys=makeKeys(r,c);
  let dbRec=null;for(const k of keys){if(db.maps.has(k)){dbRec=db.maps.get(k);break}}if(dbRec)matched++;
  const status=normalizeStatus(c.status>=0?r[c.status]:'',dbRec?.status||'PENDING'),hours=extractHours(duration),sla=normalizeSla(dbRec?.sla||c.sla>=0?r[c.sla]:'',hours),restored=dbRec?.restored||null,concern=dbRec?.concern||'Unspecified',open=!['RESTORED','DUPLICATED','CLOSED'].includes(status);
  statusCounts[status]=(statusCounts[status]||0)+1;if(!provinceStatusCounts[province])provinceStatusCounts[province]={};provinceStatusCounts[province][status]=(provinceStatusCounts[province][status]||0)+1;provinceSet.add(province);rfoSet.add(findings);
  if(!dbRec)issues.push('No DATABASE match for NAP row '+(i+1)+(napCode?' ('+napCode+')':''));
  out.push({sourceRow:i+1,province,municipality,napCode,concern,rfo:findings,status,sla,open,endorsedDate:endorsed?endorsed.toISOString().slice(0,10):'',duration,restored24:!!restored&&Date.now()-restored.getTime()<=86400000&&restored<=new Date(),new24:!!endorsed&&Date.now()-endorsed.getTime()<=86400000&&endorsed<=new Date()});
 }
 const provinceOptions=[...new Set([...provinceSet,...db.provinces])].filter(Boolean).sort(),statusOptions=Object.keys(statusCounts).sort(),rfoOptions=[...rfoSet].sort(),concernOptions=db.concerns.length?db.concerns:[...new Set(out.map(x=>x.concern).filter(Boolean))].sort();
 const checks=[{name:'NAP DOWN exact header map',status:(c.province>=0&&c.municipality>=0&&c.endorsed>=0&&c.findings>=0)?'OK':'WARN'},{name:'126-row source count',status:out.length===126?'OK':'WARN'},{name:'FINAL STATUS resolution',status:matched?'OK':'WARN'},{name:'RFO from FINDINGS',status:c.findings>=0?'OK':'WARN'},{name:'Concern from DATABASE',status:db.concerns.length?'OK':'WARN'},{name:'Row parsing',status:droppedRows?'WARN':'OK'}];
 return{rows:out,options:{province:provinceOptions,status:statusOptions,rfo:rfoOptions,concern:concernOptions},statusCounts,provinceStatusCounts,quality:{issues:issues.length+db.issues.length,samples:[...issues,...db.issues].slice(0,8),sourceRows:Math.max(0,raw.length-h.index-1),parsedRows:out.length,droppedRows,headerRow:h.index+1,headerScore:h.score,headerMap:c,rawPendingCount:statusCounts.PENDING||0,rawStatusCounts:statusCounts,databaseMatches:matched,agent:{status:checks.some(x=>x.status==='WARN')?'WARN':'OK',issues:issues.length+db.issues.length,checks}},source:{sheetId:SHEET_ID,napDownGid:NAP_DOWN_GID,databaseGid:DATABASE_GID,napDownSource:'published-csv',databaseSource:'published-csv'}};
}
export async function GET(){
 try{const [nap,dbRaw]=await Promise.all([fetchTab(NAP_DOWN_GID),fetchTab(DATABASE_GID)]);const db=parseDatabase(dbRaw.raw);const d=parseNap(nap.raw,db);return NextResponse.json({...d,fetchedAt:new Date().toISOString(),sourceMode:{nap:nap.source,database:dbRaw.source}})}
 catch(e){return NextResponse.json({error:e.message},{status:500})}
}
