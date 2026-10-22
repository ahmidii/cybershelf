import { shelfGrid, type Book, type Shelf, type ShelfItem } from './types';

export type Arrangement = 'title' | 'author' | 'color';

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function colorKey(hex: string): [number, number, number] {
  const match = /^#([\da-f]{6})$/i.exec(hex);
  if (!match) return [2, 0, 0];
  const channels = [0, 2, 4].map(offset => parseInt(match[1].slice(offset, offset + 2), 16) / 255);
  const [r, g, b] = channels;
  const high = Math.max(...channels), low = Math.min(...channels), delta = high - low;
  const lightness = (high + low) / 2;
  if (delta < .08) return [1, 0, -lightness];
  let hue = high === r ? ((g - b) / delta) % 6 : high === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  return [0, hue, -lightness];
}

/** Reorders the occupied book positions, including each position's display
 * role. A stack therefore stays a stack even when its books are sorted. Gaps,
 * pinned books, decorations, and the tray keep their places. */
export function arrangeShelf(shelf: Shelf, books: Book[], mode: Arrangement): Shelf {
  const lookup = new Map(books.map(book => [book.id, book]));
  const movable = shelf.items.filter(item => item.kind === 'book' && !item.pinned && item.slot !== null && lookup.has(item.bookId ?? ''));
  const ordered = [...movable].sort((a, b) => {
    const left = lookup.get(a.bookId!)!, right = lookup.get(b.bookId!)!;
    if (mode === 'color') {
      const l = colorKey(left.color), r = colorKey(right.color);
      for (let n = 0; n < l.length; n++) if (Math.abs(l[n] - r[n]) > .00001) return l[n] - r[n];
    }
    if (mode === 'author') {
      const authorOrder = collator.compare(left.author, right.author);
      if (authorOrder) return authorOrder;
    }
    return collator.compare(left.title, right.title) || (a.slot! - b.slot!);
  });
  if(!shelf.items.some(item=>item.placement)){
    const slots=movable.map(item=>item.slot!).sort((a,b)=>a-b);
    const assignment=new Map(ordered.map((item,index)=>[item.id,slots[index]]));
    return {...shelf,items:shelf.items.map(item=>assignment.has(item.id)?{...item,slot:assignment.get(item.id)!}:{...item})};
  }
  const grid=shelfGrid(shelf),byId=new Map(shelf.items.map(item=>[item.id,item]));
  const position=(item:ShelfItem)=>item.placement??{row:Math.floor(item.slot!/grid.columns),x:(item.slot!%grid.columns+.5)/grid.columns};
  const depth=(item:ShelfItem)=>{
    let n=0,current:ShelfItem|undefined=item;const seen=new Set<string>();
    while(current?.placement?.supportId&&!seen.has(current.id)){
      seen.add(current.id);current=byId.get(current.placement.supportId);n++;
    }
    return n;
  };
  const roles=[...movable].sort((a,b)=>position(a).row-position(b).row||position(a).x-position(b).x||depth(a)-depth(b)||a.slot!-b.slot!);
  const assignment=new Map(ordered.map((item,index)=>[item.id,roles[index]]));
  const occupants=new Map(roles.map((role,index)=>[role.id,ordered[index].id]));
  return {...shelf,items:shelf.items.map(item=>{
    const role=assignment.get(item.id);
    const result:ShelfItem=role?{...item,slot:role.slot,facing:role.facing,placement:{...position(role)}}:{...item,...(item.placement?{placement:{...item.placement}}:{})};
    if(role){if(role.lean===undefined)delete result.lean;else result.lean=role.lean;}
    if(result.placement?.supportId)result.placement.supportId=occupants.get(result.placement.supportId)??result.placement.supportId;
    return result;
  })};
}
