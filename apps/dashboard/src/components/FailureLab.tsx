import { useState, useRef, type FormEvent } from 'react';
import type { ChaosRun, DriftReport, Operation } from '@syncguard/contracts';
import { request } from '../lib/api.js';
import { useResource } from '../lib/useResource.js';
import { useAction } from '../lib/useAction.js';
import { Status } from './Status.js';
const points = [
  'BEFORE_EXTERNAL_WRITE',
  'AFTER_EXTERNAL_WRITE_BEFORE_LOCAL_COMPLETION',
  'DURING_SNAPSHOT',
  'AFTER_SNAPSHOT_BEFORE_DERIVED_CHANGE_COMMIT',
  'DURING_RECONCILIATION',
];
async function loadLab(signal: AbortSignal) {
  const [capabilities, runs, drift] = await Promise.all([
    request<{ demo_controls: boolean; llm_configured: boolean }>('/capabilities', { signal }),
    request<ChaosRun[]>('/chaos/runs', { signal }),
    request<DriftReport[]>('/drift', { signal }),
  ]);
  return { capabilities, runs, drift };
}
const initialDocument = JSON.stringify(
  {
    company_id: 'ACME',
    vendor_id: 'V001',
    invoice_number: 'AI-DEMO-001',
    job_id: 'J001',
    amount: '1499.00',
    currency: 'USD',
    issued_on: '2026-01-15',
    status: 'open',
  },
  null,
  2,
);
export function FailureLab({
  operation,
  startCursor,
}: {
  operation: Operation | null;
  startCursor: string;
}) {
  const lab = useResource(loadLab, 3000);
  const action = useAction();
  const [actionScope, setActionScope] = useState('lab');
  function perform(scope: string, ...args: Parameters<typeof action.run>) {
    setActionScope(scope);
    return action.run(...args);
  }
  const [seed, setSeed] = useState('42');
  const [steps, setSteps] = useState('12');
  const [point, setPoint] = useState('');
  const [validation, setValidation] = useState('');
  const seedRef = useRef<HTMLInputElement>(null);
  const stepsRef = useRef<HTMLInputElement>(null);
  const [document, setDocument] = useState(initialDocument);
  const [mode, setMode] = useState('synthetic');
  const [ingressId, setIngressId] = useState(() => crypto.randomUUID());
  const [timelineCursor, setTimelineCursor] = useState(startCursor);
  const [history, setHistory] = useState<unknown[]>([]);
  const disabled = action.busy;
  const active = lab.data?.runs.some((run) => run.status === 'running');
  function post(path: string, body: unknown, signal: AbortSignal) {
    return request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  }
  function execute(event: FormEvent) {
    event.preventDefault();
    if (!seed || !Number.isInteger(Number(seed)) || Number(seed) < 0 || Number(seed) > 0xffffffff) {
      setValidation('Enter a seed from 0 to 4294967295.');
      seedRef.current?.focus();
      return;
    }
    if (!steps || !Number.isInteger(Number(steps)) || Number(steps) < 1 || Number(steps) > 40) {
      setValidation('Enter between 1 and 40 steps.');
      stepsRef.current?.focus();
      return;
    }
    setValidation('');
    void perform(
      'lab',
      async (signal) => {
        const result = await post(
          '/chaos/runs',
          { seed: Number(seed), steps: Number(steps), ...(point ? { fault_point: point } : {}) },
          signal,
        );
        lab.refresh();
        return result;
      },
      'Run accepted. Results refresh below; it may take a minute.',
    );
  }
  return (
    <>
      <section aria-labelledby="lab-title">
        <h2 id="lab-title">Failure lab</h2>
        <p>
          Execute reproducible failures and inspect recorded evidence. Controls are enabled only in
          the isolated demo environment.
        </p>
        <button type="button" onClick={lab.refresh} disabled={lab.loading}>
          Refresh lab
        </button>
        <Status
          id="lab-status"
          error={Boolean(lab.error)}
          message={
            lab.error ??
            (lab.loading
              ? 'Loading lab…'
              : lab.data?.capabilities.demo_controls
                ? 'Isolated demo controls enabled.'
                : 'Start the demo environment to enable fault execution.')
          }
        />
        <form onSubmit={execute} noValidate>
          <label htmlFor="seed">Seed</label>
          <input
            ref={seedRef}
            id="seed"
            type="number"
            value={seed}
            onChange={(e) => {
              setSeed(e.target.value);
              setValidation('');
            }}
            aria-invalid={Boolean(validation)}
            aria-describedby="lab-validation"
          />
          <label htmlFor="steps">Steps</label>
          <input
            ref={stepsRef}
            id="steps"
            type="number"
            value={steps}
            onChange={(e) => {
              setSteps(e.target.value);
              setValidation('');
            }}
            aria-invalid={Boolean(validation)}
            aria-describedby="lab-validation"
          />
          <label htmlFor="fault-point">Critical crash boundary</label>
          <select id="fault-point" value={point} onChange={(e) => setPoint(e.target.value)}>
            <option value="">All five boundaries</option>
            {points.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <button
            disabled={disabled || active || !lab.data?.capabilities.demo_controls}
            aria-busy={disabled}
          >
            Run seeded chaos
          </button>
        </form>
        <Status id="lab-validation" message={validation} error={Boolean(validation)} />
        <Status
          id="lab-action"
          message={actionScope === 'lab' ? action.message : ''}
          error={actionScope === 'lab' && action.error}
        />
        {actionScope === 'lab' && action.result ? (
          <pre aria-label="Action result">{JSON.stringify(action.result, null, 2)}</pre>
        ) : null}
        {lab.data?.runs.length ? (
          lab.data.runs.map((run) => (
            <details key={run.id} open={run.status === 'running'}>
              <summary>
                Seed {run.seed} · {run.status} · {run.id}
              </summary>
              <p>Created {run.created_at} UTC</p>
              {run.operation_counts.error ? (
                <Status message={run.operation_counts.error} error />
              ) : null}
              <ul>
                {run.invariant_results?.map((result) => (
                  <li key={result.name}>
                    {result.name}:{' '}
                    {result.passed === null ? 'Not executed' : result.passed ? 'Passed' : 'Failed'}{' '}
                    · {result.evidence}
                  </li>
                ))}
              </ul>
              <pre>
                {JSON.stringify(
                  { sequence: run.failure_sequence, evidence: run.operation_counts },
                  null,
                  2,
                )}
              </pre>
            </details>
          ))
        ) : (
          <p>No runs yet. Start a seeded run to record evidence.</p>
        )}
      </section>
      <section aria-labelledby="drift-title">
        <h2 id="drift-title">Drift and recovery</h2>
        <Status
          id="drift-status"
          message={actionScope === 'drift' ? action.message : ''}
          error={actionScope === 'drift' && action.error}
        />
        <p>
          Select an operation above to inject a synthetic PM amount of 9999.00. Reconciliation
          reports the disagreement without changing ERP authority.
        </p>
        <button
          type="button"
          disabled={disabled || active || !operation || !lab.data?.capabilities.demo_controls}
          onClick={() =>
            void perform(
              'drift',
              async (signal) => {
                const result = await post(
                  `/drift/${operation!.logical_id}/inject`,
                  { amount: '9999.00' },
                  signal,
                );
                lab.refresh();
                return result;
              },
              'Drift injected and reconciliation completed.',
            )
          }
        >
          Inject drift
        </button>
        <button
          type="button"
          disabled={disabled || active}
          onClick={() =>
            void perform(
              'drift',
              async (signal) => {
                const result = await post('/reconciliation', {}, signal);
                lab.refresh();
                return result;
              },
              'Reconciliation completed.',
            )
          }
        >
          Run reconciliation
        </button>
        <button
          type="button"
          disabled={disabled || active || operation?.status !== 'failed'}
          onClick={() =>
            void perform(
              'drift',
              (signal) => post(`/operations/${operation!.operation_id}/replay`, {}, signal),
              'Failed operation queued for replay.',
            )
          }
        >
          Replay failed operation
        </button>
        {lab.data?.drift.length ? (
          <ul>
            {lab.data.drift.map((row) => (
              <li key={row.id}>
                {row.logical_id} · {row.resolved_at ? 'Resolved' : 'Unresolved'} · {row.detected_at}{' '}
                UTC
              </li>
            ))}
          </ul>
        ) : (
          <p>No drift reports.</p>
        )}
        <button
          type="button"
          disabled={disabled || !operation}
          onClick={() =>
            void perform(
              'drift',
              async (signal) => {
                const rows = await request<{ id: string }[]>(
                  `/operations/${operation!.operation_id}/timeline?after=${timelineCursor === '0' ? startCursor : timelineCursor}`,
                  { signal },
                );
                setHistory((previous) => [...previous, ...rows]);
                if (rows.length) setTimelineCursor(rows.at(-1)!.id);
                return { events_loaded: rows.length };
              },
              'More timeline events loaded.',
            )
          }
        >
          Load more timeline events
        </button>
        {history.length ? <pre>{JSON.stringify(history, null, 2)}</pre> : null}
      </section>
      <section aria-labelledby="ingress-title">
        <h2 id="ingress-title">Validated invoice ingress</h2>
        <Status
          id="ingress-status"
          message={actionScope === 'ingress' ? action.message : ''}
          error={actionScope === 'ingress' && action.error}
        />
        <p>
          Synthetic JSON exercises the same financial write boundary as LLM extraction. Vendor,
          active job, fields and duplicates are checked before ERP accepts the invoice.
        </p>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void perform(
              'ingress',
              (signal) =>
                post('/ingress/invoices', { operation_id: ingressId, document, mode }, signal),
              'Invoice accepted by ERP. Run a snapshot to propagate it.',
            );
          }}
        >
          <label htmlFor="extract-mode">Extraction mode</label>
          <select id="extract-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="synthetic">Synthetic JSON (no LLM)</option>
            <option value="llm" disabled={!lab.data?.capabilities.llm_configured}>
              LLM extraction
            </option>
          </select>
          <label htmlFor="invoice-document">Synthetic invoice document</label>
          <textarea
            id="invoice-document"
            className="resize-none"
            value={document}
            onChange={(e) => setDocument(e.target.value)}
            rows={12}
            aria-describedby="ingress-help ingress-status"
          />
          <p id="ingress-help">
            Operation {ingressId}. Keep the same document to retry an uncertain request; start a new
            proposal when editing it.
          </p>
          <button disabled={disabled || active || !document.trim()} aria-busy={disabled}>
            Validate and accept invoice
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setIngressId(crypto.randomUUID())}
          >
            Start new proposal
          </button>
        </form>
        <button
          type="button"
          disabled={disabled || active}
          onClick={() =>
            void perform(
              'ingress',
              (signal) => post('/snapshots', {}, signal),
              'Complete snapshot recorded; queued work is ready for the worker.',
            )
          }
        >
          Run snapshot
        </button>
        <button
          type="button"
          disabled={disabled || active || !lab.data?.capabilities.demo_controls}
          onClick={() =>
            void perform(
              'ingress',
              (signal) => post('/work/step', {}, signal),
              'Worker step completed. Refresh the operation timeline to inspect the result.',
            )
          }
        >
          Process next queued job
        </button>
      </section>
    </>
  );
}
