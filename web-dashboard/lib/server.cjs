const {google}=require('googleapis');

const CFG={
  sheetId:process.env.GOOGLE_SHEET_ID||'1yhtm8pTJ9VP0TUrFm2JedYoCZ_M22K196luw3u9Xl4s',
  dbGid:process.env.GOOGLE_SHEET_GID_DATABASE||'946404240',
  napGid:process.env.GOOGLE_SHEET_GID_NAP_DOWN||'1995500191',
  publishedId:process.env.GOOGLE_PUBLISHED_ID||'2PACX-1vSKPMOn6CXZN3xn1zyKGcDyayAHLMuntjJ137x5dWxZzoJstX3Ef_XTtAgh6zId4n1gEyQBeL91lHFi'
};

const configured=()=>Boolean(String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64||'').trim());

function parseServiceAccount(){
  const raw=String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64||'').trim();
  if(!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not configured');

  // Accept either:
  // 1) the recommended base64-encoded JSON, or
  // 2) the raw JSON pasted into the Vercel environment variable.
  // This makes the deployment tolerant of either Vercel input format.
  let text=raw;
  let parsed=null;

  try {
    parsed=JSON.parse(text);
    if(typeof parsed==='string'){
      parsed=JSON.parse(parsed);
    }
  } catch (_) {
    parsed=null;
  }

  if(!parsed || typeof parsed!=='object' || !parsed.client_email || !parsed.private_key){
    try{
      const normalized=raw.replace(/\s+/g,'');
      text=Buffer.from(normalized,'base64').toString('utf8').trim();
      parsed=JSON.parse(text);
      if(typeof parsed==='string') parsed=JSON.parse(parsed);
    }catch(e){
      throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: provide either raw service-account JSON or base64-encoded JSON.');
    }
  }

  if(!parsed || parsed.type!=='service_account' || !parsed.client_email || !parsed.private_key){
    throw new Error('Google service-account JSON is missing required fields: type, client_email, private_key.');
  }

  return parsed;
}

function auth(){
  const credentials=parseServiceAccount();
  return new google.auth.GoogleAuth({
    credentials,
    scopes:[
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly'
    ]
  });
}

async function clients(){
  const a=auth();
  return{
    sheets:google.sheets({version:'v4',auth:a}),
    drive:google.drive({version:'v3',auth:a})
  };
}

function col(n){
  let s='';
  while(n>0){
    const r=(n-1)%26;
    s=String.fromCharCode(65+r)+s;
    n=Math.floor((n-1)/26);
  }
  return s;
}

async function tabs(){
  const {sheets}=await clients();
  const r=await sheets.spreadsheets.get({
    spreadsheetId:CFG.sheetId,
    includeGridData:false,
    fields:'sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))'
  });
  return r.data.sheets||[];
}

async function tab(gid){
  const t=(await tabs()).find(x=>String(x.properties.sheetId)===String(gid));
  if(!t) throw new Error('Sheet GID '+gid+' not found');
  return t.properties;
}

async function values(gid,render='FORMATTED_VALUE'){
  const t=await tab(gid);
  const {sheets}=await clients();
  const rows=Number(t.gridProperties?.rowCount||1000);
  const cols=Math.min(Number(t.gridProperties?.columnCount||40),100);
  const range="'"+String(t.title).replace(/'/g,"''")+"'!A1:"+col(cols)+rows;

  const r=await sheets.spreadsheets.values.get({
    spreadsheetId:CFG.sheetId,
    range,
    majorDimension:'ROWS',
    valueRenderOption:render,
    dateTimeRenderOption:'FORMATTED_STRING'
  });

  return{properties:t,values:r.data.values||[]};
}

function csv(text){
  const out=[];let row=[],cell='',q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i],n=text[i+1];
    if(c==='"'&&q&&n==='"'){cell+='"';i++;continue}
    if(c==='"'){q=!q;continue}
    if(c===','&&!q){row.push(cell);cell='';continue}
    if((c==='\\n'||c==='\\r')&&!q){
      if(c==='\\r'&&n==='\\n')i++;
      row.push(cell);cell='';
      if(row.some(v=>String(v).trim()!==''))out.push(row);
      row=[];continue;
    }
    cell+=c;
  }
  if(cell!==''||row.length){
    row.push(cell);
    if(row.some(v=>String(v).trim()!==''))out.push(row);
  }
  return out;
}

function good(rows,expected=[]){
  if(!rows?.length)return false;
  const h=(rows[0]||[]).map(v=>String(v||'').trim().toUpperCase());
  return expected.every(x=>h.includes(x.toUpperCase()));
}

async function published(gid,kind){
  const candidates=kind==='db'
    ?[
      'https://docs.google.com/spreadsheets/d/e/'+CFG.publishedId+'/pub?output=csv&cachebust='+Date.now(),
      'https://docs.google.com/spreadsheets/d/e/'+CFG.publishedId+'/pub?gid='+gid+'&single=true&output=csv&cachebust='+Date.now(),
      'https://docs.google.com/spreadsheets/d/e/'+CFG.publishedId+'/gviz/tq?tqx=out:csv&gid='+gid+'&cachebust='+Date.now()
    ]
    :[
      'https://docs.google.com/spreadsheets/d/e/'+CFG.publishedId+'/pub?gid='+gid+'&single=true&output=csv&cachebust='+Date.now(),
      'https://docs.google.com/spreadsheets/d/e/'+CFG.publishedId+'/gviz/tq?tqx=out:csv&gid='+gid+'&cachebust='+Date.now()
    ];
  const expected=kind==='db'?['TIMESTAMP','FINAL STATUS','PROVINCE']:['PROVINCE','MUNICIPALITY'];
  let last='';

  for(const u of candidates){
    try{
      const r=await fetch(u,{cache:'no-store',headers:{'Cache-Control':'no-cache','Pragma':'no-cache','User-Agent':'NAP-NOC/3.0'}});
      if(!r.ok){last='HTTP '+r.status;continue}
      const t=await r.text();
      if(/<html|<!doctype/i.test(t)){last='HTML response';continue}
      const rows=csv(t);
      if(good(rows,expected))return{properties:{sheetId:Number(gid),title:kind==='db'?'PUBLISHED DATABASE':'PUBLISHED NAP DOWN'},values:rows};
      last='Unexpected headers';
    }catch(e){last=e.message}
  }

  throw new Error('Published '+kind+' feed unavailable: '+last);
}

async function source(gid,kind){
  return configured()?values(gid):published(gid,kind);
}

async function version(){
  if(configured()){
    const {drive}=await clients();
    const r=await drive.files.get({fileId:CFG.sheetId,fields:'modifiedTime'});
    return String(r.data.modifiedTime||Date.now());
  }
  return 'published-'+Math.floor(Date.now()/10000);
}

module.exports={CFG,configured,parseServiceAccount,clients,tabs,tab,values,source,version};
