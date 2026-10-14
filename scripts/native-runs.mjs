/** Native verification DTOs: prefer v2, then hydrate public trace separately. */
export function readRuns(db) {
  const all = (bucket) => db.prepare('SELECT id, payload FROM records WHERE bucket=?').all(bucket).map((row) => ({ id: row.id, value: JSON.parse(row.payload) }));
  const traces = new Map(all('run-traces').map(({ id, value }) => [id, value]));
  return [...new Map([...all('tasks'), ...all('runs-v2').map(({ id, value }) => ({ id, value: { ...value, trace: traces.get(id) ?? [] } }))].map(({ id, value }) => [id, value])).values()];
}
