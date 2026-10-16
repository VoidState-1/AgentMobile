/** Native current-format verification; trace is hydrated separately. */
export function readRuns(db) {
  const read = (table, id) => {
    const row = db.prepare('SELECT payload FROM ' + table + ' WHERE id=?').get(id);
    if (!row) throw new Error('Current run body missing: ' + id);
    return JSON.parse(row.payload);
  };
  return db
    .prepare('SELECT payload FROM run_headers')
    .all()
    .map(row => {
      const header = JSON.parse(row.payload);
      const launch = db
        .prepare("SELECT payload FROM records WHERE bucket='run-launches' AND id=?")
        .get(header.launchSnapshotRef);
      const resources = launch ? JSON.parse(launch.payload) : {};
      return {
        ...header,
        ...read('run_inputs', header.id),
        ...read('run_results', header.id),
        error: header.error?.message,
        modelSnapshot: resources.model,
        agentSettingsSnapshot: resources.settings,
        mcpSnapshot: resources.mcp,
        skillsSnapshot: resources.skills,
        trace: readTrace(db, header.id),
      };
    });
}

/** Synthetic current-format run insertion on a force-stopped fixture only. */
export function writeRun(db, value, launch) {
  const sequence =
    (db.prepare('SELECT sequence FROM run_counters WHERE id=1').get()?.sequence ?? 0) + 1;
  const {
    prompt,
    response,
    skillActivations,
    modelSnapshot: _model,
    agentSettingsSnapshot: _settings,
    mcpSnapshot: _mcp,
    skillsSnapshot: _skills,
    trace: _trace,
    children: _children,
    active: _active,
    ...fields
  } = value;
  const header = {
    ...fields,
    admissionSequence: sequence,
    revision: 1,
    promptPreview: prompt.slice(0, 300),
    responsePreview: response.slice(0, 1200),
    promptCharacters: prompt.length,
    responseCharacters: response.length,
    error: fields.error ? { code: 'UNKNOWN', message: fields.error } : undefined,
  };
  const active = ['completed', 'cancelled', 'failed', 'interrupted'].includes(header.state) ? 0 : 1;
  db.prepare('INSERT INTO run_headers VALUES (?,?,?,?,?,?,?,?,?)').run(
    header.id,
    sequence,
    header.projectId,
    header.conversationId,
    header.rootRunId,
    header.kind,
    active,
    1,
    JSON.stringify(header),
  );
  db.prepare('INSERT INTO run_inputs VALUES (?,?)').run(header.id, JSON.stringify({ prompt }));
  db.prepare('INSERT INTO run_results VALUES (?,?)').run(
    header.id,
    JSON.stringify({ response, skillActivations }),
  );
  db.prepare(
    'INSERT INTO run_counters VALUES (1,?) ON CONFLICT(id) DO UPDATE SET sequence=excluded.sequence',
  ).run(sequence);
  if (launch)
    db.prepare("INSERT OR REPLACE INTO records VALUES ('run-launches',?,?)").run(
      header.launchSnapshotRef,
      JSON.stringify({ ...launch, id: header.launchSnapshotRef }),
    );
}

export function readTrace(db, runId) {
  return db
    .prepare('SELECT payload FROM trace_nodes WHERE run_id=? ORDER BY run_sequence')
    .all(runId)
    .map(row => {
      const node = JSON.parse(row.payload);
      return node.kind === 'tool'
        ? node
        : {
            ...node,
            text: db
              .prepare('SELECT payload FROM trace_text_chunks WHERE node_id=? ORDER BY ordinal')
              .all(node.id)
              .map(chunk => JSON.parse(chunk.payload).text)
              .join(''),
          };
    });
}
export function writeTraceFixture(db, runId, rootRunId, text) {
  const id = runId + ':text';
  const node = {
    id,
    runId,
    rootRunId,
    runSequence: 1,
    groupSequence: 1,
    revision: 1,
    kind: 'text',
    round: 1,
    contentIndex: 0,
    startedAt: new Date().toISOString(),
    state: 'running',
    textPreview: text.slice(0, 200),
    textCharacters: text.length,
    textChunks: 1,
  };
  db.prepare('INSERT INTO trace_nodes VALUES (?,?,?,?,?)').run(
    id,
    runId,
    1,
    1,
    JSON.stringify(node),
  );
  db.prepare('INSERT INTO trace_text_chunks VALUES (?,?,?,?,?)').run(
    id,
    0,
    0,
    text.length,
    JSON.stringify({ nodeId: id, ordinal: 0, offset: 0, text, characters: text.length }),
  );
}
