for (const [name, url] of [
  ['API', 'http://localhost:8000/health'],
  ['ERP', 'http://localhost:8001/health'],
  ['PM', 'http://localhost:8002/health'],
  ['Dashboard', 'http://localhost:8080'],
]) {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  console.log(`${name}: HTTP ${response.status}`);
}
