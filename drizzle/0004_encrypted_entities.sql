-- End-to-end encrypted sync vault (feature port: cloud database + E2E sync).
--
-- The server stores ONLY ciphertext: each row is one encrypted entity
-- snapshot for one user. The client encrypts the entity JSON with a per-user
-- AES-GCM-256 data key (DEK) that never leaves the device; the server has no
-- way to read `ciphertext` or `iv`. Push/pull is last-write-wins on
-- `updated_at`; soft-deletes travel as tombstones (`deleted = true`) so a
-- second device learns the deletion.
--
-- Composite primary key (user_id, entity_type, entity_id): a user has at most
-- one snapshot per entity, so push is an idempotent upsert.
--
-- Mirrors src/lib/db/postgres-schema.ts (`encryptedEntities`). Applied
-- automatically on container start (deploy/entrypoint.sh) and by
-- `npx drizzle-kit migrate`. Same table on Neon (serverless HTTP driver).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS encrypted_entities (
  user_id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  iv text NOT NULL,
  ciphertext text NOT NULL,
  updated_at bigint NOT NULL,
  deleted boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, entity_type, entity_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS encrypted_entities_user_updated_idx
  ON encrypted_entities (user_id, updated_at);
