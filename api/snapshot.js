const {source,configured,version}=require('../lib/server.cjs');const {build}=require('../lib/noc.cjs');let cache={v:null,s:null};
module.exports=async(req,res)=>{
 try{
  res.setHeader('Cache-Control','no-store');
  const v=await version();
  if(cache.v===v&&cache.s)return res.status(200).json(cache.s);
  const db=await source(process.env.GOOGLE_SHEET_GID_DATABASE||'946404240','db');
  if(!db.values||db.values.length<2)throw new Error('DATABASE feed returned no data rows. Configure Google Sheets API or verify the published DATABASE tab.');
  let nap=null,napError='';
  try{nap=await source(process.env.GOOGLE_SHEET_GID_NAP_DOWN||'1995500191','nap')}catch(e){napError=e.message}
  const s=build(db,nap,v,configured()?'google-sheets-api':'published-csv-fallback');
  s.diagnostics={databaseRows:Math.max(0,(db.values||[]).length-1),napSourceRows:Math.max(0,(nap?.values||[]).length-1),napError,configured:configured(),publicationConfigured:Boolean(process.env.GOOGLE_PUBLISHED_ID)};
  cache={v,s};
  res.status(200).json(s);
 }catch(e){res.status(503).json({ok:false,error:e.message,code:'SOURCE_UNAVAILABLE'})}
}