-- One approval per (user, link, week): race-safe public timesheet approvals.
CREATE UNIQUE INDEX IF NOT EXISTS timesheet_approvals_dedup_uidx
  ON timesheet_approvals (user_id, share_link_id, week_start_ms);
