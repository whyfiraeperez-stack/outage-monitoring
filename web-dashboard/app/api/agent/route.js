import {NextResponse} from 'next/server';
import {apiConfigured} from '../../../lib/google';
import {auditFormulas,repairMissingFormulas,getAgentPublicStatus} from '../../../lib/agent';
export const dynamic='force-dynamic'; export const revalidate=0;
function allowed(req){return Boolean(process.env.NOC_AGENT_TOKEN)&&req.headers.get('x-noc-agent-token')===process.env.NOC_AGENT_TOKEN}
export async function GET(){return NextResponse.json(getAgentPublicStatus(),{headers:{'Cache-Control':'no-store'}})}
export async function POST(req){try{if(!apiConfigured())return NextResponse.json({ok:false,error:'Google Sheets API is required for formula audit/repair.'},{status:503});if(!allowed(req))return NextResponse.json({ok:false,error:'Invalid NOC_AGENT_TOKEN'},{status:401});const body=await req.json().catch(()=>({}));if(body.action==='audit')return NextResponse.json(await auditFormulas());if(body.action==='repair')return NextResponse.json(await repairMissingFormulas());return NextResponse.json({ok:false,error:'Use action=audit or action=repair'},{status:400})}catch(e){return NextResponse.json({ok:false,error:e.message},{status:500})}}