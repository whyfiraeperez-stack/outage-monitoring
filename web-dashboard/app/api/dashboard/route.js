import {NextResponse} from 'next/server';

export const dynamic='force-dynamic';
export const revalidate=0;

const SHEET_ID='1yhtm8pTJ9VP0TUrFm2JedYoCZ_M22K196luw3u9Xl4s';
const GID='1995500191';

const aliases={
 timestamp:['timestamp','date/time','datetime','date time'],
 concern:['concern group','concern_group','concern'],
 province:['province','prov'],
 municipality:['municipality','city/municipality','city'],
 facility:['facility','site','location'],
 restored:['date restored','restored date','date restored'],
 status:['final status','final_status','status','nap status'],
 rfo:['rfo','ops team','team','assigned team','ops_team'],
 endorsed:['date endorsed','endorsed date','endorsement date'],
 ageing:['ageing','aging','ageing (days)','ageing days'],
 sla:['sla','sla status','sla category','sla classification']
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
 if(v==='PENDING'||v==='OPEN'||v==='ONGOING'||v==='FOR ACTION') return 'PENDING';
 if(v==='RESTORED'||v==='RESOLVED') return 'RESTORED';
 if(v==='DUPLICATED'||v==='DUPLICATE') return 'DUPLICATED';
 if(v==='CLOSED') return 'CLOSED';
 return v||'UNKNOWN';
}

function headers(h){
 const n=h.map(norm),o={};
 for(const[k,a]of Object.entries(aliases)) o[k]=n.findIndex(x=>a.includes(x));
 return o;
}

function scoreHeader(row){
 const n=row.map(norm);
 let score=0;
 for(const a of Object.values(aliases)) if(n.some(x=>a.includes(x))) score++;
 return score;
}

function findHeader(raw){
 let best=-1,bestScore=0;
 const limit=Math.min(raw.length,60);
 for(let i=0;i<limit;i++){
  const s=scoreHeader(raw[i]||[]);
  if(s>bestScore){bestScore=s;best=i}
 }
 return best>=0?best:0;
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
 if(!raw.length)return {rows:[],quality:{issues:0,sourceRows:0,parsedRows:0,droppedRows:0,rawPendingCount:0,rawStatusCounts:{},headerRow:0,headerScore:0,headerMap:{},agent:{status:'ERROR',issues:1,checks:[]}}};

 const headerIndex=findHeader(raw);
 const h=raw[headerIndex]||[];
 const c=headers(h), out=[], issues=[], rawStatusCounts={};
 let droppedRows=0;
 const missingFields=Object.entries(c).filter(([,idx])=>idx<0).map(([k])=>k);
 if(c.status<0) issues.push('No status column was detected in the NAP DOWN header.');
 if(c.province<0) issues.push('No province column was detected in the NAP DOWN header.');
 if(c.concern<0) issues.push('No concern group column was detected in the NAP DOWN header.');
 if(c.rfo<0) issues.push('No RFO/Ops Team column was detected in the NAP DOWN header.');

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
  const m=rawAge.match(/(-?\d+(?:\.\d+)?)/);
  if(m) hours=Number(m[1])*24;
  else if(start) hours=((status==='RESTORED'&&restored?restored:new Date())-start)/3600000;

  let sla=cleanText(c.sla>=0?r[c.sla]:'').toLowerCase();
  if(!sla) sla=hours==null?'Unknown':hours<=24?'1. within 24 hrs':hours<=48?'2. within 48 hrs':'3. beyond 48 hrs';
  else if(sla.includes('beyond'))sla='3. beyond 48 hrs';
  else if(sla.includes('48'))sla='2. within 48 hrs';
  else if(sla.includes('24'))sla='1. within 24 hrs';

  const open=!['RESTORED','DUPLICATED','CLOSED'].includes(status);
  const formulaExpectedSla=hours==null?'Unknown':hours<=24?'1. within 24 hrs':hours<=48?'2. within 48 hrs':'3. beyond 48 hrs';

  if(!start)issues.push('Missing endorsement/timestamp source row '+(i+1));
  if(status==='UNKNOWN')issues.push('Missing/unrecognized final status source row '+(i+1));
  if(sla!=='Unknown'&&formulaExpectedSla!==sla)issues.push('SLA/formula mismatch source row '+(i+1));

  out.push({
   sourceRow:i+1,province,concern,rfo,status,sla,open,
   endorsedDate:start?start.toISOString().slice(0,10):'',
   restored24:!!restored&&Date.now()-restored.getTime()<=86400000&&restored<=new Date(),
   new24:!!start&&Date.now()-start.getTime()<=86400000&&start<=new Date()
  });
 }

 const formulaMismatches=issues.filter(x=>x.startsWith('SLA/formula mismatch')).length;
 const unknownStatuses=rawStatusCounts.UNKNOWN||0;
 const checks=[
  {name:'Header mapping',status:missingFields.length?'WARN':'OK',detail:missingFields.length?'Missing: '+missingFields.join(', '):'All dashboard fields mapped'},
  {name:'Status normalization',status:unknownStatuses?'WARN':'OK',detail:unknownStatuses?unknownStatuses+' rows have unknown status':'All statuses recognized'},
  {name:'SLA formula parity',status:formulaMismatches?'WARN':'OK',detail:formulaMismatches?formulaMismatches+' rows differ from elapsed-time SLA rule':'Values match dashboard SLA rule'},
  {name:'Row parsing',status:droppedRows?'WARN':'OK',detail:droppedRows?droppedRows+' blank rows skipped':'No blank source rows skipped'}
 ];
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
   headerScore:scoreHeader(h),
   headerMap:c,
   missingFields,
   rawPendingCount:rawStatusCounts.PENDING||0,
   rawStatusCounts,
   agent:{status:checks.some(x=>x.status==='WARN')?'WARN':'OK',issues:issues.length,checks}
  }
 };
}

export async function GET(){
 try{
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
   fetchedAt:new Date().toISOString(),
   source:{sheetId:SHEET_ID,gid:GID,name:'NAP DOWN'}
  });
 }catch(e){
  return NextResponse.json({error:e.message},{status:500});
 }
}
