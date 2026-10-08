import { useCallback, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ChaosPlan } from '@syncguard/contracts';
import { loadOperation, createPlan } from '../lib/api.js';
import { useResource } from '../lib/useResource.js';
import { Status } from '../components/Status.js';
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function Operations() {
  const [params, setParams] = useSearchParams();
  const id = params.get('operation_id') ?? '';
  const [input, setInput] = useState(id);
  const [validation, setValidation] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const loader = useCallback(
    (signal: AbortSignal) => (uuid.test(id) ? loadOperation(id, signal) : Promise.resolve(null)),
    [id],
  );
  const state = useResource(loader);
  const [seed, setSeed] = useState('42');
  const seedRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ChaosPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [chaosStatus, setChaosStatus] = useState({ message: '', error: false });
  function lookup(event: FormEvent) {
    event.preventDefault();
    if (!uuid.test(input.trim())) {
      setValidation('Enter a valid operation UUID.');
      inputRef.current?.focus();
      return;
    }
    setValidation('');
    if (id === input.trim()) state.refresh();
    else setParams({ operation_id: input.trim() });
  }
  async function generate(event: FormEvent) {
    event.preventDefault();
    const value = Number(seed);
    if (!seed || !Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      setChaosStatus({ message: 'Enter an integer seed from 0 to 4294967295.', error: true });
      seedRef.current?.focus();
      return;
    }
    if (busy) return;
    setBusy(true);
    setChaosStatus({ message: 'Creating plan…', error: false });
    try {
      setPlan(await createPlan(value));
      setChaosStatus({
        message: 'Plan recorded. Invariants have not been executed.',
        error: false,
      });
    } catch (error) {
      setChaosStatus({ message: `${(error as Error).message}. Try again.`, error: true });
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>Operation timeline / Failure lab</h1>
      <p>Inspect an operation’s attempts, verification result, and audit events.</p>
      <form onSubmit={lookup} noValidate>
        <label htmlFor="operation-id">Operation ID</label>
        <input
          ref={inputRef}
          id="operation-id"
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setValidation('');
          }}
          aria-invalid={Boolean(validation)}
          aria-describedby="status"
          autoComplete="off"
        />
        <button disabled={state.loading} aria-busy={state.loading}>
          Load timeline
        </button>
      </form>
      <Status
        message={
          validation ||
          state.error ||
          (id && state.loading
            ? 'Loading operation…'
            : state.data
              ? 'Timeline loaded. Showing up to 100 events.'
              : 'Choose an operation from System health or enter its ID.')
        }
        error={Boolean(validation || state.error)}
      />
      <pre>
        {state.data ? JSON.stringify(state.data.operation, null, 2) : 'No operation selected.'}
      </pre>
      <ol aria-label="Audit timeline">
        {state.data?.timeline.map((item) => (
          <li key={item.id}>
            {item.created_at} · {item.event} · {JSON.stringify(item.detail)}
          </li>
        ))}
      </ol>
      <section aria-labelledby="chaos-title">
        <h2 id="chaos-title">Seeded chaos plan</h2>
        <p>
          A plan records a reproducible failure sequence. The scenario runner and invariant proof
          are extension points in this scaffold.
        </p>
        <form onSubmit={generate} noValidate>
          <label htmlFor="seed">Seed</label>
          <input
            ref={seedRef}
            id="seed"
            type="number"
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
            aria-invalid={chaosStatus.error}
            aria-describedby="chaos-status"
          />
          <button disabled={busy} aria-busy={busy}>
            Create plan
          </button>
        </form>
        <Status id="chaos-status" message={chaosStatus.message} error={chaosStatus.error} />
        <pre>{plan ? JSON.stringify(plan, null, 2) : 'No plan created yet.'}</pre>
      </section>
      <section>
        <h2>Deterministic fault hooks</h2>
        <p>
          Activate a named boundary in a disposable worker process as documented in the runbook.
        </p>
        <code>AFTER_EXTERNAL_WRITE_BEFORE_LOCAL_COMPLETION</code>
      </section>
    </>
  );
}
