import type { AppState, Book, Shelf, ShelfItem } from './types';

const date = '2026-01-01T00:00:00.000Z';

/** An explicitly labelled sample catalog. No book is marked as owned. */
export function createDemoState(): AppState {
  const titles: [string, string, string][] = [
    ['The Creative Act', 'Rick Rubin', '#c5a56c'],
    ['A Psalm for the Wild-Built', 'Becky Chambers', '#788468'],
    ['The Book of Tea', 'Kakuzō Okakura', '#46737a'],
    ['The Little Prince', 'Antoine de Saint-Exupéry', '#b86f50'],
    ['The Summer Book', 'Tove Jansson', '#9baeb0'],
    ['The Comfort Book', 'Matt Haig', '#c9b99b'],
    ["A Room of One’s Own", 'Virginia Woolf', '#83585e'],
    ['The Art of Noticing', 'Rob Walker', '#7a866d'],
    ['Piranesi', 'Susanna Clarke', '#414e55'],
    ['The Hobbit', 'J. R. R. Tolkien', '#536b5e'],
    ['Dune', 'Frank Herbert', '#c18a4e'],
    ['A Wizard of Earthsea', 'Ursula K. Le Guin', '#a85c48'],
    ['Pride and Prejudice', 'Jane Austen', '#a9b6a1'],
    ['Before the Coffee Gets Cold', 'Toshikazu Kawaguchi', '#b8a087'],
    ['The House in the Cerulean Sea', 'TJ Klune', '#527f96'],
    ['Invisible Cities', 'Italo Calvino', '#b7a365'],
  ];
  // Illustrative proportions for the sample room, not verified editions.
  const sizes: [number, number, number][] = [
    [232, 156, 31], [205, 132, 18], [178, 112, 13], [195, 140, 14],
    [198, 129, 17], [210, 142, 26], [181, 111, 13], [218, 146, 23],
    [216, 138, 22], [198, 129, 24], [234, 153, 42], [198, 128, 19],
    [198, 129, 27], [201, 132, 20], [228, 152, 30], [181, 112, 16],
  ];
  const books: Book[] = titles.map(([title, author, color], index) => ({
    id: `demo_book_${index + 1}`, title, author, color, coverUrl: '',
    dimensions: { heightMm: sizes[index][0], widthMm: sizes[index][1], thicknessMm: sizes[index][2], source: 'estimated' },
    status: index === 0 || index === 8 ? 'reading' : index === 3 || index === 4 || index === 12 ? 'read' : 'unread',
    progress: index === 0 ? 42 : index === 8 ? 18 : index === 3 || index === 4 || index === 12 ? 100 : 0,
    rating: index === 4 ? 4.5 : null,
    review: index === 4 ? 'Example review: a little book that makes ordinary summer days feel worth keeping.' : '',
    notes: '', addedAt: date, ...(index === 3 || index === 4 || index === 12 ? { finishedAt: date } : {}), sources: [],
  }));
  const book = (shelf: string, index: number, slot: number, facing: ShelfItem['facing'] = 'auto'): ShelfItem => ({
    id: `demo_${shelf}_${index}`, kind: 'book', bookId: `demo_book_${index}`, slot, pinned: false, facing,
  });
  const decor = (shelf: string, kind: ShelfItem['decor'], slot: number): ShelfItem => ({
    id: `demo_${shelf}_${kind}`, kind: 'decor', decor: kind, slot, pinned: false, facing: 'auto',
  });
  const shelves: Shelf[] = [{
    id: 'demo_shelf_quiet', title: 'Quiet company', description: 'For slow mornings, softer days, and a little room to think.',
    bookcase: 'open', layout: 'balanced', finish: 'paper', updatedAt: date,
    items: [
      decor('quiet', 'plant', 0), book('quiet', 1, 2, 'cover'), book('quiet', 2, 3), book('quiet', 3, 4), decor('quiet', 'bookend', 6),
      book('quiet', 4, 8, 'stack'), book('quiet', 5, 9, 'stack'), book('quiet', 6, 10, 'stack'), {...book('quiet', 7, 11),lean:'left'}, decor('quiet', 'vase', 14),
      book('quiet', 8, 16), book('quiet', 13, 17), book('quiet', 14, 18), decor('quiet', 'bear', 21),
    ],
  }, {
    id: 'demo_shelf_worlds', title: 'Worlds to get lost in', description: 'Strange doors. Unfamiliar stars. One more chapter.',
    bookcase: 'cubby', layout: 'balanced', finish: 'moss', updatedAt: date,
    items: [
      book('worlds', 9, 0, 'cover'), book('worlds', 10, 1), decor('worlds', 'plant', 4), book('worlds', 11, 5),
      book('worlds', 12, 6), book('worlds', 15, 7, 'cover'), decor('worlds', 'robot', 10),
      book('worlds', 16, 12), book('worlds', 2, 13), book('worlds', 4, 15), decor('worlds', 'bookend', 17),
    ],
  }];
  return { schemaVersion: 1, profile: { name: 'The reading room', bio: 'A sample shelf to make yourself at home in.',featuredShelfId:'demo_shelf_quiet' }, books, shelves };
}
