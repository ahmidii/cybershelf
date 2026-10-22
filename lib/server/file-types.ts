export function detectedFileType(bytes:Uint8Array):{kind:'book'|'image';mime:string;extension:string}|null {
  const start=new TextDecoder('latin1').decode(bytes.subarray(0,1024));
  if(bytes.length>=8 && bytes[0]===137 && start.slice(1,4)==='PNG' && bytes[4]===13 && bytes[5]===10 && bytes[6]===26 && bytes[7]===10)return {kind:'image',mime:'image/png',extension:'png'};
  if(bytes.length>=4 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255)return {kind:'image',mime:'image/jpeg',extension:'jpg'};
  if(bytes.length>=12 && start.startsWith('RIFF') && start.slice(8,12)==='WEBP')return {kind:'image',mime:'image/webp',extension:'webp'};
  if(start.startsWith('%PDF-'))return {kind:'book',mime:'application/pdf',extension:'pdf'};
  // EPUB requires its first ZIP member to be the uncompressed mimetype entry.
  if(bytes.length>=58 && bytes[0]===80 && bytes[1]===75 && bytes[2]===3 && bytes[3]===4){
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const nameLength=view.getUint16(26,true),extraLength=view.getUint16(28,true),compression=view.getUint16(8,true);
    const name=new TextDecoder().decode(bytes.subarray(30,30+nameLength));const payload=30+nameLength+extraLength;
    if(name==='mimetype' && compression===0 && new TextDecoder().decode(bytes.subarray(payload,payload+20))==='application/epub+zip')return {kind:'book',mime:'application/epub+zip',extension:'epub'};
  }
  return null;
}
