import type { Shelf, ShelfItem } from './types';

/** Keep the rest of a pile together when its bottom or a middle book leaves. */
export function withoutShelfItems(shelf: Shelf, ids: Iterable<string>, keepInTray = false): Shelf {
  const removed = new Set(ids), previous = new Map(shelf.items.map(item => [item.id, item]));
  return {
    ...shelf,
    items: shelf.items.flatMap<ShelfItem>(item => {
      if (removed.has(item.id)) return keepInTray ? [{ ...item, slot: null, placement: undefined, pinned: false }] : [];
      if (!item.placement?.supportId || !removed.has(item.placement.supportId)) return [item];
      let supportId: string | undefined = item.placement.supportId;
      const visited = new Set<string>([item.id]);
      while (supportId && removed.has(supportId) && !visited.has(supportId)) {
        visited.add(supportId);
        supportId = previous.get(supportId)?.placement?.supportId;
      }
      const support = supportId ? previous.get(supportId) : undefined;
      if (!support || removed.has(support.id) || visited.has(support.id) || support.slot === null || support.placement?.row !== item.placement.row) supportId = undefined;
      return [{ ...item, placement: { ...item.placement, supportId } }];
    }),
  };
}

/** A copied stack must point to the copied books, never to its source shelf. */
export function copyShelfItems(items: ShelfItem[], makeId: () => string): ShelfItem[] {
  const ids = new Map(items.map(item => [item.id, makeId()]));
  return items.map(item => ({
    ...item, id: ids.get(item.id)!, pinned: false,
    ...(item.placement ? { placement: { ...item.placement, supportId: item.placement.supportId ? ids.get(item.placement.supportId) : undefined } } : {}),
  }));
}
