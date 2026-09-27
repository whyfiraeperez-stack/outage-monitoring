import {NextResponse} from 'next/server';
import {apiConfigured,getSourceVersion,sourceConfig,getTabByGid} from '../../../lib/google';
import {getAgentPublicStatus} from '../../../lib/agent';
export const dynamic='force-dynamic'; export const revalidate=0;
export async function GET(){try{const c=sourceConfig();const tab=await getTabByGid(c.dbGid).catch(()=>null);return NextResponse.json({ok:true,version:await getSourceVersion(),sourceMode:apiConfigured()?'google-sheets-api':'published-csv-fallback',rowCount:Number(tab?.gridProperties?.rowCount||0)-1,serverTime:new Date().toISOString(),agent:getAgentPublicStatus()},{headers:{'Cache-Control':'no-store'}})}catch(e){return NextResponse.json({ok:false,error:e.message},{status:500})}}