const {source,configured,version,published}=require('../lib/server.cjs');
const {build}=require('../lib/noc.cjs');
let cache={v:null,s:null};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function retry(fn,tries=3){let last;for(let i=0;i<tries;i++){try{return await fn()}catch(e){last=e;if(i<tries-1)await sleep(350*(i+1))}}throw last}
async function load(gid,kind){
  const d=await retry(()=>source(gid,kind),3);
  return d;
}
module.exports=async(req,res)=>{
  try{
    res.setHeader('Cache-Control','no-store');
    const v=await retry(()=>version(),3);
    if(cache.v===v&&cache.s)return res.status(200).json(cache.s);
    let db=await load(process.env.GOOGLE_SHEET_GID_DATABASE||'946404240','db');
    if(!db?.values||db.values.length<2)throw new Error('DATABASE source returned no usable rows.');
    let nap=null,napError='';
    try{nap=await load(process.env.GOOGLE_SHEET_GID_NAP_DOWN||'1995500191','nap')}catch(e){napError=String(e?.message||e)}
    let s=build(db,nap,v,configured()?'google-sheets-api':'published-csv-fallback');

    // Self-heal parser/source mismatch: if the direct source produced zero parsed
    // records, retry against the published feed before returning an empty snapshot.
    if((s.rows||[]).length===0 && configured()){
      try{
        const dbFallback=await published(process.env.GOOGLE_SHEET_GID_DATABASE||'946404240','db');
        let napFallbackSource=null;
        try{napFallbackSource=await published(process.env.GOOGLE_SHEET_GID_NAP_DOWN||'1995500191','nap')}catch(_){}
        const recovered=build(dbFallback,napFallbackSource,v,'published-csv-recovery');
        if((recovered.rows||[]).length>0)s=recovered;
      }catch(_){}
    }

    s.diagnostics={
      ...(s.diagnostics||{}),
      databaseRows:Math.max(0,db.values.length-1),
      napSourceRows:Math.max(0,(nap?.values||[]).length-1),
      napError,
      configured:configured(),
      recovered:!!napError||!!s.napFallback||s.sourceMode==='published-csv-recovery',
      apiSource:Boolean(configured() && !db.recoveredFromApiError)
    };
    if((s.rows||[]).length===0)throw new Error('Dashboard source was reachable but no DATABASE records could be parsed. Self-heal exhausted.');
    cache={v,s};
    return res.status(200).json(s);
  }catch(e){
    return res.status(503).json({ok:false,error:String(e?.message||e),code:'SOURCE_UNAVAILABLE',recoverable:true,nextRetryMs:1500});
  }
};