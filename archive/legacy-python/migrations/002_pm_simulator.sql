CREATE SCHEMA pm_sim;
CREATE TABLE pm_sim.invoices (
    id uuid PRIMARY KEY,
    version bigint NOT NULL,
    invoice jsonb,
    deleted boolean NOT NULL DEFAULT false,
    operation_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pm_sim.receipts (
    operation_id uuid PRIMARY KEY,
    logical_id uuid NOT NULL,
    version bigint NOT NULL,
    request jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pm_sim.jobs (id text PRIMARY KEY, name text NOT NULL, active boolean NOT NULL DEFAULT true);
INSERT INTO pm_sim.jobs(id,name) VALUES ('J001','Harbor renovation');
