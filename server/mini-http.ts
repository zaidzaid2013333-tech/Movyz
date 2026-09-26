export type QueryParams = Record<string, string | string[] | undefined>;

export interface HttpRequest {
  method: string;
  url: string;
  headers: Headers;
  body: any;
  params: Record<string,string>;
  query: QueryParams;
  userId?: string;
  role?: 'USER'|'ADMIN'|'OWNER';
  supabase?: any;
  header(name: string): string | undefined;
}

export interface HttpResponse {
  statusCode: number;
  headers: Headers;
  status(code: number): this;
  setHeader(name: string, value: string): this;
  json(data: unknown): Response;
  send(data?: unknown): Response;
}

export type NextFunction = (error?: unknown) => void;
export type RequestHandler = (req: HttpRequest, res: HttpResponse, next: NextFunction) => unknown;

function matchRoute(pattern:string, pathname:string){
  const a=pattern.split('/').filter(Boolean), b=pathname.split('/').filter(Boolean);
  if(a.length!==b.length) return null;
  const params:Record<string,string>={};
  for(let i=0;i<a.length;i++){
    if(a[i].startsWith(':')) params[a[i].slice(1)]=decodeURIComponent(b[i]);
    else if(a[i]!==b[i]) return null;
  }
  return params;
}

class MiniResponse implements HttpResponse {
  statusCode=200;
  headers=new Headers();
  status(code:number){this.statusCode=code;return this;}
  setHeader(name:string,value:string){this.headers.set(name,value);return this;}
  json(data:unknown){
    this.headers.set('content-type','application/json; charset=utf-8');
    return new Response(JSON.stringify(data),{status:this.statusCode,headers:this.headers});
  }
  send(data?:unknown){
    if(data===undefined) return new Response(null,{status:this.statusCode,headers:this.headers});
    if(typeof data==='string') return new Response(data,{status:this.statusCode,headers:this.headers});
    this.headers.set('content-type','application/json; charset=utf-8');
    return new Response(JSON.stringify(data),{status:this.statusCode,headers:this.headers});
  }
}

type Route={method:string;pattern:string;handlers:RequestHandler[]};
type ErrorHandler=(err:unknown,req:HttpRequest,res:HttpResponse,next:NextFunction)=>unknown;

export class MiniApp {
  private middleware:RequestHandler[]=[];
  private routes:Route[]=[];
  private errorHandler:ErrorHandler|null=null;

  disable(_name:string){return this;}
  use(handler:RequestHandler|ErrorHandler){
    if(handler.length===4) this.errorHandler=handler as ErrorHandler;
    else this.middleware.push(handler as RequestHandler);
    return this;
  }
  get(pattern:string,...handlers:RequestHandler[]){this.routes.push({method:'GET',pattern,handlers});return this;}
  post(pattern:string,...handlers:RequestHandler[]){this.routes.push({method:'POST',pattern,handlers});return this;}
  put(pattern:string,...handlers:RequestHandler[]){this.routes.push({method:'PUT',pattern,handlers});return this;}
  patch(pattern:string,...handlers:RequestHandler[]){this.routes.push({method:'PATCH',pattern,handlers});return this;}
  delete(pattern:string,...handlers:RequestHandler[]){this.routes.push({method:'DELETE',pattern,handlers});return this;}

  async handle(request:Request):Promise<Response>{
    const url=new URL(request.url);
    const req:HttpRequest={
      method:request.method,url:request.url,headers:request.headers,body:{},params:{},
      query:Object.fromEntries(url.searchParams.entries()),
      header:(name:string)=>request.headers.get(name)||undefined,
    };
    if(['POST','PUT','PATCH','DELETE'].includes(request.method)){
      const ct=request.headers.get('content-type')||'';
      if(ct.toLowerCase().includes('application/json')){
        try{req.body=await request.json();}
        catch{return new Response(JSON.stringify({success:false,error:{code:'INVALID_JSON',message:'Request body must be valid JSON'}}),{status:400,headers:{'content-type':'application/json; charset=utf-8'}});}
      }
    }

    const route=this.routes.find(r=>r.method===request.method && matchRoute(r.pattern,url.pathname));
    if(route) req.params=matchRoute(route.pattern,url.pathname)!;
    const chain:RequestHandler[]=[...this.middleware,...(route?.handlers||[])];
    const res=new MiniResponse();
    let response:Response|undefined;

    const dispatch=async(index:number,error?:unknown):Promise<void>=>{
      if(error!==undefined){
        if(this.errorHandler){
          try{
            const out=await this.errorHandler(error,req,res,()=>{});
            if(out instanceof Response) response=out;
          }catch{
            response=new Response(JSON.stringify({success:false,error:{code:'INTERNAL_ERROR',message:'Internal server error'}}),{status:500,headers:{'content-type':'application/json; charset=utf-8'}});
          }
        } else {
          response=new Response(JSON.stringify({success:false,error:{code:'INTERNAL_ERROR',message:'Internal server error'}}),{status:500,headers:{'content-type':'application/json; charset=utf-8'}});
        }
        return;
      }

      const fn=chain[index];
      if(!fn){
        if(!route){
          response=new Response(JSON.stringify({success:false,error:{code:'NOT_FOUND',message:'Route not found'}}),{status:404,headers:{'content-type':'application/json; charset=utf-8'}});
        } else if(!response) {
          response=new Response(null,{status:204});
        }
        return;
      }

      let nextPromise:Promise<void>|undefined;
      const next:NextFunction=(nextError)=>{nextPromise=dispatch(index+1,nextError);};
      try{
        const out=await fn(req,res,next);
        if(out instanceof Response) response=out;
        if(nextPromise) await nextPromise;
      }catch(e){
        await dispatch(index+1,e);
      }
    };

    await dispatch(0);
    return response || new Response(null,{status:204});
  }
}
