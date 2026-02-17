-- Search corpus foundation for connector-first unified retrieval.

CREATE TABLE IF NOT EXISTS "SearchDocument" (
  "id" TEXT PRIMARY KEY,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "userId" TEXT NOT NULL,
  "emailAccountId" TEXT,
  "connector" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceParentId" TEXT,
  "title" TEXT,
  "snippet" TEXT,
  "bodyText" TEXT,
  "url" TEXT,
  "authorIdentity" TEXT,
  "occurredAt" TIMESTAMPTZ,
  "startAt" TIMESTAMPTZ,
  "endAt" TIMESTAMPTZ,
  "updatedSourceAt" TIMESTAMPTZ,
  "lastIngestedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deletedAt" TIMESTAMPTZ,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE,
  "freshnessScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "authorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "metadata" JSONB
);

CREATE TABLE IF NOT EXISTS "SearchChunk" (
  "id" TEXT PRIMARY KEY,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "userId" TEXT NOT NULL,
  "emailAccountId" TEXT,
  "documentId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "tokenCount" INTEGER,
  "metadata" JSONB,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS "SearchEntity" (
  "id" TEXT PRIMARY KEY,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "userId" TEXT NOT NULL,
  "emailAccountId" TEXT,
  "entityType" TEXT NOT NULL,
  "canonicalValue" TEXT NOT NULL,
  "displayValue" TEXT,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "metadata" JSONB,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS "SearchAlias" (
  "id" TEXT PRIMARY KEY,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "userId" TEXT NOT NULL,
  "emailAccountId" TEXT,
  "entityType" TEXT NOT NULL,
  "canonicalValue" TEXT NOT NULL,
  "aliasValue" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "metadata" JSONB,
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS "SearchEdge" (
  "id" TEXT PRIMARY KEY,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "userId" TEXT NOT NULL,
  "emailAccountId" TEXT,
  "edgeType" TEXT NOT NULL,
  "sourceEntityType" TEXT NOT NULL,
  "sourceValue" TEXT NOT NULL,
  "targetEntityType" TEXT NOT NULL,
  "targetValue" TEXT NOT NULL,
  "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "metadata" JSONB,
  "lastObservedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "isDeleted" BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS "SearchSignal" (
  "id" TEXT PRIMARY KEY,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "userId" TEXT NOT NULL,
  "emailAccountId" TEXT,
  "documentId" TEXT NOT NULL,
  "signalType" TEXT NOT NULL,
  "signalValue" DOUBLE PRECISION NOT NULL,
  "occurredAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "metadata" JSONB
);

CREATE TABLE IF NOT EXISTS "SearchIngestionCheckpoint" (
  "id" TEXT PRIMARY KEY,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "userId" TEXT NOT NULL,
  "emailAccountId" TEXT,
  "connector" TEXT NOT NULL,
  "streamKey" TEXT NOT NULL,
  "cursor" TEXT,
  "cursorNumeric" BIGINT,
  "state" JSONB,
  "status" TEXT NOT NULL DEFAULT 'active',
  "errorMessage" TEXT,
  "lastSyncedAt" TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS "SearchDocument_userId_connector_sourceType_sourceId_key"
ON "SearchDocument" ("userId", "connector", "sourceType", "sourceId");

CREATE INDEX IF NOT EXISTS "SearchDocument_userId_connector_updatedSourceAt_idx"
ON "SearchDocument" ("userId", "connector", "updatedSourceAt");

CREATE INDEX IF NOT EXISTS "SearchDocument_userId_connector_occurredAt_idx"
ON "SearchDocument" ("userId", "connector", "occurredAt");

CREATE INDEX IF NOT EXISTS "SearchDocument_userId_connector_isDeleted_idx"
ON "SearchDocument" ("userId", "connector", "isDeleted");

CREATE INDEX IF NOT EXISTS "SearchDocument_emailAccountId_connector_idx"
ON "SearchDocument" ("emailAccountId", "connector");

CREATE UNIQUE INDEX IF NOT EXISTS "SearchChunk_documentId_ordinal_key"
ON "SearchChunk" ("documentId", "ordinal");

CREATE INDEX IF NOT EXISTS "SearchChunk_userId_documentId_idx"
ON "SearchChunk" ("userId", "documentId");

CREATE INDEX IF NOT EXISTS "SearchChunk_emailAccountId_documentId_idx"
ON "SearchChunk" ("emailAccountId", "documentId");

CREATE UNIQUE INDEX IF NOT EXISTS "SearchEntity_userId_entityType_canonicalValue_key"
ON "SearchEntity" ("userId", "entityType", "canonicalValue");

CREATE INDEX IF NOT EXISTS "SearchEntity_userId_entityType_isDeleted_idx"
ON "SearchEntity" ("userId", "entityType", "isDeleted");

CREATE UNIQUE INDEX IF NOT EXISTS "SearchAlias_userId_entityType_canonical_alias_key"
ON "SearchAlias" ("userId", "entityType", "canonicalValue", "aliasValue");

CREATE INDEX IF NOT EXISTS "SearchAlias_userId_entityType_aliasValue_idx"
ON "SearchAlias" ("userId", "entityType", "aliasValue");

CREATE UNIQUE INDEX IF NOT EXISTS "SearchEdge_userId_edgeType_source_target_key"
ON "SearchEdge" (
  "userId",
  "edgeType",
  "sourceEntityType",
  "sourceValue",
  "targetEntityType",
  "targetValue"
);

CREATE INDEX IF NOT EXISTS "SearchEdge_userId_edgeType_isDeleted_idx"
ON "SearchEdge" ("userId", "edgeType", "isDeleted");

CREATE INDEX IF NOT EXISTS "SearchEdge_userId_source_idx"
ON "SearchEdge" ("userId", "sourceEntityType", "sourceValue");

CREATE INDEX IF NOT EXISTS "SearchEdge_userId_target_idx"
ON "SearchEdge" ("userId", "targetEntityType", "targetValue");

CREATE INDEX IF NOT EXISTS "SearchSignal_userId_documentId_signalType_occurredAt_idx"
ON "SearchSignal" ("userId", "documentId", "signalType", "occurredAt");

CREATE INDEX IF NOT EXISTS "SearchSignal_userId_signalType_occurredAt_idx"
ON "SearchSignal" ("userId", "signalType", "occurredAt");

CREATE UNIQUE INDEX IF NOT EXISTS "SearchIngestionCheckpoint_user_connector_stream_key"
ON "SearchIngestionCheckpoint" ("userId", "connector", "streamKey");

CREATE INDEX IF NOT EXISTS "SearchIngestionCheckpoint_user_connector_status_idx"
ON "SearchIngestionCheckpoint" ("userId", "connector", "status");

CREATE INDEX IF NOT EXISTS "SearchDocument_text_idx"
ON "SearchDocument"
USING GIN (to_tsvector('english', COALESCE("title", '') || ' ' || COALESCE("snippet", '') || ' ' || COALESCE("bodyText", '')));

CREATE INDEX IF NOT EXISTS "SearchChunk_text_idx"
ON "SearchChunk"
USING GIN (to_tsvector('english', COALESCE("content", '')));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SearchDocument_userId_fkey'
  ) THEN
    ALTER TABLE "SearchDocument"
    ADD CONSTRAINT "SearchDocument_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SearchDocument_emailAccountId_fkey'
  ) THEN
    ALTER TABLE "SearchDocument"
    ADD CONSTRAINT "SearchDocument_emailAccountId_fkey"
    FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SearchChunk_documentId_fkey'
  ) THEN
    ALTER TABLE "SearchChunk"
    ADD CONSTRAINT "SearchChunk_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "SearchDocument"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SearchChunk_userId_fkey'
  ) THEN
    ALTER TABLE "SearchChunk"
    ADD CONSTRAINT "SearchChunk_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SearchChunk_emailAccountId_fkey'
  ) THEN
    ALTER TABLE "SearchChunk"
    ADD CONSTRAINT "SearchChunk_emailAccountId_fkey"
    FOREIGN KEY ("emailAccountId") REFERENCES "EmailAccount"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SearchEntity_userId_fkey'
  ) THEN
    ALTER TABLE "SearchEntity"
    ADD CONSTRAINT "SearchEntity_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SearchAlias_userId_fkey'
  ) THEN
    ALTER TABLE "SearchAlias"
    ADD CONSTRAINT "SearchAlias_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SearchEdge_userId_fkey'
  ) THEN
    ALTER TABLE "SearchEdge"
    ADD CONSTRAINT "SearchEdge_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SearchSignal_userId_fkey'
  ) THEN
    ALTER TABLE "SearchSignal"
    ADD CONSTRAINT "SearchSignal_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SearchSignal_documentId_fkey'
  ) THEN
    ALTER TABLE "SearchSignal"
    ADD CONSTRAINT "SearchSignal_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "SearchDocument"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SearchIngestionCheckpoint_userId_fkey'
  ) THEN
    ALTER TABLE "SearchIngestionCheckpoint"
    ADD CONSTRAINT "SearchIngestionCheckpoint_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;

-- Optional semantic columns if pgvector is installed.
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS vector;
  EXCEPTION
    WHEN undefined_file THEN
      RAISE NOTICE 'pgvector extension unavailable; skipping search corpus vector columns.';
  END;
END
$$;

DO $$
DECLARE
  has_vector BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')
  INTO has_vector;

  IF has_vector THEN
    ALTER TABLE "SearchDocument"
    ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

    ALTER TABLE "SearchChunk"
    ADD COLUMN IF NOT EXISTS "embedding" vector(1536);

    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE indexname = 'SearchDocument_embedding_idx'
    ) THEN
      CREATE INDEX "SearchDocument_embedding_idx"
      ON "SearchDocument"
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE indexname = 'SearchChunk_embedding_idx'
    ) THEN
      CREATE INDEX "SearchChunk_embedding_idx"
      ON "SearchChunk"
      USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
    END IF;
  ELSE
    RAISE NOTICE 'Skipping vector indexes for search corpus due to missing pgvector.';
  END IF;
END
$$;
