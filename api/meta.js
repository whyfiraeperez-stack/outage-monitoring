const {version,configured,credentialDiagnostics,sample,tabs}=require('../lib/server.cjs');
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  try{
    const diag=credentialDiagnostics();
    if(!diag.configured){
      return res.status(200).json({ok:true,version:'credential-error',sourceMode:'unavailable',agent:{configured:false,runtimeSelfHeal:true},diagnostics:diag,recoverable:false});
    }
    let v='diagnostic';
    let sheet={};
    try{v=await version();const db=await sample(process.env.GOOGLE_SHEET_GID_DATABASE||'946404240');sheet={title:db.properties?.title,rowCount:Number(db.properties?.gridProperties?.rowCount||0),columnCount:Number(db.properties?.gridProperties?.columnCount||0),sampleRows:(db.values||[]).length}}
    catch(e){return res.status(200).json({ok:true,version:'source-error',sourceMode:'google-sheets-api-error',agent:{configured:true,runtimeSelfHeal:true},diagnostics:{...diag,apiError:String(e?.message||e)},recoverable:true})}
    return res.status(200).json({ok:true,version:v,sourceMode:'google-sheets-api',agent:{configured:true,runtimeSelfHeal:true},diagnostics:{...diag,sheet},recoverable:true});
  }catch(e){
    return res.status(200).json({ok:true,version:'meta-error',sourceMode:'unavailable',agent:{configured:false,runtimeSelfHeal:true},diagnostics:{error:String(e?.message||e)},recoverable:true});
  }
};