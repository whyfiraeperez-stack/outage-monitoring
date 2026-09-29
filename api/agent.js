const {configured,credentialDiagnostics,sample,source,version}=require('../lib/server.cjs');
const {build}=require('../lib/noc.cjs');
let state={lastAutoRecovery:null,attempts:0,lastError:null,lastSync:null,lastReport:null};

function isoDay(v){
  const d=new Date(v||'');
  if(Number.isNaN(d.getTime()))return '';
  return d.toISOString().slice(0,10);
}
function summarizeRows(rows){
  const r=Array.isArray(rows)?rows:[];
  const statusCounts={};
  let minDate='',maxDate='';
  for(const x of r){
    const s=String(x.finalStatus||'BLANK').trim()||'BLANK';
    statusCounts[s]=(statusCounts[s]||0)+1;
    const k=isoDay(x.dateEndorsed);
    if(k&&(!minDate||k<minDate))minDate=k;
    if(k&&(!maxDate||k>maxDate))maxDate=k;
  }
  return {rows:r.length,statusCounts,pending:statusCounts.PENDING||0,restored:statusCounts.RESTORED||0,minEndorsedDate:minDate,maxEndorsedDate:maxDate};
}

module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  state.attempts++;
  state.lastAutoRecovery=new Date().toISOString();

  const diagnostics=credentialDiagnostics();
  if(!diagnostics.configured){
    state.lastError=diagnostics.error;
    state.lastReport={
      syncState:'AUTH_REQUIRED',
      sourceMode:'published-csv-readonly',
      message:'Direct Google Sheets API is not configured. Published data may be stale and is not treated as authoritative.'
    };
    return res.status(200).json({
      ok:true,
      agent:'noc-ai-style-sync-agent',
      configured:false,
      healthy:false,
      diagnostics,
      state,
      recovery:['configure GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 in Vercel','retry direct Sheets API','reject stale published data as authoritative']
    });
  }

  try{
    const v=await version();
    const dbSource=await source(process.env.GOOGLE_SHEET_GID_DATABASE||'946404240','db');
    const napSource=await source(process.env.GOOGLE_SHEET_GID_NAP_DOWN||'1995500191','nap');
    const built=build(dbSource,napSource,v,'google-sheets-api-agent');
    const dbSummary=summarizeRows(built.rows||[]);
    const napRows=built.napDownRows||[];
    const napPending=napRows.filter(x=>String(x.finalStatus||'').trim().toUpperCase()==='PENDING').length;
    const report={
      syncState:'SYNCED',
      sourceMode:'google-sheets-api',
      version:v,
      database:dbSummary,
      napDown:{
        rows:napRows.length,
        pending:napPending,
        headerRow:built.diagnostics?.napHeaderRow||null
      },
      reconciliation:built.reconciliation||null,
      checkedAt:new Date().toISOString()
    };
    state.lastError=null;
    state.lastSync=report.checkedAt;
    state.lastReport=report;
    return res.status(200).json({
      ok:true,
      agent:'noc-ai-style-sync-agent',
      configured:true,
      healthy:true,
      diagnostics:{...diagnostics,googleSheetsApi:'reachable'},
      state,
      report,
      recovery:['direct Google Sheets read','header validation','status-count validation','NAP DOWN reconciliation','surface mismatch instead of guessing']
    });
  }catch(e){
    const raw=String(e?.message||e||'Unknown Google Sheets API error');
    const lower=raw.toLowerCase();
    const errorCode=/permission|forbidden|does not have permission|caller does not have permission/.test(lower)
      ? 'SHEET_ACCESS_DENIED'
      : /not found|requested entity was not found/.test(lower)
      ? 'SHEET_NOT_FOUND'
      : /api .*not enabled|has not been used|disabled/.test(lower)
      ? 'SHEETS_API_DISABLED'
      : /invalid_grant|unauthenticated|invalid authentication|invalid credential/.test(lower)
      ? 'GOOGLE_AUTH_FAILED'
      : /quota|rate.?limit|too many requests/.test(lower)
      ? 'GOOGLE_QUOTA'
      : 'GOOGLE_API_ERROR';
    state.lastError=raw;
    state.lastReport={
      syncState:'SOURCE_ERROR',
      message:raw,
      errorCode,
      checkedAt:new Date().toISOString()
    };
    return res.status(200).json({
      ok:true,
      agent:'noc-ai-style-sync-agent',
      configured:true,
      healthy:false,
      diagnostics:{...diagnostics,googleSheetsApi:'unreachable',apiError:raw,errorCode},
      state,
      recoverable:true,
      recovery:['retry direct Google Sheets API','verify spreadsheet sharing for the service account','verify Google Sheets API is enabled in the service-account project','do not promote published fallback to authoritative live source','surface the exact source error in dashboard']
    });
  }
};