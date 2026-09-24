import {NextResponse} from 'next/server';

export const dynamic='force-dynamic';
export const revalidate=0;

const SHEET_ID='1yhtm8pTJ9VP0TUrFm2JedYoCZ_M22K196luw3u9Xl4s';
const NAP_DOWN_GID='1995500191';
const DATABASE_GID='946404240';

const napAliases={
 timestamp:['timestamp','date/time','datetime','date time'],
 province:['province','prov'],
 municipality:['municipality','city/municipality','city'],
 facility:['facility','site','location'],
 status:['final status','final_status','status','nap status'],
 findings:['findings','finding'],
 endorsed:['date endorsed','endorsed date','endorsement date'],
 restored:['date restored','restored date'],
 ageing:['ageing','aging','ageing (days)','ageing days'],
 sla:['sla','sla status','sla category','sla classification']
};

const dbAliases={
 concern:['concern group','concern_group','concern'],
 province:['province','prov'],
 municipality:['municipality','city/municipality','city'],
 facility:['facility','site','location']
};

const norm=s=>String(s??'').replace(/\u00a0/g,' ').replace(/[\u2000-\u200b\u202f\u205f\u3000]/g,' ').trim().toLowerCase().replace(/\s+/g,' ');
const cleanText=s=>String(s??'').replace(/\u00a0/g,' ').replace(/[\u2000-\u200b\u202f\u205f\u3000]/g,' ').replace(/[\t\r\n]+/g,' ').trim().replace(/\s+/g,' ');

function normalizeStatus(s){
 const v=cleanText(s).toUpperCase();
 if(v==='PENDING'||v==='OPEN'||v==='ONGOING'||v==='FOR ACTION')return 'PENDING';
 if(v==='RESTORED'||v==='RESOLVED')return 'RESTORED';
 if(v==='DUPLICATED'||v==='DUPLICATE')return 'DUPLICATED';
 if(v==='CLOSED')return 'CLOSED';
 return v||'UNKNOWN';
}

function csv(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i],n=text[i+1];
  if(c==='"'&&quoted&&n==='"'){cell+='"';i++;continue}
  if(c==='"'){quoted=!quoted;continue}
  if(c===','&&!quoted){row.push(cell);cell='';continue}
  if((c==='\n'||c==='\r')&&!quoted){
   if(c==='\r'&&n==='\n')i++;
   row.push(cell);cell='';
   if(row.some(v=>String(v).trim()!==''))rows.push(row);
   row=[];continue;
  }
  cell+=c;
 }
 if(cell!==''||row.length){row.push(cell);if(row.some(v=>String(v).trim()!==''))rows.push(row)}
 return rows;
}

function headerIndexes(h,aliases){
 const n=h.map(norm),o={};
 for(const[k,a]of Object.entries(aliases))o[k]=n.findIndex(x=>a.includes(x));
 return o;
}

function headerScore(row,aliases){
 const n=row.map(norm);
 let score=0;
 for(const a of Object.values(aliases))if(n.some(x=>a.includes(x)))score++;
 return score;
}

function findHeader(raw,aliases,required=[]){
 let best=-1,bestScore=-1;
 const limit=Math.min(raw.length,80);
 for(let i=0;i<limit;i++){
  const n=(raw[i]||[]).map(norm);
  const exact=required.every(x=>n.includes(x));
  const score=headerScore(raw[i]||[],aliases)+(exact?20:0);
  if(score>bestScore){best=i;bestScore=score}
 }
 return {index:best>=0?best:0,score:bestScore};
}

function dt(v){
 const s=cleanText(v);if(!s)return null;
 const d=new Date(s);return isNaN(d)?null:d;
}

async function fetchTab(gid){
 const u='https://docs.google.com/spreadsheets/d/'+encodeURIComponent(SHEET_ID)+'/export?format=csv&gid='+encodeURIComponent(gid)+'&cachebust='+Date.now();
 const r=await fetch(u,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
 if(!r.ok)throw new Error('Google Sheets returned HTTP '+r.status+' for GID '+gid);
 const t=await r.text();
 if(t.includes('<html'))throw new Error('Google Sheets did not return CSV for GID '+gid+'. Check sheet access.');
 return csv(t);
}

function makeKey(row,c){
 const p=norm(c.province>=0?row[c.province]:'');
 const m=norm(c.municipality>=0?row[c.municipality]:'');
 const f=norm(c.facility>=0?row[c.facility]:'');
 if(p&&m&&f)return p+'|'+m+'|'+f;
 if(p&&f)return p+'|'+f;
 if(f)return f;
 return '';
}

function parseDatabase(raw){
 if(!raw.length)return {concernByKey:new Map(),concerns:[],provinces:[],issues:['DATABASE returned no rows']};
 const h=findHeader(raw,dbAliases,['province']);
 const c=headerIndexes(raw[h.index]||[],dbAliases);
 const map=new Map(),concerns=new Set(),provinces=new Set(),issues=[];
 for(let i=h.index+1;i<raw.length;i++){
  const r=raw[i];if(!r||!r.some(v=>cleanText(v)!==''))continue;
  const p=cleanText(c.province>=0?r[c.province]:'');if(p)provinces.add(p);
  const concern=cleanText(c.concern>=0?r[c.concern]:'');
  if(concern)concerns.add(concern);
  const key=makeKey(r,c);
  if(key&&concern&&!map.has(key))map.set(key,concern);
 }
 if(c.concern<0)issues.push('DATABASE concern column was not detected.');
 return {concernByKey:map,concerns:[...concerns].sort(),provinces:[...provinces].sort(),issues};
}

function parseNap(raw,db){
 if(!raw.length)return {rows:[],options:{},quality:{issues:1,sourceRows:0,parsedRows:0,rawPendingCount:0,agent:{status:'ERROR',checks:[]}}};
 const h=findHeader(raw,napAliases,['province','final status']);
 const headers=raw[h.index]||[];
 const c=headerIndexes(headers,napAliases);
 const out=[],statusCounts={},provinceStatusCounts={},rfoSet=new Set(),provinceSet=new Set(),issues=[];
 let droppedRows=0;
 const required=['province','status'];
 for(const k of required)if(c[k]<0)issues.push('NAP DOWN missing '+k+' header');
 if(c.findings<0)issues.push('NAP DOWN FINDINGS column was not detected.');

 for(let i=h.index+1;i<raw.length;i++){
  const r=raw[i];
  if(!r||!r.some(v=>cleanText(v)!=='')){droppedRows++;continue}
  const status=normalizeStatus(c.status>=0?r[c.status]:'');
  const province=cleanText(c.province>=0?r[c.province]:'')||'Unspecified';
  const findings=cleanText(c.findings>=0?r[c.findings]:'')||'Blank';
  const key=makeKey(r,c);
  const concern=db.concernByKey.get(key)||'Unspecified';
  const start=dt(c.endorsed>=0?r[c.endorsed]:c.timestamp>=0?r[c.timestamp]:'');
  const restored=dt(c.restored>=0?r[c.restored]:'');
  const rawAge=c.ageing>=0?cleanText(r[c.ageing]):'';
  let hours=null;
  const ageMatch=rawAge.match(/(-?\d+(?:\.\d+)?)/);
  if(ageMatch)hours=Number(ageMatch[1])*24;
  else if(start)hours=((status==='RESTORED'&&restored?restored:new Date())-start)/3600000;
  let sla=cleanText(c.sla>=0?r[c.sla]:'').toLowerCase();
  if(!sla)sla=hours==null?'Unknown':hours<=24?'1. within 24 hrs':hours<=48?'2. within 48 hrs':'3. beyond 48 hrs';
  else if(sla.includes('beyond'))sla='3. beyond 48 hrs';
  else if(sla.includes('48'))sla='2. within 48 hrs';
  else if(sla.includes('24'))sla='1. within 24 hrs';
  const open=!['RESTORED','DUPLICATED','CLOSED'].includes(status);
  statusCounts[status]=(statusCounts[status]||0)+1;
  if(!provinceStatusCounts[province])provinceStatusCounts[province]={};
  provinceStatusCounts[province][status]=(provinceStatusCounts[province][status]||0)+1;
  provinceSet.add(province);rfoSet.add(findings);
  if(status==='UNKNOWN')issues.push('Unknown FINAL STATUS at source row '+(i+1));
  if(!start)issues.push('Missing endorsement/timestamp at source row '+(i+1));
  out.push({sourceRow:i+1,province,concern,rfo:findings,status,sla,open,endorsedDate:start?start.toISOString().slice(0,10):'',restored24:!!restored&&Date.now()-restored.getTime()<=86400000&&restored<=new Date(),new24:!!start&&Date.now()-start.getTime()<=86400000&&start<=new Date()});
 }

 const provinceOptions=[...new Set([...provinceSet,...db.provinces])].filter(Boolean).sort();
 const statusOptions=[...new Set(Object.keys(statusCounts).filter(x=>x!=='UNKNOWN'))].sort();
 const rfoOptions=[...rfoSet].filter(Boolean).sort();
 const concernOptions=db.concerns.length?db.concerns:[...new Set(out.map(x=>x.concern).filter(Boolean))].sort();
 const checks=[
  {name:'NAP DOWN headers',status:(c.province>=0&&c.status>=0)?'OK':'WARN'},
  {name:'Province/status counts',status:provinceOptions.length?'OK':'WARN'},
  {name:'RFO from FINDINGS',status:c.findings>=0?'OK':'WARN'},
  {name:'Concern from DATABASE',status:db.concerns.length?'OK':'WARN'},
  {name:'Row parsing',status:droppedRows?'WARN':'OK'}
 ];
 return {
  rows:out,
  options:{province:provinceOptions,status:statusOptions,rfo:rfoOptions,concern:concernOptions},
  statusCounts,
  provinceStatusCounts,
  quality:{issues:issues.length+db.issues.length,samples:[...issues,...db.issues].slice(0,8),sourceRows:Math.max(0,raw.length-h.index-1),parsedRows:out.length,droppedRows,headerRow:h.index+1,headerScore:h.score,headerMap:c,rawPendingCount:statusCounts.PENDING||0,rawStatusCounts:statusCounts,agent:{status:checks.some(x=>x.status==='WARN')?'WARN':'OK',issues:issues.length+db.issues.length,checks}},
  source:{sheetId:SHEET_ID,napDownGid:NAP_DOWN_GID,databaseGid:DATABASE_GID}
 };
}

export async function GET(){
 try{
  const [napRaw,dbRaw]=await Promise.all([fetchTab(NAP_DOWN_GID),fetchTab(DATABASE_GID)]);
  const db=parseDatabase(dbRaw);
  const d=parseNap(napRaw,db);
  return NextResponse.json({...d,fetchedAt:new Date().toISOString()});
 }catch(e){
  return NextResponse.json({error:e.message},{status:500});
 }
}
