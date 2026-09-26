import type {NextFunction,HttpRequest,HttpResponse} from './mini-http';
import {createUserClient} from './supabase';

export interface AuthenticatedRequest extends HttpRequest { userId?:string; role?:'USER'|'ADMIN'|'OWNER'; supabase?:ReturnType<typeof createUserClient>; }

export async function requireAuth(req:AuthenticatedRequest,res:HttpResponse,next:NextFunction){
  try{
    const h=req.header('authorization');
    if(!h?.startsWith('Bearer ')) return res.status(401).json({success:false,error:{code:'UNAUTHENTICATED',message:'Authentication required'}});
    const client=createUserClient(h.slice(7).trim());
    const {data:{user},error}=await client.auth.getUser();
    if(error||!user) return res.status(401).json({success:false,error:{code:'INVALID_SESSION',message:'Invalid or expired session'}});
    const {data:profile}=await client.from('profiles').select('id,role').eq('id',user.id).single();
    if(!profile) return res.status(403).json({success:false,error:{code:'PROFILE_NOT_FOUND',message:'Profile not initialized'}});
    req.userId=user.id; req.role=profile.role; req.supabase=client; next();
  }catch(e){next(e)}
}
export function requireAdmin(req:AuthenticatedRequest,res:Response,next:NextFunction){
  if(req.role!=='ADMIN'&&req.role!=='OWNER') return res.status(403).json({success:false,error:{code:'FORBIDDEN',message:'Admin permission required'}});
  next();
}

export function requireOwner(req:AuthenticatedRequest,res:Response,next:NextFunction){
  if(req.role!=='OWNER') return res.status(403).json({success:false,error:{code:'OWNER_ONLY',message:'Owner permission required'}});
  next();
}
