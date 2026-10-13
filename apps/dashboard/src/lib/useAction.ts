import { useEffect, useRef, useState } from 'react';
export function useAction() {
  const controller = useRef<AbortController | null>(null);
  const [state, setState] = useState({
    busy: false,
    message: '',
    error: false,
    result: null as unknown,
  });
  useEffect(() => () => controller.current?.abort(), []);
  async function run(action: (signal: AbortSignal) => Promise<unknown>, message: string) {
    if (controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setState((previous) => ({ ...previous, busy: true, error: false, message: 'Working…' }));
    try {
      const result = await action(AbortSignal.any([current.signal, AbortSignal.timeout(40000)]));
      if (!current.signal.aborted) setState({ busy: false, error: false, message, result });
    } catch (error) {
      if (!current.signal.aborted)
        setState((previous) => ({
          ...previous,
          busy: false,
          error: true,
          message: (error as Error).message,
        }));
    } finally {
      if (controller.current === current) controller.current = null;
    }
  }
  return { ...state, run };
}
