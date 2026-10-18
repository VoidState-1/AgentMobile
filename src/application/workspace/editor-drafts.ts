import { AppError } from '@/core/errors';
import type { MetadataStore } from '@/core/storage/contracts';
import type { EditorDraft, EditorDraftRecord } from '@/core/documents/state';
import { validateEditorState } from '@/core/documents/state';
import { safePath } from '@/core/workspace/path';
import { SerialQueue } from '@/core/serial-queue';

/** Metadata only. Saving a draft never mutates the working tree or Git. */
export class EditorDrafts {
  private readonly queue = new SerialQueue();
  constructor(
    private store: MetadataStore,
    private projects: string,
  ) {}
  private async key(projectId: string, path: string) {
    if (!(await this.store.get(this.projects, projectId)))
      throw new AppError('VALIDATION', '项目不存在。');
    return projectId + '/' + safePath(path);
  }
  async get(projectId: string, path: string): Promise<EditorDraftRecord> {
    const value = await this.store.get<EditorDraftRecord>(
      'editor-drafts',
      await this.key(projectId, path),
    );
    if (!value) return { revision: 0, draft: null };
    if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !('draft' in value))
      throw new AppError('STORAGE', '文件草稿格式不匹配，请重建开发实例。');
    if (value.draft) this.validate(value.draft);
    return value;
  }
  private validate(draft: EditorDraft) {
    if (
      draft.format !== 1 ||
      typeof draft.name !== 'string' ||
      typeof draft.fresh !== 'boolean' ||
      (draft.baseRevision !== null && typeof draft.baseRevision !== 'string') ||
      !['\n', '\r\n', '\r'].includes(draft.lineEnding) ||
      draft.name.length > 1024 ||
      draft.name.includes('\0')
    )
      throw new AppError('VALIDATION', '文件草稿无效。');
    validateEditorState(draft.state);
    if (draft.pendingSave) {
      validateEditorState(draft.pendingSave);
      if (draft.pendingSave.text !== draft.state.text)
        throw new AppError('VALIDATION', '保存意图与草稿不一致。');
      if (
        !draft.saveOperationId ||
        !/^[\w-]{1,100}$/.test(draft.saveOperationId) ||
        !draft.savePath
      )
        throw new AppError('VALIDATION', '保存意图无效。');
      safePath(draft.savePath);
    }
  }
  save(
    projectId: string,
    path: string,
    draft: EditorDraft | null,
    expectedRevision: number,
  ): Promise<EditorDraftRecord> {
    return this.queue.run(async () => {
      const key = await this.key(projectId, path);
      const current = await this.get(projectId, path);
      if (current.revision !== expectedRevision)
        throw new AppError('CONFLICT', '文件草稿已变化，请重新打开。');
      if (draft) this.validate(draft);
      const next = { revision: current.revision + 1, draft };
      // Keep a revision tombstone so a delayed write cannot resurrect a discarded draft.
      await this.store.put('editor-drafts', key, next);
      return next;
    });
  }
}
