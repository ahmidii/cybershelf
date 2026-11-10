'use client';
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { mountModal } from '@/lib/modal-stack';
const ParentModal = createContext<string|null>(null);
export function Modal({title,subtitle,children,onClose,wide=false}:{title:string;subtitle?:string;children:React.ReactNode;onClose:()=>void;wide?:boolean}){
 const ref=useRef<HTMLDivElement>(null), backdrop=useRef<HTMLDivElement>(null), id=useId(), closeRef=useRef(onClose), parentId=useContext(ParentModal);
 const [portal,setPortal]=useState<HTMLElement|null>(null);
 closeRef.current=onClose;
 useEffect(()=>{setPortal(document.body);},[]);
 useLayoutEffect(()=>{
  if(!portal||!ref.current||!backdrop.current)return;
  return mountModal({id,parentId,dialog:ref.current,backdrop:backdrop.current,close:()=>closeRef.current()});
 },[portal,id,parentId]);
 if(!portal)return null;
 return createPortal(<ParentModal.Provider value={id}><div ref={backdrop} className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={ref} className={'modal '+(wide?'modal-wide':'')} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}><header className="modal-heading"><div><p className="eyebrow">make room</p><h2 id={id}>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20}/></button></header>{children}</div></div></ParentModal.Provider>,portal);
}
export function Empty({title,children,icon}:{title:string;children:React.ReactNode;icon?:React.ReactNode}){return <div className="empty-state">{icon&&<div className="empty-icon">{icon}</div>}<h2>{title}</h2><div>{children}</div></div>;}
