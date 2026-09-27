import {clients,sourceConfig,getFormulaValuesByGid} from './google';

const SAFE=new Set(['MONTH','FINAL STATUS','AGEING','SLA','MONTH RESTORED','SORT1','YEAR RESTORED','DATE REFERENCE','TYPE','ENDORSED MONTH','ENDORSED YEAR','SORT2','AGEING2','AGING']);
let state={lastAudit:null,issues:0,repaired:0};
const normalize=f=>String(f||'').replace(/(\$?[A-Z]{1,3}\$?)\d+/g,'$1{ROW}').replace(/\s+/g,' ').trim();
const colName=n=>{let s='';while(n>0){const r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26)}return s};
const dataRow=(r,idx)=>['TIMESTAMP','PROVINCE','MUNICIPALITY','FACILITY','NAP STATUS','STATUS','DATE ENDORSED'].some(k=>idx[k]>=0&&String(r[idx[k]]??'').trim()!=='');
const runs=a=>{const s=[...a].sort((x,y)=>x-y),o=[];let start=null,prev=null;for(const x of s){if(start===null){start=prev=x}else if(x===prev+1){prev=x}else{o.push([start,prev]);start=prev=x}}if(start!==null)o.push([start,prev]);return o};
export function getAgentPublicStatus(){return{configured:Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64&&process.env.NOC_AGENT_TOKEN),lastAudit:state.lastAudit,issues:state.issues,repaired:state.repaired}}
export async function auditFormulas(){
  const c=sourceConfig(),{values}=await getFormulaValuesByGid(c.dbGid);const h=(values[0]||[]).map(v=>String(v||'').trim()),idx={};h.forEach((x,i)=>idx[x.toUpperCase()]=i);const columns=[],issues=[];
  for(let col=0;col<h.length;col++){
    const header=h[col];if(!header)continue;const patterns=new Map(),patternRows=new Map();let formulaCount=0,firstFormula='';
    for(let row=1;row<values.length;row++){const f=String(values[row]?.[col]||'');if(f.startsWith('=')){formulaCount++;if(!firstFormula)firstFormula=f;const p=normalize(f);patterns.set(p,(patterns.get(p)||0)+1);if(!patternRows.has(p))patternRows.set(p,[]);patternRows.get(p).push(row+1)}}
    const sorted=[...patterns.entries()].sort((a,b)=>b[1]-a[1]),dominant=sorted[0]?.[0]||'',domCount=sorted[0]?.[1]||0,coverage=formulaCount/Math.max(1,values.length-1),dominance=formulaCount?domCount/formulaCount:0,heavy=formulaCount>=Math.max(5,Math.floor((values.length-1)*.6))&&dominance>=.8,safe=SAFE.has(header.toUpperCase()),rep=(patternRows.get(dominant)||[])[0]||null,holes=[];
    if(heavy&&rep){const rs=patternRows.get(dominant)||[];const end=rs[rs.length-1];for(let r=rep;r<=end;r++){const f=String(values[r-1]?.[col]||'');if(!f&&dataRow(values[r-1]||[],idx))holes.push(r)}}
    if(safe&&heavy&&holes.length)issues.push({type:'MISSING_FORMULAS',header,count:holes.length});
    columns.push({column:col+1,header,formulaCount,coverage,dominance,firstFormula,dominantPattern:dominant,representativeRow:rep,holes,safeRepair:safe&&heavy});
  }
  state.lastAudit=Date.now();state.issues=issues.length;return{ok:true,generatedAt:state.lastAudit,rowCount:values.length-1,columns,issues}
}
export async function repairMissingFormulas(){
  const audit=await auditFormulas(),c=sourceConfig(),{sheets}=await clients(),requests=[],repaired=[];
  for(const x of audit.columns){if(!x.safeRepair||!x.representativeRow||!x.holes.length)continue;for(const [start,end] of runs(x.holes)){
    requests.push({copyPaste:{source:{sheetId:Number(c.dbGid),startRowIndex:x.representativeRow-1,endRowIndex:x.representativeRow,startColumnIndex:x.column-1,endColumnIndex:x.column},destination:{sheetId:Number(c.dbGid),startRowIndex:start-1,endRowIndex:end,startColumnIndex:x.column-1,endColumnIndex:x.column},pasteType:'PASTE_FORMULA',pasteOrientation:'NORMAL'}});
    repaired.push({header:x.header,column:colName(x.column),from:start,to:end,sourceRow:x.representativeRow});
  }}
  if(requests.length)await sheets.spreadsheets.batchUpdate({spreadsheetId:c.sheetId,requestBody:{requests}});
  state.repaired=repaired.length;return{ok:true,repairedRuns:repaired.length,repaired,issues:audit.issues}
}
