import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const roadEvents = sqliteTable(
  'road_events',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    latitude: real('latitude').notNull(),
    longitude: real('longitude').notNull(),
    confidence: real('confidence').notNull().default(1),
    source: text('source').notNull().default('manual'),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_road_events_expires_at').on(table.expiresAt),
    index('idx_road_events_location').on(table.latitude, table.longitude),
  ],
);
