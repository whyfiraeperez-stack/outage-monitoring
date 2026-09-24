import {NextResponse} from 'next/server';

export const dynamic='force-dynamic';
export const revalidate=0;

const SHEET_ID='1yhtm8pTJ9VP0TUrFm2JedYoCZ_M22K196luw3u9Xl4s';
const GID='1995500191';

const aliases={
 timestamp:['timestamp','date/time','datetime'],
 concern:['concern group','concern_group','concern'],
 province:['province'],
 municipality:['municipality','city/municipality','city'],
 facility:['facility'],
 restored:['date restored','restored date'],
 status:['final status','final_status','status'],
 rfo:['rfo','ops team','team','assigned team'],
 endorsed:['date endorsed','endorsed date'],
 ageing:['ageing','aging'],
 sla:['sla','sla status']
};

const norm=s=>String(s??'')
 .replace(/\u00a0/g,' ')
 .replace(/[\u2000-\u200b\u202f\u205f\u3000]/g,' ')
 .trim().toLowerCase().replace(/\s+/g,' ');

const cleanText=s=>String(s??'')
 .replace(/\u00a0/g,' ')
 .replace(/[\u2000-\u200b\u202f\u205f\u3000]/g,' ')
 .replace(/[\t\r\n]+/g,' ')
 .trim().replace(/\s+/g,' ');

function normalizeStatus(s){
 const v=cleanText(s).toUpperCase();
 if(v==='PENDING') return 'PENDING';
 if(v==='RESTORED') return 'RESTORED';
 if(v==='DUPLICATED'||v==='DUPLICATE') return 'DUPLICATED';
 if(v==='CLOSED') return 'CLOSED';
 return v||'UNKNOWN';
}

function headers(h){
 const n=h.map(norm),o={};
 for(const[k,a]of Object.entries(aliases)) o[k]=n.findIndex(x=>a.includes(x));
 return o;
}

function csv(text){
 const rows=[]; let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i],n=text[i+1];
  if(c==='"'&&quoted&&n==='"'){cell+='"';i++;continue}
  if(c==='"'){quoted=!quoted;continue}
  if(c===','&&!quoted){row.push(cell);cell='';continue}
  if((c==='\n'||c==='\r')&&!quoted){
   if(c==='\r'&&n==='\n')i++;
   row.push(cell);cell='';
   if(row.some(v=>String(v).trim()!==''))rows.push(row);
   row=[];continue
  }
  cell+=c;
 }
 if(cell!==''||row.length){row.push(cell);if(row.some(v=>String(v).trim()!==''))rows.push(row)}
 return rows;
}

function dt(v){
 if(v instanceof Date&&!isNaN(v))return v;
 const s=cleanText(v); if(!s)return null;
 const d=new Date(s); return isNaN(d)?null:d;
}

function clean(raw){
 if(!raw.length)return {rows:[],quality:{issues:0,sourceRows:0,parsedRows:0,droppedRows:0,rawPendingCount:0,rawStatusCounts:{}}};

 const headerIndex=raw.findIndex(r=>r.some(x=>norm(x)==='final status'));
 const h=headerIndex>=0?raw[headerIndex]:raw[0];
 const c=headers(h), out=[], issues=[], rawStatusCounts={};
 let droppedRows=0;

 for(let i=headerIndex+1;i<raw.length;i++){
  const r=raw[i];
  if(!r||!r.some(v=>cleanText(v)!=='')){droppedRows++;continue}

  const rawStatus=c.status>=0?r[c.status]:'';
  const status=normalizeStatus(rawStatus);
  rawStatusCounts[status]=(rawStatusCounts[status]||0)+1;

  const province=cleanText(c.province>=0?r[c.province]:'')||'Unspecified';
  const concern=cleanText(c.concern>=0?r[c.concern]:'')||'Unspecified';
  const rfo=cleanText(c.rfo>=0?r[c.rfo]:'')||'Blank';
  const start=dt(c.endorsed>=0?r[c.endorsed]:c.timestamp>=0?r[c.timestamp]:'');
  const restored=dt(c.restored>=0?r[c.restored]:'');
  const rawAge=c.ageing>=0?cleanText(r[c.ageing]):'';

  let hours=null;
  const m=rawAge.match(/(\d+(?:\.\d+)?)/);
  if(m) hours=Number(m[1])*24;
  else if(start) hours=((status==='RESTORED'&&restored?restored:new Date())-start)/3600000;

  let sla=cleanText(c.sla>=0?r[c.sla]:'').toLowerCase();
  if(!sla) sla=hours==null?'Unknown':hours<=24?'1. within 24 hrs':hours<=48?'2. within 48 hrs':'3. beyond 48 hrs';
  else if(sla.includes('beyond'))sla='3. beyond 48 hrs';
  else if(sla.includes('48'))sla='2. within 48 hrs';
  else if(sla.includes('24'))sla='1. within 24 hrs';

  const open=!['RESTORED','DUPLICATED','CLOSED'].includes(status);
  if(!start)issues.push('Missing endorsement/timestamp source row '+(i+1));
  if(status==='UNKNOWN')issues.push('Missing/unrecognized final status source row '+(i+1));

  out.push({
   sourceRow:i+1,province,concern,rfo,status,sla,open,
   endorsedDate:start?start.toISOString().slice(0,10):'',
   restored24:!!restored&&Date.now()-restored.getTime()<=86400000&&restored<=new Date(),
   new24:!!start&&Date.now()-start.getTime()<=86400000&&start<=new Date()
  });
 }

 const sourceRows=Math.max(0,raw.length-(headerIndex+1));
 return {
  rows:out,
  quality:{
   issues:issues.length,
   samples:issues.slice(0,8),
   sourceRows,
   parsedRows:out.length,
   droppedRows,
   headerRow:headerIndex+1,
   rawPendingCount:rawStatusCounts.PENDING||0,
   rawStatusCounts
  }
 };
}

export async function GET(){
 try{
  // Use the native CSV export instead of GViz query output. This reads the full DATABASE tab
  // and avoids query-layer filtering/truncation when reconciling the source row count.
  const u='https://docs.google.com/spreadsheets/d/'+encodeURIComponent(SHEET_ID)+'/export?format=csv&gid='+encodeURIComponent(GID)+'&cachebust='+Date.now();
  const r=await fetch(u,{cache:'no-store',headers:{'Cache-Control':'no-cache'}});
  if(!r.ok)throw new Error('Google Sheets returned HTTP '+r.status);
  const t=await r.text();
  if(t.includes('<html'))throw new Error('Google Sheets did not return CSV. Check sheet access/sharing.');

  const d=clean(csv(t));
  const unique=k=>[...new Set(d.rows.map(x=>x[k]).filter(Boolean))].sort();
  const statusCounts=d.rows.reduce((a,x)=>(a[x.status]=(a[x.status]||0)+1,a),{});

  return NextResponse.json({
   rows:d.rows,
   options:{province:unique('province'),status:unique('status'),rfo:unique('rfo'),concern:unique('concern')},
   quality:d.quality,
   statusCounts,
   fetchedAt:new Date().toISOString()
  });
 }catch(e){
  return NextResponse.json({error:e.message},{status:500});
 }
}
