const {google}=require('googleapis');

const CFG={
  sheetId:process.env.GOOGLE_SHEET_ID||'1yhtm8pTJ9VP0TUrFm2JedYoCZ_M22K196luw3u9Xl4s',
  dbGid:process.env.GOOGLE_SHEET_GID_DATABASE||'946404240',
  napGid:process.env.GOOGLE_SHEET_GID_NAP_DOWN||'1995500191',
  publishedId:process.env.GOOGLE_PUBLISHED_ID||'2PACX-1vSKPMOn6CXZN3xn1zyKGcDyayAHLMuntjJ137x5dWxZzoJstX3Ef_XTtAgh6zId4n1gEyQBeL91lHFi'
};
const envText=n=>String(process.env[n]||'').trim();
function parseJsonCandidate(t){try{const o=JSON.parse(String(t||'').replace(/^\uFEFF/,'').trim());return typeof o==='string'?JSON.parse(o):o}catch(_){return null}}
function decodeBase64(raw){try{let s=String(raw||'').trim().replace(/^data:.*?;base64,/i,'').replace(/^base64:/i,'').replace(/[\r\n\t ]+/g,'').replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return parseJsonCandidate(Buffer.from(s,'base64').toString('utf8'))}catch(_){return null}}
function validServiceAccount(o){return !!(o&&typeof o.client_email==='string'&&o.client_email.includes('@')&&typeof o.private_key==='string'&&o.private_key.includes('PRIVATE KEY'))}
function parseServiceAccount(){
  const raw=envText('GOOGLE_SERVICE_ACCOUNT_JSON'),legacy=envText('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64');
  let o=parseJsonCandidate(raw);if(!validServiceAccount(o)&&raw)o=decodeBase64(raw);if(validServiceAccount(o))return o;
  o=parseJsonCandidate(legacy);if(!validServiceAccount(o)&&legacy)o=decodeBase64(legacy);if(validServiceAccount(o))return o;
  throw new Error(!raw&&!legacy?'Google service-account credential is missing.':'Invalid Google service-account credential. Use the complete JSON or UTF-8 base64 JSON.');
}
function configured(){try{parseServiceAccount();return true}catch(_){return false}}
function credentialDiagnostics(){
  const raw=envText('GOOGLE_SERVICE_ACCOUNT_JSON');
  const b64=envText('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64');
  const rawObj=parseJsonCandidate(raw);
  const b64Obj=decodeBase64(b64);
  const rawValid=validServiceAccount(rawObj);
  const b64Valid=validServiceAccount(b64Obj);
  if(rawValid)return{configured:true,source:'GOOGLE_SERVICE_ACCOUNT_JSON',rawPresent:true,base64Present:!!b64,rawValid:true,base64Valid:b64Valid,clientEmail:rawObj.client_email,projectId:rawObj.project_id||null};
  if(b64Valid)return{configured:true,source:'GOOGLE_SERVICE_ACCOUNT_JSON_BASE64',rawPresent:!!raw,base64Present:true,rawValid:false,base64Valid:true,clientEmail:b64Obj.client_email,projectId:b64Obj.project_id||null};
  return{
    configured:false,
    source:raw||b64?'INVALID_CREDENTIAL':'MISSING_CREDENTIAL',
    rawPresent:!!raw,
    base64Present:!!b64,
    rawValid:false,
    base64Valid:false,
    error:!raw&&!b64
      ?'No GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is available in this deployment.'
      :'A credential variable exists, but it is not valid service-account JSON/Base64 JSON.'
  };
}
function auth(){return new google.auth.GoogleAuth({credentials:parseServiceAccount(),scopes:['https://www.googleapis.com/auth/spreadsheets']})}
async function clients(){return{sheets:google.sheets({version:'v4',auth:auth()})}}
function col(n){let s='';while(n>0){const r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26)}return s}
async function tabs(){
  const {sheets}=await clients();
  const r=await sheets.spreadsheets.get({spreadsheetId:CFG.sheetId,includeGridData:false,fields:'spreadsheetId,sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))'});
  return r.data.sheets||[];
}
async function tab(gid){const t=(await tabs()).find(x=>String(x.properties.sheetId)===String(gid));if(!t)throw new Error('Sheet GID '+gid+' not found');return t.properties}
async function rangeValues(title,startRow,endRow,cols,render='FORMATTED_VALUE'){
  const {sheets}=await clients();
  const range="'"+String(title).replace(/'/g,"''")+"'!A"+startRow+":"+col(cols)+endRow;
  const r=await sheets.spreadsheets.values.get({spreadsheetId:CFG.sheetId,range,majorDimension:'ROWS',valueRenderOption:render,dateTimeRenderOption:'FORMATTED_STRING'});
  return r.data.values||[];
}
async function values(gid,render='FORMATTED_VALUE'){
  const t=await tab(gid);
  const rows=Math.max(1,Number(t.gridProperties?.rowCount||1000));
  const cols=Math.min(Math.max(1,Number(t.gridProperties?.columnCount||40)),52);
  // Read in chunks to avoid Vercel response/time/memory pressure on ~22k-row sheets.
  const chunk=4000,all=[];
  for(let start=1;start<=rows;start+=chunk){
    const part=await rangeValues(t.title,start,Math.min(rows,start+chunk-1),cols,render);
    for(const r of part)all.push(r);
    if(part.length===0&&start>chunk)break;
  }
  return{properties:t,values:all};
}
async function sample(gid){
  const t=await tab(gid);
  const rows=Math.min(40,Math.max(1,Number(t.gridProperties?.rowCount||40)));
  const cols=Math.min(Math.max(1,Number(t.gridProperties?.columnCount||40)),52);
  return{properties:t,values:await rangeValues(t.title,1,rows,cols,'FORMATTED_VALUE')};
}
async function version(){
  if(configured()){
    const {sheets}=await clients();
    const meta=await sheets.spreadsheets.get({
      spreadsheetId:CFG.sheetId,
      includeGridData:false,
      fields:'spreadsheetId,sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))'
    });
    const etag=meta.headers?.etag||meta.headers?.ETag;
    if(etag)return 'etag-'+String(etag);
    const s=await sample(CFG.dbGid);
    const rows=s.values||[];
    const head=JSON.stringify(rows.slice(0,12));
    const tail=JSON.stringify(rows.slice(Math.max(0,rows.length-3)));
    return 'sheet-'+Buffer.from(head+tail).toString('base64').slice(0,80);
  }
  return 'published-'+Math.floor(Date.now()/10000);
}
function csv(t){const o=[];let row=[],cell='',q=false;for(let i=0;i<t.length;i++){const c=t[i],n=t[i+1];if(c==='"'&&q&&n==='"'){cell+='"';i++;continue}if(c==='"'){q=!q;continue}if(c===','&&!q){row.push(cell);cell='';continue}if((c==='\n'||c==='\r')&&!q){if(c==='\r'&&n==='\n')i++;row.push(cell);cell='';if(row.some(v=>String(v).trim()!==''))o.push(row);row=[];continue}cell+=c}if(cell!==''||row.length){row.push(cell);if(row.some(v=>String(v).trim()!==''))o.push(row)}return o}
function good(rows,expected){if(!rows?.length)return false;const h=(rows[0]||[]).map(v=>String(v||'').trim().toUpperCase());return expected.every(x=>h.includes(x.toUpperCase()))}
async function published(gid,kind){
  const urls=kind==='db'
    ?['https://docs.google.com/spreadsheets/d/e/'+CFG.publishedId+'/pub?gid='+gid+'&single=true&output=csv&cachebust='+Date.now(),'https://docs.google.com/spreadsheets/d/e/'+CFG.publishedId+'/gviz/tq?tqx=out:csv&gid='+gid+'&cachebust='+Date.now(),'https://docs.google.com/spreadsheets/d/e/'+CFG.publishedId+'/pub?output=csv&cachebust='+Date.now()]
    :['https://docs.google.com/spreadsheets/d/e/'+CFG.publishedId+'/pub?gid='+gid+'&single=true&output=csv&cachebust='+Date.now(),'https://docs.google.com/spreadsheets/d/e/'+CFG.publishedId+'/gviz/tq?tqx=out:csv&gid='+gid+'&cachebust='+Date.now()];
  const expected=kind==='db'?['TIMESTAMP','PROVINCE']:['PROVINCE','MUNICIPALITY'];let last='';
  for(const u of urls)try{
    const r=await fetch(u,{cache:'no-store'});
    if(!r.ok){last='HTTP '+r.status;continue}
    const t=await r.text();if(/<html|<!doctype/i.test(t)){last='HTML response';continue}
    const rows=csv(t);if(good(rows,expected))return{properties:{sheetId:Number(gid),title:kind==='db'?'PUBLISHED DATABASE':'PUBLISHED NAP DOWN'},values:rows};
    last='Unexpected headers';
  }catch(e){last=e.message}
  throw new Error('Published '+kind+' feed unavailable: '+last);
}
async function source(gid,kind){
  if(configured()){
    const direct=await values(gid);
    if(!Array.isArray(direct.values)||direct.values.length<2){
      throw new Error('Google Sheets API returned no usable rows.');
    }
    direct.live=true;
    direct.sourceType='google-sheets-api';
    return direct;
  }
  const fallback=await published(gid,kind);
  fallback.live=false;
  fallback.sourceType='published-csv-readonly';
  return fallback;
}
module.exports={CFG,configured,credentialDiagnostics,parseServiceAccount,clients,tabs,tab,values,sample,published,source,version};