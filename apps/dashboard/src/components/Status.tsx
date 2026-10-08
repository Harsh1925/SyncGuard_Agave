export function Status({
  message,
  error = false,
  id = 'status',
}: {
  message: string;
  error?: boolean;
  id?: string;
}) {
  return (
    <p id={id} role="status" aria-live="polite" className={error ? 'error' : undefined}>
      {message}
    </p>
  );
}
