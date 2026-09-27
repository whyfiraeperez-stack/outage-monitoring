import {NextResponse} from 'next/server';
import {apiConfigured,getSourceTab,getSourceVersion,sourceConfig} from '../../../lib/google';
import {buildSnapshot} from '../../../lib/noc';
export const dynamic='force-dynamic'; export const revalidate=0;
let cache={version:null,snapshot:null};
export async function GET(){try{const c=sourceConfig();const version=await getSourceVersion();if(cache.snapshot&&cache.version===version)return NextResponse.json(cache.snapshot,{headers:{'Cache-Control':'no-store'}});const [db,nap]=await Promise.all([getSourceTab(c.dbGid),getSourceTab(c.napGid)]);const s=buildSnapshot(db,nap,version,apiConfigured()?'google-sheets-api':'published-csv-fallback');cache={version,snapshot:s};return NextResponse.json(s,{headers:{'Cache-Control':'no-store'}})}catch(e){return NextResponse.json({ok:false,error:e.message},{status:500})}}