'use client';
import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
export function Modal({title,subtitle,children,onClose,wide=false}:{title:string;subtitle?:string;children:React.ReactNode;onClose:()=>void;wide?:boolean}){
 const ref=useRef<HTMLDivElement>(null), id=useId(), closeRef=useRef(onClose);
 closeRef.current=onClose;
 useEffect(()=>{
  const prior=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const before=document.body.style.overflow;
  document.body.style.overflow='hidden';
  if(!ref.current?.contains(document.activeElement))ref.current?.focus();
  const key=(e:KeyboardEvent)=>{
   if(e.key==='Escape'){e.preventDefault();closeRef.current();return;}
   if(e.key!=='Tab')return;
   const list=Array.from(ref.current?.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]')||[]).filter(node=>node.tabIndex>=0&&!node.matches(':disabled')&&node.getClientRects().length>0);
   if(!list.length){e.preventDefault();ref.current?.focus();return;}
   const first=list[0],last=list[list.length-1],active=document.activeElement;
   if(e.shiftKey&&(active===first||active===ref.current||!ref.current?.contains(active))){e.preventDefault();last.focus();}
   else if(!e.shiftKey&&(active===last||active===ref.current||!ref.current?.contains(active))){e.preventDefault();first.focus();}
  };
  document.addEventListener('keydown',key);
  return()=>{document.body.style.overflow=before;document.removeEventListener('keydown',key);if(prior?.isConnected&&!ref.current?.contains(prior))prior.focus({preventScroll:true});};
 },[]);
 return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={ref} className={'modal '+(wide?'modal-wide':'')} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}><header className="modal-heading"><div><p className="eyebrow">make room</p><h2 id={id}>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20}/></button></header>{children}</div></div>;
}
export function Empty({title,children,icon}:{title:string;children:React.ReactNode;icon?:React.ReactNode}){return <div className="empty-state">{icon&&<div className="empty-icon">{icon}</div>}<h2>{title}</h2><div>{children}</div></div>;}
