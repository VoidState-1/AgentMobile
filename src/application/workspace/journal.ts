import { AppError } from '@/core/errors';
import type { BusinessStore } from '@/core/storage/business-store';
import type { GitPort } from '@/core/git/contracts';
import type { ContentCodec } from '@/core/storage/codec';
import type { MetadataEntry } from '@/core/storage/contracts';
import type {
  Operation,
  OperationBody,
  OperationDraft,
  OperationHeader,
  OperationQuery,
  JournalScope,
} from '@/core/workspace/journal';

export class OperationJournal {
  constructor(
    private readonly store: BusinessStore,
    readonly namespace: JournalScope['namespace'],
    private readonly git: GitPort,
    private readonly codec: ContentCodec,
  ) {}
  scope(projectId: string): JournalScope {
    return { namespace: this.namespace, projectId };
  }
  async prepare(
    draft: Omit<OperationDraft, 'schemaVersion' | 'scope' | 'changedPaths' | 'bodyFingerprint'> & {
      projectId: string;
    },
    body: OperationBody,
  ): Promise<Operation> {
    const { projectId, ...fields } = draft;
    const header = await this.store.prepareOperation(
      {
        ...fields,
        schemaVersion: 2,
        scope: this.scope(projectId),
        changedPaths: [
          ...new Set([...body.changes, ...(body.indexChanges ?? [])].map(change => change.path)),
        ],
        bodyFingerprint: await this.git.revision(this.codec.encodeText(JSON.stringify(body))),
      },
      body,
    );
    return { ...header, ...body };
  }
  async get(projectId: string, id: string): Promise<Operation | undefined> {
    const header = await this.store.operation(this.scope(projectId), id);
    return header && this.read(header);
  }
  async read(header: OperationHeader): Promise<Operation> {
    const body = await this.store.operationBody(header.scope, header.id);
    if (
      !body ||
      (await this.git.revision(this.codec.encodeText(JSON.stringify(body)))) !==
        header.bodyFingerprint
    )
      throw new AppError('STORAGE', '操作正文缺失或指纹不匹配，已暂停修改。');
    return { ...header, ...body };
  }
  async save(operation: Operation, metadata?: readonly MetadataEntry[]): Promise<void> {
    const {
      changes: _changes,
      indexChanges: _indexChanges,
      textEditFingerprint: _textEditFingerprint,
      ...header
    } = operation;
    const next = { ...header, revision: header.revision + 1 };
    await this.store.writeBusiness({
      operations: [{ header: next, expectedRevision: header.revision }],
      metadata,
    });
    operation.revision = next.revision;
  }
  list(query: Omit<OperationQuery, 'namespace'>) {
    return this.store.operations({ ...query, namespace: this.namespace });
  }
  async owned(projectId: string, ownerRootRunId: string): Promise<OperationHeader[]> {
    const result: OperationHeader[] = [];
    let beforeSequence: number | undefined;
    do {
      const page = await this.list({
        scope: this.scope(projectId),
        ownerRootRunId,
        beforeSequence,
        limit: 100,
      });
      result.push(...page);
      beforeSequence = page.length === 100 ? page.at(-1)!.sequence : undefined;
    } while (beforeSequence !== undefined);
    return result.filter(header => header.phase === 'recorded');
  }
}
