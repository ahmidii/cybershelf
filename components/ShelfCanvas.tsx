'use client';

import { useMemo, useState, type CSSProperties, type DragEvent } from 'react';
import { shelfGrid, assetUrl, type Book, type PublicBook, type Shelf, type ShelfItem } from '../lib/types';
import DecorArt from './DecorArt';
import styles from './ShelfCanvas.module.css';

export interface ShelfCanvasProps {
  shelf: Shelf;
  books: (Book | PublicBook)[];
  editing?: boolean;
  selectedId?: string | null;
  onSelect?: (itemId: string) => void;
  onMove?: (itemId: string, slot: number | null) => void;
  onBookOpen?: (bookId: string) => void;
  compact?: boolean;
}

const decorNames = {plant:'A little greenery',bear:'Well-read teddy',robot:'Little robot',vase:'Ceramic vase',bookend:'The // bookend',image:'Your decoration'};
const hash = (value:string) => Array.from(value).reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,7);
function inkFor(color:string) {
  if(!/^#[0-9a-f]{6}$/i.test(color))return '#fff9ec';
  const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
  return rgb[0]*.299+rgb[1]*.587+rgb[2]*.114>164?'#342f27':'#fff9ec';
}
function orientation(item:ShelfItem,shelf:Shelf,book:Book|PublicBook) {
  if(item.facing!=='auto')return item.facing;
  if(shelf.layout==='gallery')return 'cover';
  if(shelf.layout==='stacks')return 'stack';
  return hash(book.id)%5===0?'cover':'spine';
}

function BookObject({book,item,shelf}:{book:Book|PublicBook;item:ShelfItem;shelf:Shelf}) {
  const [failed,setFailed]=useState(false);
  const seed=hash(book.id);
  const facing=orientation(item,shelf,book);
  const custom={
    '--book-color':book.color||'#78836b',
    '--book-ink':inkFor(book.color),
    '--book-height':`${77+seed%21}%`,
    '--spine-width':`${32+seed%12}px`,
    '--book-angle':`${seed%7===0?-4:seed%11===0?3:0}deg`,
  } as CSSProperties;
  return <span className={`${styles.book} ${styles[facing]} ${styles[`pattern${seed%4}`]}`} style={custom}>
    <span className={styles.coverArt}>
      <span className={styles.coverTop}>{seed%2===0?'A BOOK TO KEEP':'ON THE SHELF'}</span>
      <span className={styles.coverTitle}>{book.title}</span>
      <span className={styles.coverMotif} aria-hidden="true">{seed%3===0?'✳':seed%3===1?'//':'◯'}</span>
      <span className={styles.coverAuthor}>{book.author}</span>
    </span>
    {facing==='cover'&&book.coverUrl&&!failed?<img className={styles.coverImage} src={book.coverUrl} alt="" loading="lazy" draggable={false} onError={()=>setFailed(true)} />:null}
    <span className={styles.spineText}><span>{book.title}</span><small>{book.author}</small></span>
    <span className={styles.publisherMark} aria-hidden="true">//</span>
    <span className={styles.pageEdge} />
  </span>;
}

export default function ShelfCanvas({shelf,books,editing=false,selectedId=null,onSelect,onMove,onBookOpen,compact=false}:ShelfCanvasProps) {
  const grid=shelfGrid(shelf);
  const [dragId,setDragId]=useState<string|null>(null);
  const [overSlot,setOverSlot]=useState<number|null>(null);
  const bookMap=useMemo(()=>new Map(books.map(book=>[book.id,book])),[books]);
  const bySlot=useMemo(()=>new Map(shelf.items.filter(item=>item.slot!==null).map(item=>[item.slot!,item])),[shelf.items]);
  const selected=shelf.items.find(item=>item.id===selectedId);
  const canPlace=editing&&!!selected&&!selected.pinned;
  const validDrop=(event:DragEvent,slot:number) => {
    event.preventDefault();
    const id=event.dataTransfer.getData('application/x-cybershelf-item')||event.dataTransfer.getData('text/plain');
    const source=shelf.items.find(item=>item.id===id);
    const target=bySlot.get(slot);
    if(editing&&source&&!source.pinned&&!target?.pinned&&source.slot!==slot)onMove?.(id,slot);
    setDragId(null);setOverSlot(null);
  };
  return <div className={`${styles.canvas} ${styles[shelf.finish]} ${styles[shelf.bookcase]} ${shelf.layout==='gallery'?styles.gallery:''} ${editing?styles.editing:''} ${compact?styles.compact:''}`} style={{'--columns':grid.columns,'--rows':grid.rows} as CSSProperties} aria-label={`${shelf.title} bookshelf`}>
    <div className={styles.case}>
      {Array.from({length:grid.rows},(_,row)=><div className={styles.row} key={row}>
        <div className={styles.slots}>
          {Array.from({length:grid.columns},(_,column)=>{
            const slot=row*grid.columns+column;
            const item=bySlot.get(slot);
            const book=item?.kind==='book'?bookMap.get(item.bookId!):undefined;
            const label=book?`${book.title}, by ${book.author}`:item?(item.label||decorNames[item.decor||'image']):`Empty space, row ${row+1}, position ${column+1}`;
            const isSelected=!!item&&item.id===selectedId;
            const isDivider=shelf.bookcase==='cubby'&&column>0&&column%(grid.columns===3?1:2)===0;
            const eventProps={
              onDragOver:(event:DragEvent)=>{if(editing&&dragId&&!item?.pinned){event.preventDefault();event.dataTransfer.dropEffect='move';setOverSlot(slot);}},
              onDragLeave:()=>{if(overSlot===slot)setOverSlot(null);},
              onDrop:(event:DragEvent)=>validDrop(event,slot),
            };
            return <div {...eventProps} className={`${styles.slot} ${isDivider?styles.divider:''} ${overSlot===slot?styles.over:''}`} key={slot}>
              {item?<button type="button" className={`${styles.item} ${isSelected?styles.selected:''} ${dragId===item.id?styles.dragging:''} ${item.kind==='decor'?styles.decoration:''}`} disabled={compact||(!editing&&!book)} draggable={editing&&!item.pinned} onDragStart={event=>{
                if(!editing||item.pinned){event.preventDefault();return;}
                event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-cybershelf-item',item.id);event.dataTransfer.setData('text/plain',item.id);setDragId(item.id);onSelect?.(item.id);
              }} onDragEnd={()=>{setDragId(null);setOverSlot(null);}} onClick={()=>{if(editing)onSelect?.(item.id);else if(book)onBookOpen?.(book.id);}} aria-label={`${label}${item.pinned?', pinned':''}${editing?', select to arrange':''}`} aria-pressed={editing?isSelected:undefined} title={label}>
                {book?<BookObject book={book} item={item} shelf={shelf}/>:item.kind==='decor'?(item.decor==='image'?
                  <img className={styles.customDecor} src={item.imageUrl||(item.assetId?assetUrl(item.assetId):'')} alt="" draggable={false}/>
                  :<DecorArt kind={item.decor||'bookend'} className={styles.decorArt}/>):<span className={styles.missing}>Book unavailable</span>}
                {editing&&item.pinned?<span className={styles.pin} aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M6 2h4l-.5 4L12 9H4l2.5-3zM8 9v5"/></svg></span>:null}
                {editing&&isSelected?<span className={styles.selectionDot} aria-hidden="true"/>:null}
              </button>:editing?<button type="button" className={`${styles.empty} ${canPlace?styles.placeable:''}`} onClick={()=>{if(canPlace)onMove?.(selected!.id,slot);}} aria-label={canPlace?`Move selected item to row ${row+1}, position ${column+1}`:label} disabled={!canPlace}>
                <span aria-hidden="true">{canPlace?'+':'·'}</span>
              </button>:<span className={styles.air} aria-hidden="true"/>}
            </div>;
          })}
        </div>
        <div className={styles.plank} aria-hidden="true"/>
      </div>)}
    </div>
    <div className={styles.feet} aria-hidden="true"><i/><i/></div>
  </div>;
}
