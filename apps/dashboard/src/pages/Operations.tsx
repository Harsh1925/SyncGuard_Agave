import { useCallback, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { loadOperation } from '../lib/api.js';
import { useResource } from '../lib/useResource.js';
import { FailureLab } from '../components/FailureLab.js';
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
      <FailureLab
        key={id}
        operation={state.data?.operation ?? null}
        startCursor={state.data?.timeline.at(-1)?.id ?? '0'}
      />
    </>
  );
}
