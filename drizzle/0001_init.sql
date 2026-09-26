-- Tallyhand initial schema for hosted Postgres mode (TALLY_STORAGE=postgres).
-- Mirrors src/lib/db/postgres-schema.ts. Applied automatically on container
-- start (deploy/entrypoint.sh) and by `npx drizzle-kit migrate`.
-- Every entity table carries user_id: providers scope ALL queries by it.

CREATE TABLE IF NOT EXISTS clients (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  name text NOT NULL,
  email text,
  address text,
  default_rate double precision,
  notes text,
  archived boolean NOT NULL DEFAULT false,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS clients_user_id_idx ON clients (user_id);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  client_id text NOT NULL,
  name text NOT NULL,
  rate_override double precision,
  archived boolean NOT NULL DEFAULT false,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_user_id_idx ON projects (user_id);
CREATE INDEX IF NOT EXISTS projects_user_client_idx ON projects (user_id, client_id);

CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  project_id text NOT NULL,
  name text NOT NULL,
  start_at bigint NOT NULL,
  end_at bigint NOT NULL,
  duration_minutes integer NOT NULL,
  notes text,
  tags jsonb NOT NULL DEFAULT '[]',
  is_billed boolean NOT NULL DEFAULT false,
  invoice_id text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks (user_id);
CREATE INDEX IF NOT EXISTS tasks_user_project_idx ON tasks (user_id, project_id);
CREATE INDEX IF NOT EXISTS tasks_user_start_idx ON tasks (user_id, start_at);

CREATE TABLE IF NOT EXISTS expenses (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  client_id text,
  project_id text,
  date bigint NOT NULL,
  amount double precision NOT NULL,
  category text NOT NULL,
  note text,
  receipt_b64 text,
  receipt_key text,
  is_billed boolean NOT NULL DEFAULT false,
  invoice_id text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS expenses_user_id_idx ON expenses (user_id);
CREATE INDEX IF NOT EXISTS expenses_user_date_idx ON expenses (user_id, date);

CREATE TABLE IF NOT EXISTS invoices (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  client_id text NOT NULL,
  invoice_number text NOT NULL,
  issue_date bigint NOT NULL,
  due_date bigint NOT NULL,
  status text NOT NULL,
  line_items jsonb NOT NULL DEFAULT '[]',
  subtotal double precision NOT NULL,
  total double precision NOT NULL,
  notes text,
  public_token text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS invoices_user_id_idx ON invoices (user_id);
CREATE INDEX IF NOT EXISTS invoices_public_token_idx ON invoices (public_token);

CREATE TABLE IF NOT EXISTS recurring_schedules (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  client_id text NOT NULL,
  project_id text,
  name text NOT NULL,
  mode text NOT NULL,
  frequency text NOT NULL,
  interval integer NOT NULL,
  line_items jsonb NOT NULL DEFAULT '[]',
  start_date bigint NOT NULL,
  end_date bigint,
  max_occurrences integer,
  next_run_at bigint NOT NULL,
  last_run_at bigint,
  occurrences integer NOT NULL DEFAULT 0,
  status text NOT NULL,
  notes text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS recurring_schedules_user_id_idx ON recurring_schedules (user_id);
CREATE INDEX IF NOT EXISTS recurring_schedules_user_client_idx ON recurring_schedules (user_id, client_id);

CREATE TABLE IF NOT EXISTS retainers (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  client_id text NOT NULL,
  name text NOT NULL,
  type text NOT NULL,
  total_hours double precision,
  amount_cents integer NOT NULL,
  hourly_rate double precision,
  start_date bigint NOT NULL,
  end_date bigint,
  status text NOT NULL,
  recurring_schedule_id text,
  notes text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS retainers_user_id_idx ON retainers (user_id);
CREATE INDEX IF NOT EXISTS retainers_user_client_idx ON retainers (user_id, client_id);

CREATE TABLE IF NOT EXISTS settings (
  user_id text PRIMARY KEY,
  data jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS share_links (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  type text NOT NULL,
  target jsonb NOT NULL,
  expires_at bigint NOT NULL,
  revoked_at bigint,
  created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS share_links_user_id_idx ON share_links (user_id);

CREATE TABLE IF NOT EXISTS timesheet_approvals (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  share_link_id text NOT NULL,
  client_id text NOT NULL,
  week_start_ms bigint NOT NULL,
  approved_at bigint NOT NULL,
  approver_name text,
  note text
);
CREATE INDEX IF NOT EXISTS timesheet_approvals_user_id_idx ON timesheet_approvals (user_id);
CREATE INDEX IF NOT EXISTS timesheet_approvals_link_idx ON timesheet_approvals (share_link_id);

-- Builtin auth (TALLY_AUTH=builtin): magic-link users + one-time tokens.

CREATE TABLE IF NOT EXISTS builtin_users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text,
  role text NOT NULL DEFAULT 'member',
  disabled boolean NOT NULL DEFAULT false,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS builtin_login_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES builtin_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at bigint NOT NULL,
  used_at bigint,
  created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS builtin_login_tokens_user_id_idx ON builtin_login_tokens (user_id);
