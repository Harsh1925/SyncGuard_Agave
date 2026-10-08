import { Link } from 'react-router-dom';
import { Fragment } from 'react';
import { loadHealth } from '../lib/api.js';
import { useResource } from '../lib/useResource.js';
import { Status } from '../components/Status.js';
export function Health() {
  const state = useResource(loadHealth);
  const metrics = state.data?.metrics;
  const rows: [string, string | number][] = metrics
    ? [
        ['ERP', metrics.erp],
        ['PM', metrics.pm],
        ['Redis', metrics.redis],
        ['Last complete snapshot', metrics.last_complete_snapshot ?? 'No complete snapshot yet'],
        ['Last successful sync', metrics.last_successful_sync ?? 'No successful sync yet'],
        [
          'Pending / retrying / failed jobs',
          `${metrics.jobs.pending ?? 0} / ${metrics.jobs.retrying ?? 0} / ${metrics.jobs.failed ?? 0}`,
        ],
        ['Sync lag (seconds)', Math.round(metrics.sync_lag_seconds)],
        ['Unresolved drift', metrics.drift_count],
      ]
    : [];
  return (
    <>
      <h1>System health</h1>
      <p>Invoice replication from the legacy ERP to project management.</p>
      <button
        type="button"
        onClick={state.refresh}
        disabled={state.loading}
        aria-busy={state.loading}
      >
        Refresh health
      </button>
      <Status
        message={
          state.error
            ? `${state.error}. Start the API and database, then refresh.`
            : state.loading
              ? 'Loading current health…'
              : 'Health refreshed. Timestamps are shown in UTC.'
        }
        error={Boolean(state.error)}
      />
      <section aria-labelledby="health-title">
        <h2 id="health-title">Current state</h2>
        <dl>
          {metrics ? (
            rows.map(([label, value]) => (
              <Fragment key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </Fragment>
            ))
          ) : (
            <>
              <dt>Services</dt>
              <dd>{state.error ? 'Unavailable' : 'Loading…'}</dd>
            </>
          )}
        </dl>
      </section>
      <section aria-labelledby="operations-title">
        <h2 id="operations-title">Recent operations</h2>
        <p>Latest 25 operations. Select one to inspect its timeline.</p>
        <div className="table-scroll">
          <table>
            <caption className="sr-only">Recent invoice synchronization operations</caption>
            <thead>
              <tr>
                <th scope="col">Operation</th>
                <th scope="col">Action</th>
                <th scope="col">Version</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {state.data?.operations.length ? (
                state.data.operations.map((operation) => (
                  <tr key={operation.operation_id}>
                    <td>
                      <Link to={`/operations?operation_id=${operation.operation_id}`}>
                        {operation.operation_id}
                      </Link>
                    </td>
                    <td>{operation.action}</td>
                    <td>{operation.version}</td>
                    <td>{operation.status}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4}>
                    {state.loading
                      ? 'Loading operations…'
                      : state.error
                        ? 'Operations unavailable. Refresh to retry.'
                        : 'No operations yet. Seed the ERP and run a snapshot poll.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
