CREATE TABLE ingress_operations (
  operation_id uuid PRIMARY KEY,
  logical_id uuid,
  request_hash text NOT NULL,
  expected_fingerprint text,
  desired jsonb,
  status text NOT NULL CHECK(status IN ('pending','accepted','refused')),
  reasons jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX ingress_identity ON ingress_operations(logical_id);
CREATE TABLE simulator_faults (
  target text PRIMARY KEY CHECK(target IN ('erp','pm')),
  kind text NOT NULL CHECK(kind IN ('none','latency','partial_read','lost_response','transient_failure','rate_limit')),
  remaining integer NOT NULL CHECK(remaining BETWEEN 0 AND 100),
  delay_ms integer NOT NULL DEFAULT 0 CHECK(delay_ms BETWEEN 0 AND 10000),
  fail_after integer NOT NULL DEFAULT 1 CHECK(fail_after >= 0)
);
CREATE UNIQUE INDEX chaos_one_running ON chaos_runs ((configuration->>'kind'))
  WHERE status='running' AND configuration->>'kind'='seeded-chaos';
