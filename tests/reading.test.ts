import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newBook } from '../lib/types';
import { readerPosition } from '../lib/reading';

test('spoiler progress matches normalized title and author, never a merely similar book', () => {
  const book = newBook(' A  Reading Life ', 'Author Name');
  book.progress = 38;
  assert.deepEqual(readerPosition({ ...book, title: 'a reading life', author: 'author name' }, [book]), { progress: 38, unread: false });
  assert.deepEqual(readerPosition({ ...book, author: 'Another author' }, [book]), { progress: 0, unread: true });
  assert.deepEqual(readerPosition({ ...book, title: 'A Reading Life 2' }, [book]), { progress: 0, unread: true });
});

test('finished editions unlock the same work; unknown and invalid progress stays protected', () => {
  const book = newBook('A book', 'A writer');
  assert.deepEqual(readerPosition(book, []), { progress: 0, unread: true });
  assert.deepEqual(readerPosition(book, [{ ...book, progress: Number.NaN }]), { progress: 0, unread: true });
  assert.deepEqual(readerPosition(book, [{ ...book, progress: 22 }, { ...book, id: 'second-edition', status: 'read' }]), { progress: 100, unread: false });
});
