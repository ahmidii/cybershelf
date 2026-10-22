import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const libraries = sqliteTable('libraries', {
  ownerId: text('owner_id').primaryKey(),
  state: text('state').notNull(),
  version: integer('version').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
});

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), kind: text('kind').notNull(),
  objectKey: text('object_key').notNull(), filename: text('filename').notNull(),
  mime: text('mime').notNull(), size: integer('size').notNull(), createdAt: text('created_at').notNull(),
}, (table) => [index('assets_owner_idx').on(table.ownerId)]);

export const publications = sqliteTable('publications', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull(), shelfId: text('shelf_id').notNull(),
  snapshot: text('snapshot').notNull(), imageIds: text('image_ids').notNull(),
  publishedAt: text('published_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [uniqueIndex('publications_owner_shelf_idx').on(table.ownerId, table.shelfId), index('publications_latest_idx').on(table.updatedAt)]);
