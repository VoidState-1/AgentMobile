/** Test inspection of current journal tables; product queries read headers only. */
export function readOperations(db, namespace = 'projects', projectId) {
  const rows = db.prepare('SELECT h.payload AS header,b.payload AS body FROM operation_headers h JOIN operation_bodies b ' +
    'ON h.namespace=b.namespace AND h.project_id=b.project_id AND h.id=b.id WHERE h.namespace=?' +
    (projectId ? ' AND h.project_id=?' : '') + ' ORDER BY h.sequence').all(...(projectId ? [namespace, projectId] : [namespace]));
  return rows.map(row => ({ ...JSON.parse(row.header), ...JSON.parse(row.body) }));
}
