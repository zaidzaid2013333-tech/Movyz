import type {NextFunction,Request,Response} from 'express';
export const asyncRoute=(fn:(req:Request,res:Response,next:NextFunction)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>Promise.resolve(fn(req,res,next)).catch(next);
export const ok=(res:Response,data:unknown,meta?:unknown)=>res.status(200).json({success:true,data,...(meta?{meta}:{})});
export const created=(res:Response,data:unknown)=>res.status(201).json({success:true,data});
export const fail=(res:Response,status:number,code:string,message:string)=>res.status(status).json({success:false,error:{code,message}});
