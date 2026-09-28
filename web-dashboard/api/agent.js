const {configured,credentialDiagnostics,sample}=require('../lib/server.cjs');
let state={lastAutoRecovery:null,attempts:0,lastError:null};
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  state.attempts++;
  state.lastAutoRecovery=new Date().toISOString();
  const diagnostics=credentialDiagnostics();
  if(!diagnostics.configured){
    state.lastError=diagnostics.error;
    return res.status(200).json({ok:true,agent:'runtime-self-heal',configured:false,diagnostics,state});
  }
  try{
    const db=await sample(process.env.GOOGLE_SHEET_GID_DATABASE||'946404240');
    state.lastError=null;
    return res.status(200).json({
      ok:true,agent:'runtime-self-heal',configured:true,diagnostics:{
        ...diagnostics,
        googleSheetsApi:'reachable',
        sheetTitle:db.properties?.title||'',
        rowCount:Number(db.properties?.gridProperties?.rowCount||0),
        sampleRows:(db.values||[]).length
      },state,
      recovery:['retry source reads','chunk large sheet reads','detect real header rows','fallback to published feed','rebuild NAP DOWN from DATABASE PENDING','never rewrite raw spreadsheet data']
    });
  }catch(e){
    state.lastError=String(e?.message||e);
    return res.status(200).json({ok:true,agent:'runtime-self-heal',configured:true,diagnostics:{...diagnostics,googleSheetsApi:'unreachable',apiError:state.lastError},state,recoverable:true});
  }
};