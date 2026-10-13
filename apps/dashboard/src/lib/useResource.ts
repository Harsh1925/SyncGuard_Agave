import { useCallback, useEffect, useState } from 'react';
export function useResource<T>(loader: (signal: AbortSignal) => Promise<T>, intervalMs = 0) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({
    data: null,
    loading: true,
    error: null,
  });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('Request timed out. Try again.')),
      15000,
    );
    let active = true;
    setState((previous) => ({ ...previous, loading: true, error: null }));
    loader(controller.signal)
      .then(
        (data) => {
          if (active) setState({ data, loading: false, error: null });
        },
        (error) => {
          if (active)
            setState((previous) => ({
              ...previous,
              loading: false,
              error: String(error.message ?? error),
            }));
        },
      )
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [loader, revision]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!intervalMs || state.loading) return;
    const timer = setTimeout(refresh, intervalMs);
    return () => clearTimeout(timer);
  }, [intervalMs, state.loading, revision, refresh]);
  return { ...state, refresh };
}
