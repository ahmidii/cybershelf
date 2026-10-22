import { getChatGPTUser } from '../../app/chatgpt-auth';

export class HttpError extends Error { constructor(public status:number,message:string){super(message);} }
export function json(data:unknown,status=200,headers:Record<string,string>={}) {
  return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
}
export async function authenticated() {
  const user=await getChatGPTUser(); if(!user) throw new HttpError(401,'Sign in to save your library.'); return user;
}
export function sameOrigin(request:Request) {
  const origin=request.headers.get('origin');
  if(origin && origin!==new URL(request.url).origin) throw new HttpError(403,'This request must come from cybershelf.');
  if(request.headers.get('sec-fetch-site')==='cross-site') throw new HttpError(403,'This request must come from cybershelf.');
}
export function boundedStream(request:Request,max:number) {
  if(Number(request.headers.get('content-length')??0)>max)throw new HttpError(413,'This upload is too large.');
  if(!request.body)throw new HttpError(400,'Choose a file to upload.');
  const reader=request.body.getReader();let total=0;
  return new ReadableStream<Uint8Array>({
    async pull(controller){
      try{const {value,done}=await reader.read();if(done){controller.close();reader.releaseLock();return;}
        total+=value.byteLength;if(total>max){await reader.cancel();controller.error(new HttpError(413,'This upload is too large.'));return;}controller.enqueue(value);
      }catch(error){controller.error(error);}
    },
    async cancel(){await reader.cancel();},
  });
}
export async function readBounded(request:Request,max:number) {
  const len=Number(request.headers.get('content-length')??0);
  if(len>max) throw new HttpError(413,'This upload is too large.');
  if(!request.body) return new Uint8Array();
  const reader=request.body.getReader();const chunks:Uint8Array[]=[];let total=0;
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>max){await reader.cancel();throw new HttpError(413,'This upload is too large.');}chunks.push(value);}
  } finally {reader.releaseLock();}
  const out=new Uint8Array(total);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.byteLength;}return out;
}
export async function readJson(request:Request,max=2*1024*1024):Promise<unknown> {
  if(!request.headers.get('content-type')?.includes('application/json'))throw new HttpError(415,'Send JSON data.');
  const body=await readBounded(request,max);
  try{return JSON.parse(new TextDecoder().decode(body));}catch{throw new HttpError(400,'Invalid JSON data.');}
}
export async function handled(action:()=>Promise<Response>):Promise<Response> {
  try{return await action();}catch(error){
    if(error instanceof HttpError)return json({error:error.message},error.status);
    console.error('cybershelf API failure', error instanceof Error?error.message:'Unknown error');
    return json({error:'Something went wrong. Please try again.'},500);
  }
}
