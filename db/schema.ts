import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
};

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('idx_users_email').on(table.email)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'number' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    uniqueIndex('idx_sessions_token_hash').on(table.tokenHash),
    index('idx_sessions_user_id').on(table.userId),
    index('idx_sessions_expires_at').on(table.expiresAt),
  ],
);

export const recordings = sqliteTable(
  'recordings',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    clientRecordingId: text('client_recording_id').notNull(),
    durationMs: integer('duration_ms', { mode: 'number' }).notNull(),
    mimeType: text('mime_type').notNull(),
    byteLength: integer('byte_length', { mode: 'number' }).notNull(),
    capturedAt: integer('captured_at', { mode: 'number' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'number' }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('idx_recordings_user_client_id').on(table.userId, table.clientRecordingId),
    index('idx_recordings_user_created').on(table.userId, table.createdAt),
    index('idx_recordings_expires_at').on(table.expiresAt),
  ],
);

export const analysisJobs = sqliteTable(
  'analysis_jobs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    recordingId: text('recording_id').references(() => recordings.id, { onDelete: 'set null' }),
    status: text('status').notNull(),
    frameCount: integer('frame_count', { mode: 'number' }).notNull(),
    provider: text('provider').notNull(),
    errorCode: text('error_code'),
    startedAt: integer('started_at', { mode: 'number' }),
    leaseExpiresAt: integer('lease_expires_at', { mode: 'number' }).notNull().default(0),
    completedAt: integer('completed_at', { mode: 'number' }),
    expiresAt: integer('expires_at', { mode: 'number' }).notNull(),
    ...timestamps,
  },
  (table) => [
    index('idx_analysis_jobs_user_created').on(table.userId, table.createdAt),
    index('idx_analysis_jobs_status').on(table.status),
    index('idx_analysis_jobs_lease').on(table.status, table.leaseExpiresAt),
    index('idx_analysis_jobs_expires_at').on(table.expiresAt),
  ],
);

export const analysisResults = sqliteTable(
  'analysis_results',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id').notNull().references(() => analysisJobs.id, { onDelete: 'cascade' }),
    category: text('category').notNull(),
    summary: text('summary').notNull(),
    observationsJson: text('observations_json').notNull().default('[]'),
    confidence: real('confidence').notNull(),
    uncertainty: text('uncertainty').notNull().default(''),
    source: text('source').notNull().default('cloud-ai'),
    model: text('model').notNull().default('unknown'),
    observedAt: integer('observed_at', { mode: 'number' }).notNull(),
    capturedAt: integer('captured_at', { mode: 'number' }).notNull().default(0),
    analyzedAt: integer('analyzed_at', { mode: 'number' }).notNull().default(0),
    expiresAt: integer('expires_at', { mode: 'number' }).notNull(),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_analysis_results_job').on(table.jobId),
    index('idx_analysis_results_expires_at').on(table.expiresAt),
  ],
);

export const roadEvents = sqliteTable(
  'road_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    latitude: real('latitude').notNull(),
    longitude: real('longitude').notNull(),
    confidence: real('confidence').notNull().default(1),
    source: text('source').notNull().default('manual'),
    resolvedAt: integer('resolved_at', { mode: 'number' }),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_road_events_user').on(table.userId),
    index('idx_road_events_expires_at').on(table.expiresAt),
    index('idx_road_events_location').on(table.latitude, table.longitude),
  ],
);

export const eventAcknowledgements = sqliteTable(
  'event_acknowledgements',
  {
    eventId: text('event_id').notNull().references(() => roadEvents.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.userId] }),
    index('idx_event_ack_user').on(table.userId),
    index('idx_event_ack_expires_at').on(table.expiresAt),
  ],
);

export const groups = sqliteTable(
  'groups',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    expiresAt: integer('expires_at', { mode: 'number' }),
    ...timestamps,
  },
  (table) => [
    index('idx_groups_owner').on(table.ownerUserId),
    index('idx_groups_expires_at').on(table.expiresAt),
  ],
);

export const groupMemberships = sqliteTable(
  'group_memberships',
  {
    groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    joinedAt: integer('joined_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.userId] }),
    index('idx_group_memberships_user').on(table.userId),
  ],
);

export const groupInvites = sqliteTable(
  'group_invites',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
    invitedByUserId: text('invited_by_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    tokenHash: text('token_hash').notNull(),
    acceptedAt: integer('accepted_at', { mode: 'number' }),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    uniqueIndex('idx_group_invites_token_hash').on(table.tokenHash),
    index('idx_group_invites_group').on(table.groupId),
    index('idx_group_invites_email').on(table.email),
    index('idx_group_invites_expires_at').on(table.expiresAt),
  ],
);

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id').notNull().references(() => groups.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_messages_group_created').on(table.groupId, table.createdAt),
    index('idx_messages_user').on(table.userId),
    index('idx_messages_expires_at').on(table.expiresAt),
  ],
);

export const idempotencyRecords = sqliteTable(
  'idempotency_records',
  {
    scope: text('scope').notNull(),
    keyHash: text('key_hash').notNull(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    resourceId: text('resource_id'),
    responseStatus: integer('response_status').notNull(),
    responseBody: text('response_body').notNull(),
    createdAt: integer('created_at', { mode: 'number' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.keyHash, table.userId] }),
    index('idx_idempotency_expires_at').on(table.expiresAt),
  ],
);

export const rateLimits = sqliteTable(
  'rate_limits',
  {
    keyHash: text('key_hash').notNull(),
    windowStartedAt: integer('window_started_at', { mode: 'number' }).notNull(),
    count: integer('count', { mode: 'number' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.keyHash, table.windowStartedAt] }),
    index('idx_rate_limits_expires_at').on(table.expiresAt),
  ],
);
