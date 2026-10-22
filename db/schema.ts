import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

// A profile is independently published: selecting a favourite shelf never
// creates an Explore entry or exposes the rest of a reader's Library.
export const publicProfiles = sqliteTable('public_profiles', {
  id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),shelfId:text('shelf_id').notNull(),
  snapshot:text('snapshot').notNull(),imageIds:text('image_ids').notNull(),
  publishedAt:text('published_at').notNull(),updatedAt:text('updated_at').notNull(),
},table=>[uniqueIndex('public_profiles_owner_idx').on(table.ownerId)]);

export const readingPosts=sqliteTable('reading_posts',{
  id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),profileId:text('profile_id').notNull(),
  bookId:text('book_id').notNull(),entryId:text('entry_id').notNull(),snapshot:text('snapshot').notNull(),
  imageIds:text('image_ids').notNull(),publishedAt:text('published_at').notNull(),updatedAt:text('updated_at').notNull(),
  bookKey:text('book_key').notNull().default(''),
  catalogId:text('catalog_id'),
},table=>[uniqueIndex('reading_posts_owner_entry_idx').on(table.ownerId,table.entryId),index('reading_posts_profile_date_idx').on(table.profileId,table.publishedAt),index('reading_posts_book_owner_date_idx').on(table.bookKey,table.ownerId,table.publishedAt,table.id),index('reading_posts_catalog_owner_idx').on(table.catalogId,table.ownerId)]);
export const readingComments=sqliteTable('reading_comments',{
  id:text('id').primaryKey(),postId:text('post_id').notNull().references(()=>readingPosts.id,{onDelete:'cascade'}),
  ownerId:text('owner_id').notNull(),profileId:text('profile_id'),name:text('name').notNull(),body:text('body').notNull(),
  progress:real('progress').notNull(),createdAt:text('created_at').notNull(),
},table=>[index('reading_comments_post_date_idx').on(table.postId,table.createdAt),index('reading_comments_owner_date_idx').on(table.ownerId,table.createdAt)]);
export const readingEvents=sqliteTable('reading_events',{
  id:text('id').primaryKey(),ownerId:text('owner_id').notNull(),kind:text('kind').notNull(),createdAt:text('created_at').notNull(),
},table=>[index('reading_events_owner_kind_date_idx').on(table.ownerId,table.kind,table.createdAt)]);

// Better Auth owns these tables. Application ownership remains keyed by the
// stable user.id from a verified, database-backed session.
export const user = sqliteTable('auth_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

export const session = sqliteTable('auth_session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
}, (table) => [index('auth_session_user_idx').on(table.userId)]);

export const account = sqliteTable('auth_account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [index('auth_account_user_idx').on(table.userId)]);

export const verification = sqliteTable('auth_verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [index('auth_verification_identifier_idx').on(table.identifier)]);

export const rateLimit = sqliteTable('auth_rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: integer('last_request').notNull(),
});

// Follow an account's public identity without exposing its authentication ID.
// Keeping the last public identifier permits unfollowing an unpublished reader.
export const follows = sqliteTable('follows', {
  followerId: text('follower_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  followedOwnerId: text('followed_owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  followedProfileId: text('followed_profile_id').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [primaryKey({ columns: [table.followerId, table.followedOwnerId] }), index('follows_followed_idx').on(table.followedOwnerId)]);

// Only explicit purchase/library announcements enter this table. Ordinary
// catalog writes and imports never create social activity.
export const readerActivity = sqliteTable('reader_activity', {
  id: text('id').primaryKey(), ownerId: text('owner_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  profileId: text('profile_id').notNull(), kind: text('kind', { enum: ['purchased', 'added'] }).notNull(),
  bookId: text('book_id').notNull(), snapshot: text('snapshot').notNull(), createdAt: text('created_at').notNull(),
}, table => [index('reader_activity_owner_date_idx').on(table.ownerId, table.createdAt), index('reader_activity_profile_date_idx').on(table.profileId, table.createdAt)]);

// An explicit manual catalog publication contains only bibliographic text.
// Private files, covers, journals and account identifiers never enter it.
export const communityBooks=sqliteTable('community_books',{
  id:text('id').primaryKey(),title:text('title').notNull(),author:text('author').notNull(),createdAt:text('created_at').notNull(),
});
export const bookRatings=sqliteTable('book_ratings',{
  ownerId:text('owner_id').notNull().references(()=>user.id,{onDelete:'cascade'}),catalogId:text('catalog_id').notNull(),
  rating:real('rating').notNull(),createdAt:text('created_at').notNull(),updatedAt:text('updated_at').notNull(),
},table=>[primaryKey({columns:[table.ownerId,table.catalogId]}),index('book_ratings_catalog_idx').on(table.catalogId)]);
export const bookReads=sqliteTable('book_reads',{
  ownerId:text('owner_id').notNull().references(()=>user.id,{onDelete:'cascade'}),id:text('id').notNull(),catalogId:text('catalog_id').notNull(),
  finishedAt:text('finished_at').notNull(),createdAt:text('created_at').notNull(),
},table=>[primaryKey({columns:[table.ownerId,table.id]}),uniqueIndex('book_reads_owner_catalog_date_idx').on(table.ownerId,table.catalogId,table.finishedAt),index('book_reads_catalog_owner_idx').on(table.catalogId,table.ownerId)]);
