import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    username: varchar('username', { length: 50 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    storageUsedBytes: bigint('storage_used_bytes', { mode: 'number' }).default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('users_username_unique').on(table.username)],
);

export const images = pgTable(
  'images',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    originalFilename: varchar('original_filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    extension: varchar('extension', { length: 10 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    checksum: varchar('checksum', { length: 64 }).notNull(),
    deletionState: varchar('deletion_state', { length: 16 }).default('active').notNull(),
    deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('images_storage_key_unique').on(table.storageKey),
    index('images_user_created_idx').on(table.userId, table.createdAt),
  ],
);

export const imageVariants = pgTable(
  'image_variants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    imageId: uuid('image_id')
      .notNull()
      .references(() => images.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    transformations: jsonb('transformations').notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    checksum: varchar('checksum', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('image_variants_storage_key_unique').on(table.storageKey),
    index('image_variants_image_created_idx').on(table.imageId, table.createdAt),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Image = typeof images.$inferSelect;
export type NewImage = typeof images.$inferInsert;
export type ImageVariant = typeof imageVariants.$inferSelect;
export type NewImageVariant = typeof imageVariants.$inferInsert;
