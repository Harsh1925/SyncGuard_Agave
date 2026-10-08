CREATE SEQUENCE observation_version;

CREATE TABLE records (
    logical_id uuid PRIMARY KEY,
    erp_identity jsonb NOT NULL,
    business_key jsonb NOT NULL,
    pm_id text,
    observed_version bigint NOT NULL DEFAULT 0,
    observed_fingerprint text,
    observed_state jsonb,
    applied_version bigint NOT NULL DEFAULT 0,
    applied_fingerprint text,
    tombstone_version bigint,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE snapshots (
    id uuid PRIMARY KEY,
    status text NOT NULL CHECK (status IN ('IN_PROGRESS', 'COMPLETE', 'FAILED')),
    previous_complete_id uuid REFERENCES snapshots(id) ON DELETE SET NULL,
    retained boolean NOT NULL DEFAULT false,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    error text
);
CREATE INDEX snapshots_complete ON snapshots(completed_at DESC) WHERE status='COMPLETE';
CREATE TABLE snapshot_members (
    snapshot_id uuid NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    logical_id uuid NOT NULL,
    fingerprint text NOT NULL,
    state jsonb NOT NULL,
    PRIMARY KEY (snapshot_id, logical_id)
);

CREATE TABLE operations (
    operation_id uuid PRIMARY KEY,
    logical_id uuid NOT NULL REFERENCES records(logical_id),
    version bigint NOT NULL,
    entity text NOT NULL DEFAULT 'invoice',
    action text NOT NULL CHECK (action IN ('upsert','delete')),
    source text NOT NULL DEFAULT 'erp',
    destination text NOT NULL DEFAULT 'pm',
    desired jsonb,
    fingerprint text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','attempting','retrying','succeeded','failed','suppressed')),
    attempts integer NOT NULL DEFAULT 0,
    destination_reference text,
    verification_outcome text,
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CHECK ((action='delete' AND desired IS NULL) OR (action='upsert' AND desired IS NOT NULL))
);
CREATE INDEX operations_active ON operations(logical_id) WHERE status IN ('pending','attempting','retrying');
CREATE TABLE jobs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation_id uuid NOT NULL REFERENCES operations(operation_id),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','retrying','succeeded','failed')),
    available_at timestamptz NOT NULL DEFAULT now(),
    claimed_by text,
    claim_token uuid,
    lease_until timestamptz,
    attempts integer NOT NULL DEFAULT 0,
    error text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_available ON jobs(available_at,id) WHERE status IN ('pending','retrying');
CREATE INDEX jobs_expired ON jobs(lease_until) WHERE status='claimed';
CREATE INDEX jobs_operation ON jobs(operation_id);

CREATE TABLE audit_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    operation_id uuid REFERENCES operations(operation_id),
    event text NOT NULL,
    detail jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_operation ON audit_events(operation_id,id);
CREATE TABLE drift_reports (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    logical_id uuid NOT NULL,
    authoritative jsonb,
    replica jsonb,
    detected_at timestamptz NOT NULL DEFAULT now(),
    resolved_at timestamptz
);
CREATE UNIQUE INDEX drift_open ON drift_reports(logical_id) WHERE resolved_at IS NULL;
CREATE TABLE chaos_runs (
    id uuid PRIMARY KEY,
    seed bigint NOT NULL,
    configuration jsonb NOT NULL,
    failure_sequence jsonb NOT NULL,
    operation_counts jsonb NOT NULL DEFAULT '{}',
    invariant_results jsonb,
    status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','running','completed','failed')),
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
);
