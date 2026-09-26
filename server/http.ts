import type {NextFunction,HttpRequest,HttpResponse} from './mini-http';
export const asyncRoute=(fn:(req:HttpRequest,res:HttpResponse,next:NextFunction)=>Promise<unknown>)=>(req:HttpRequest,res:HttpResponse,next:NextFunction)=>Promise.resolve(fn(req,res,next)).catch(next);
export const ok=(res:HttpResponse,data:unknown,meta?:unknown)=>res.status(200).json({success:true,data,...(meta?{meta}:{})});
export const created=(res:Response,data:unknown)=>res.status(201).json({success:true,data});
export const fail=(res:Response,status:number,code:string,message:string)=>res.status(status).json({success:false,error:{code,message}});
