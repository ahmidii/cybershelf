'use client';
import { useEffect,useRef,useState } from 'react';
import { Book,BookSource,SourceKind,ReadingStatus,assetUrl,safeExternalUrl,uid } from '@/lib/types';
import { Modal } from './Dialogs';
import BookCover from './BookCover';
import { ArrowUpRight,BookOpen,MapPin,Download,Plus,Trash2,Star,Check,ExternalLink,Link2,LockKeyhole,ChevronDown,Ruler,LoaderCircle,RotateCcw,Upload,PenLine } from 'lucide-react';
import { BOOK_FORMATS,DIMENSION_LIMITS,bookDimensions,normalizeBookISBN,type EditionAppearance } from '@/lib/book-size';
import type { Asset,BookFormat } from '@/lib/types';
import { ACCOUNT_ID_HEADER } from '@/lib/auth-contract';
import appearanceStyles from './BookAppearance.module.css';

function validSpineImage(value:string){
 if(!value||/^\/api\/assets\/[A-Za-z0-9_-]{1,100}$/.test(value)||/^\/api\/(?:publications|profiles|journal)\/[A-Za-z0-9_-]{1,100}\/assets\/[A-Za-z0-9_-]{1,100}$/.test(value))return true;
 const safe=safeExternalUrl(value);if(!safe)return false;
 const url=new URL(safe);return !url.username&&!url.password;
}

function BookAppearance({book,onChange,accountId}:{book:Book;onChange:(book:Book)=>void;accountId:string|null}){
 const current=useRef(book);current.current=book;
 const size=bookDimensions(book);
 const [draft,setDraft]=useState({heightMm:String(size.heightMm/10),widthMm:String(size.widthMm/10),thicknessMm:String(size.thicknessMm/10)});
 const [spine,setSpine]=useState(book.spineUrl??''),[busy,setBusy]=useState(false),[note,setNote]=useState(''),[error,setError]=useState('');
 const [uploading,setUploading]=useState(false);
 useEffect(()=>setDraft({heightMm:String(size.heightMm/10),widthMm:String(size.widthMm/10),thicknessMm:String(size.thicknessMm/10)}),[size.heightMm,size.widthMm,size.thicknessMm]);
 useEffect(()=>setSpine(book.spineUrl??''),[book.spineUrl]);
 const change=(patch:Partial<Book>)=>onChange({...current.current,...patch});
 const saveDimension=(key:'heightMm'|'widthMm'|'thicknessMm')=>{
  const value=Number(draft[key])*10,limit=DIMENSION_LIMITS[key];
  if(!draft[key].trim()||!Number.isFinite(value)||value<limit.min||value>limit.max){
   setError(`Use a value between ${limit.min/10} and ${limit.max/10} cm.`);setDraft(previous=>({...previous,[key]:String(bookDimensions(current.current)[key]/10)}));return;
  }
  setError('');
  const prior=bookDimensions(current.current);
  if(Math.abs(prior[key]-value)<.05)return;
  change({dimensions:{...prior,[key]:Math.round(value*10)/10,source:'manual'}});
 };
 const lookup=async()=>{
  const isbn=normalizeBookISBN(current.current.isbn);if(!isbn)return;
  setBusy(true);setError('');setNote('');
  try{
   const response=await fetch('/api/book-details?isbn='+encodeURIComponent(isbn),{signal:AbortSignal.timeout(5500)});
   const data=await response.json() as {edition?:EditionAppearance|null;error?:string};
   if(!response.ok)throw new Error(data.error||'Edition details are unavailable. Your current size is kept.');
   if(normalizeBookISBN(current.current.isbn)!==isbn)return;
   const edition=data.edition;
   if(!edition){setNote('No matching edition was found. The estimated size still works on your shelf.');return;}
   const hasManualSize=current.current.dimensions?.source==='manual';
   change({...(edition.pages?{pages:edition.pages}:{}),...(edition.format?{format:edition.format}:{}),...(!hasManualSize&&edition.dimensions?{dimensions:edition.dimensions}:{}),...(!current.current.coverUrl&&edition.coverUrl?{coverUrl:edition.coverUrl}:{})});
   setNote(hasManualSize?'Edition details checked. Your custom measurements were kept.':edition.dimensions?.source==='catalog'?'Measurements found for this ISBN.':edition.dimensions?'Size estimated from this edition’s catalog description.':'Edition details checked. A complete measured size is unavailable, so the shelf uses an estimate.');
  }catch(e){setError(e instanceof Error&&e.name==='TimeoutError'?'The catalog is taking longer than usual. Your current size is kept.':e instanceof Error?e.message:'Could not check this edition. Your current size is kept.');}
  finally{setBusy(false);}
 };
 const sourceLabel=size.source==='manual'?'Custom size':size.source==='catalog'?'Catalog measurements':'Estimated size';
 const uploadSpine=async(file:File|undefined)=>{
  if(!file||uploading)return;
  if(!accountId){setError('Sign in to save a spine image.');return;}
  if(!file.size||file.size>4*1024*1024){setError('Choose a PNG, JPEG, or WebP image up to 4 MB.');return;}
  const targetBook=book.id;setUploading(true);setError('');setNote('');
  try{
   const body=new FormData();body.append('file',file);body.append('kind','image');
   const response=await fetch('/api/assets',{method:'POST',headers:{[ACCOUNT_ID_HEADER]:accountId},body,signal:AbortSignal.timeout(30000)});
   const data=await response.json() as Asset&{error?:string};
   if(!response.ok)throw new Error(data.error||'Could not save this spine image.');
   if(current.current.id!==targetBook)return;
   change({spineUrl:assetUrl(data.id)});setNote('Spine image saved. It stays private until you share a shelf, profile, or reading update that uses it.');
  }catch(error){setError(error instanceof Error?error.message:'Could not save this image.');}
  finally{setUploading(false);}
 };
 return <details className={appearanceStyles.appearance}>
  <summary><Ruler size={19}/><span><strong>Book appearance</strong><small>{(size.heightMm/10).toFixed(1)} × {(size.widthMm/10).toFixed(1)} × {(size.thicknessMm/10).toFixed(1)} cm · {sourceLabel}</small></span><ChevronDown size={17}/></summary>
  <div className={appearanceStyles.body}>
   <p className={appearanceStyles.hint}>Your book gets a size automatically. Fine-tune it here if you know your edition’s measurements.</p>
   <div className="form-grid">
    <label className="field">Format<select value={book.format??'paperback'} onChange={e=>change({format:e.target.value as BookFormat,dimensions:undefined})}>{BOOK_FORMATS.map(format=><option key={format.id} value={format.id}>{format.name}</option>)}</select></label>
    <label className="field">Pages<input key={book.pages??'no-pages'} type="number" min="0" max="100000" step="1" defaultValue={book.pages??''} placeholder="Optional" onBlur={e=>{const raw=e.target.value.trim(),pages=Number(raw);if(!raw){change({pages:undefined,...(current.current.dimensions?.source==='estimated'?{dimensions:undefined}:{})});setError('');}else if(Number.isInteger(pages)&&pages>=0&&pages<=100000){if(pages!==current.current.pages)change({pages,...(current.current.dimensions?.source==='estimated'?{dimensions:undefined}:{})});setError('');}else{setError('Page count must be a whole number between 0 and 100,000.');e.target.value=String(current.current.pages??'');}}}/></label>
   </div>
   <div className={appearanceStyles.measurements}>
    {([['heightMm','Height'],['widthMm','Cover width'],['thicknessMm','Spine thickness']] as const).map(([key,label])=><label className="field" key={key}>{label}<span className={appearanceStyles.inputUnit}><input type="number" inputMode="decimal" step="0.1" min={DIMENSION_LIMITS[key].min/10} max={DIMENSION_LIMITS[key].max/10} value={draft[key]} onChange={e=>setDraft(previous=>({...previous,[key]:e.target.value}))} onBlur={()=>saveDimension(key)}/><span>cm</span></span></label>)}
   </div>
   <div className={appearanceStyles.actions}>
    <button type="button" className="text-button" onClick={()=>{change({dimensions:undefined});setError('');setNote('Using a size estimate based on format and page count.');}}><RotateCcw size={14}/>Use automatic size</button>
    {normalizeBookISBN(book.isbn)&&<button type="button" className="button secondary small" disabled={busy} onClick={()=>void lookup()}>{busy?<LoaderCircle size={14} className="spin"/>:<SearchEditionIcon/>}{busy?'Checking edition…':'Check this ISBN'}</button>}
   </div>
   <p className={appearanceStyles.hint}>{size.source==='catalog'?'The catalog provides all three labelled measurements for this ISBN. Check them against your copy for precise planning.':size.source==='manual'?'Your custom size is used on every shelf.':'An approximation for arranging books. Editions and paper thickness vary; this is not a measurement of your copy.'}</p>
   <div className={appearanceStyles.spineUpload}>{accountId?<label className={`button secondary ${uploading?'disabled':''}`}>{uploading?<LoaderCircle size={14} className="spin"/>:<Upload size={14}/>} {uploading?'Saving spine…':'Upload a spine image'}<input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" disabled={uploading} onChange={event=>{void uploadSpine(event.target.files?.[0]);event.target.value='';}}/></label>:<p>Sign in to upload a spine image, or add an image link below.</p>}{book.spineUrl&&<button type="button" className="text-button" disabled={uploading} onClick={()=>{change({spineUrl:undefined});setSpine('');setError('');}}>Use a generated spine</button>}</div>
   <label className="field">Spine image URL <span className="optional">optional · PNG, JPEG, or WebP</span><input type="text" maxLength={2048} value={spine} disabled={uploading} placeholder="https://…" onChange={e=>setSpine(e.target.value)} onBlur={()=>{const value=spine.trim();if(validSpineImage(value)){change({spineUrl:value||undefined});setError('');}else{setError('Use a complete http:// or https:// image URL without sign-in details.');setSpine(current.current.spineUrl??'');}}}/></label>
   <p className={appearanceStyles.hint}>Without a spine image, cybershelf makes a typographic spine from the title, author, and your chosen color. Use a tightly cropped spine image to match your copy.</p>
   {note&&<p className="notice" role="status">{note}</p>}{error&&<p className="notice error" role="alert">{error}</p>}
  </div>
 </details>;
}
function SearchEditionIcon(){return <BookOpen size={14}/>;}

const statuses:{id:ReadingStatus;label:string}[]=[{id:'unread',label:'To read'},{id:'reading',label:'Reading'},{id:'read',label:'Finished'},{id:'paused',label:'Paused'},{id:'dnf',label:'Did not finish'}];
export default function BookDetails({book,onChange,onClose,onPlace,onDelete,accountId=null,onLogReading}:{book:Book;onChange:(book:Book)=>void;onClose:()=>void;onPlace:()=>void;onDelete:()=>void;accountId?:string|null;onLogReading?:()=>void}){
 const [tab,setTab]=useState<'grab'|'journal'|'details'>('grab'),[adding,setAdding]=useState(false),[kind,setKind]=useState<SourceKind>('platform'),[label,setLabel]=useState(''),[url,setUrl]=useState(''),[location,setLocation]=useState(''),[error,setError]=useState(''),[remove,setRemove]=useState(false),[titleDraft,setTitleDraft]=useState(book.title),[coverDraft,setCoverDraft]=useState(book.coverUrl);
 const change=(patch:Partial<Book>)=>onChange({...book,...patch});
 const addSource=(e:React.FormEvent)=>{e.preventDefault();if(kind!=='physical'&&!safeExternalUrl(url)){setError('Enter a full https:// or http:// address.');return;}const source:BookSource={id:uid('src_'),kind,label:label.trim()||(kind==='physical'?'Physical copy':'Reading link'),...(kind==='physical'?{location:location.trim()}:{url:safeExternalUrl(url)!})};change({sources:[...book.sources,source]});setAdding(false);setLabel('');setUrl('');setLocation('');setError('');};
 return <Modal title={book.title} subtitle={book.author} onClose={onClose} wide><div className="book-detail-intro"><BookCover book={book}/><div className="book-detail-meta"><span className="tag">in your library</span><h3>A story, within reach.</h3><label className="field">Reading status<select value={book.status} onChange={e=>{const status=e.target.value as ReadingStatus;change({status,...(status==='read'?{progress:100,finishedAt:new Date().toISOString().slice(0,10)}:{})});}}>{statuses.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label><button className="button secondary" onClick={onPlace}><Plus size={16}/>Place on a shelf</button></div></div><div className="dialog-tabs" role="tablist" aria-label="Book information">{([['grab','Grab this book'],['journal','Your journal'],['details','Book details']] as const).map(([id,title])=><button role="tab" aria-selected={tab===id} key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{title}</button>)}</div><div className="dialog-body">
 {tab==='grab'&&<><p className="section-note">Your saved places to find this book.</p><div className="sources">{book.sources.map(source=><div className="source-row" key={source.id}><span className="source-icon">{source.kind==='file'?<BookOpen size={20}/>:source.kind==='physical'?<MapPin size={20}/>:<ExternalLink size={20}/>}</span><div><strong>{source.label}</strong><p>{source.kind==='physical'?source.location:source.kind==='file'?source.filename:source.url?new URL(source.url).hostname:'Saved reading source'}</p></div>{source.kind==='file'&&source.assetId?<a className="button secondary" href={assetUrl(source.assetId)} download={source.filename}><Download size={15}/>Download</a>:source.url?<a className="button secondary" href={safeExternalUrl(source.url)||'#'} target="_blank" rel="noreferrer">Open <ArrowUpRight size={15}/></a>:null}<button className="icon-button subtle" aria-label={'Remove source '+source.label} onClick={()=>change({sources:book.sources.filter(s=>s.id!==source.id)})}><Trash2 size={15}/></button></div>)}</div>{book.sources.length===0&&<div className="soft-empty"><Link2 size={26} strokeWidth={1.2}/><h3>Where would you find it?</h3><p>Save a reading-app link, a library link, or the spot where your physical copy lives.</p></div>}{!adding?<button className="button secondary" onClick={()=>setAdding(true)}><Plus size={16}/>Add a source</button>:<form className="source-form" onSubmit={addSource}><div className="form-grid"><label className="field">Source type<select value={kind} onChange={e=>setKind(e.target.value as SourceKind)}><option value="platform">Reading platform</option><option value="physical">Physical location</option><option value="link">Library or other link</option></select></label><label className="field">Label<input required maxLength={100} value={label} placeholder={kind==='physical'?'Living room shelf':'Kindle, Kobo, Libby…'} onChange={e=>setLabel(e.target.value)}/></label>{kind==='physical'?<label className="field span-2">Where is it?<input required maxLength={300} value={location} onChange={e=>setLocation(e.target.value)} placeholder="Living room → middle shelf → left side"/></label>:<label className="field span-2">Link<input required type="url" maxLength={2048} value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://…"/></label>}</div>{error&&<p className="notice error">{error}</p>}<div className="button-row"><button className="button primary">Save source</button><button type="button" className="button quiet" onClick={()=>setAdding(false)}>Cancel</button></div></form>}<p className="privacy-note"><LockKeyhole size={13}/>Sources, locations, and files are always private.</p></>}
 {tab==='journal'&&<>{onLogReading&&<div className={appearanceStyles.journalCallout}><button type="button" className="button primary" onClick={onLogReading}><PenLine size={16}/>Log a reading update</button><p className="fine-print">Keep thoughts attached to the page or percentage where you had them. Share individual updates from your journal.</p></div>}<div className="form-grid"><label className="field">Reading progress <span className="optional">{book.progress}%</span><input type="range" min="0" max="100" value={book.progress} onChange={e=>change({progress:Number(e.target.value)})}/></label><label className="field">Date finished<input type="date" value={book.finishedAt?.slice(0,10)||''} onChange={e=>change({finishedAt:e.target.value||undefined})}/></label></div><div className="field"><span>Your rating</span><div className="rating-control" role="group" aria-label="Book rating">{[1,2,3,4,5].map(n=><button className="star-button" key={n} aria-label={`Rate ${n} ${n===1?'star':'stars'}`} aria-pressed={book.rating===n} onClick={()=>change({rating:book.rating===n?null:n})}><Star size={27} fill={(book.rating||0)>=n?'currentColor':'none'}/></button>)}<span>{book.rating?book.rating+' / 5':'Unrated'}</span></div></div><label className="field">Your review<textarea value={book.review} maxLength={10000} rows={5} onChange={e=>change({review:e.target.value})} placeholder="What stayed with you?"/></label><label className="field">Private notes<textarea value={book.notes} maxLength={10000} rows={3} onChange={e=>change({notes:e.target.value})} placeholder="A passage to return to, a thought to keep…"/></label><p className="privacy-note"><LockKeyhole size={13}/>These notes and reviews stay private. Only reading updates you explicitly share appear on your public profile.</p></>}
 {tab==='details'&&<><div className="form-grid"><label className="field span-2">Title<input value={titleDraft} maxLength={300} onChange={e=>setTitleDraft(e.target.value)} onBlur={()=>{const value=titleDraft.trim()||book.title;setTitleDraft(value);change({title:value});}}/></label><label className="field span-2">Author<input value={book.author} maxLength={200} onChange={e=>change({author:e.target.value})}/></label><label className="field">ISBN<input value={book.isbn||''} maxLength={30} onChange={e=>change({isbn:e.target.value,...(book.dimensions?.source!=='manual'?{dimensions:undefined}:{})})}/></label><label className="field">Spine color<input type="color" value={book.color} onChange={e=>change({color:e.target.value})}/></label><label className="field span-2">Cover image URL<input type="text" value={coverDraft} maxLength={2048} onChange={e=>setCoverDraft(e.target.value)} onBlur={()=>{if(!coverDraft||safeExternalUrl(coverDraft)||coverDraft===book.coverUrl){change({coverUrl:coverDraft});setError('');}else{setError('Enter a complete http:// or https:// cover image URL.');setCoverDraft(book.coverUrl);}}} placeholder="https://…"/></label></div><BookAppearance book={book} onChange={onChange} accountId={accountId}/>{error&&<p className="notice error" role="alert">{error}</p>}<div className="danger-zone">{remove?<><p>Remove this book from your library and every shelf? This cannot be undone.</p><button className="button danger" onClick={onDelete}>Remove book</button><button className="button quiet" onClick={()=>setRemove(false)}>Keep it</button></>:<button className="text-button danger-text" onClick={()=>setRemove(true)}><Trash2 size={14}/>Remove from library</button>}</div></>}
 <div className="dialog-footer"><p><Check size={13}/>Changes save automatically</p><button className="button secondary" onClick={onClose}>Done</button></div></div></Modal>;
}
