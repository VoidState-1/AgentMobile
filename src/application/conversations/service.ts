import { cloneJsonDto as clone, freezeJsonDto as freeze } from '@/core/json-dto';
import { SerialQueue } from '@/core/serial-queue';
import { AppError } from '@/core/errors';
import { Signal } from '@/core/signal';
import type { MetadataStore } from '@/core/storage/contracts';
import type { Project } from '@/core/projects';
import { safePath } from '@/core/workspace/path';
import { contentLimits } from '@/core/agent/settings';
import {
  emptyConversationState,
  type Conversation,
  type ConversationDraft,
  type ConversationState,
} from '@/core/conversations/types';

const titleOf = (value: string) => value.trim().replace(/\s+/g, ' ').slice(0, 32) || '新对话';

/** Conversations and drafts are metadata; project files and Git remain shared. */
export class ConversationService {
  private state = freeze(emptyConversationState());
  private readonly queue = new SerialQueue();
  private readonly signal = new Signal();
  private runs = new Map<string, number>();
  constructor(
    private metadata: MetadataStore,
    private id: () => string,
    private now = () => new Date().toISOString(),
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => this.signal.subscribe(listener);
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    return this.queue.run(work);
  }
  private async persist(next: ConversationState) {
    next.revision = this.state.revision + 1;
    await this.metadata.put('conversations', 'state', next);
    this.state = freeze(clone(next));
    this.signal.publish();
  }
  private add(next: ConversationState, projectId: string): Conversation {
    const id = this.id();
    const title = '新对话';
    const time = this.now();
    const conversation: Conversation = {
      id,
      projectId,
      title,
      titleSource: 'auto',
      createdAt: time,
      updatedAt: time,
    };
    next.conversations.push(conversation);
    next.drafts[id] = { text: '', revision: 0 };
    next.selected[projectId] = id;
    return conversation;
  }
  private require(
    next: ConversationState,
    id: string,
    projectId?: string,
    allowArchived = false,
  ): Conversation {
    const value = next.conversations.find(
      item => item.id === id && (!projectId || item.projectId === projectId),
    );
    if (!value || (!allowArchived && value.archivedAt))
      throw new AppError('VALIDATION', '对话不存在或已归档，请重新选择。');
    return value;
  }
  async initialize(
    projects: Project[],
    acceptedDraft: (
      projectId: string,
      conversationId: string,
      revision: number,
    ) => Promise<boolean> = async () => false,
  ): Promise<void> {
    await this.exclusive(async () => {
      const stored = await this.metadata.get<ConversationState>('conversations', 'state');
      if (stored && stored.schemaVersion !== 1)
        throw new AppError('STORAGE', '对话数据格式不匹配，请重建开发实例。');
      this.state = freeze(clone(stored ?? emptyConversationState()));
      const next = clone(this.state);
      const projectIds = new Set(projects.map(project => project.id));
      for (const conversation of next.conversations) {
        if (!projectIds.has(conversation.projectId))
          throw new AppError('STORAGE', '对话引用了不存在的项目。');
        const draft = next.drafts[conversation.id];
        if (
          draft &&
          (draft.text || draft.attachment) &&
          (await acceptedDraft(conversation.projectId, conversation.id, draft.revision))
        )
          next.drafts[conversation.id] = { text: '', revision: draft.revision + 1 };
      }
      for (const project of projects) {
        const open = next.conversations.filter(
          item => item.projectId === project.id && !item.archivedAt,
        );
        if (!open.length) this.add(next, project.id);
        else if (!open.some(item => item.id === next.selected[project.id]))
          next.selected[project.id] = open[0].id;
      }
      if (!stored || JSON.stringify(next) !== JSON.stringify(this.state)) await this.persist(next);
    });
  }
  async ensureProject(projectId: string): Promise<Conversation> {
    return this.exclusive(async () => {
      const open = this.state.conversations.filter(
        item => item.projectId === projectId && !item.archivedAt,
      );
      const selected = open.find(item => item.id === this.state.selected[projectId]) ?? open[0];
      if (selected) return selected;
      if (!(await this.metadata.get<Project>('projects', projectId)))
        throw new AppError('VALIDATION', '项目不存在。');
      const next = clone(this.state);
      const conversation = this.add(next, projectId);
      await this.persist(next);
      return freeze(clone(conversation));
    });
  }
  async create(projectId: string): Promise<Conversation> {
    return this.exclusive(async () => {
      if (!(await this.metadata.get<Project>('projects', projectId)))
        throw new AppError('VALIDATION', '项目不存在。');
      const next = clone(this.state);
      const conversation = this.add(next, projectId);
      await this.persist(next);
      return freeze(clone(conversation));
    });
  }
  async select(id: string, projectId: string): Promise<void> {
    await this.exclusive(async () => {
      const next = clone(this.state);
      this.require(next, id, projectId);
      next.selected[projectId] = id;
      await this.persist(next);
    });
  }
  async rename(id: string, title: string): Promise<void> {
    const name = title.trim();
    if (!name || name.length > 60) throw new AppError('VALIDATION', '对话名称需要 1–60 个字符。');
    await this.exclusive(async () => {
      const next = clone(this.state);
      const item = this.require(next, id);
      item.title = name;
      item.titleSource = 'manual';
      await this.persist(next);
    });
  }
  async archive(id: string): Promise<void> {
    await this.exclusive(async () => {
      if (this.runs.has(id))
        throw new AppError('CONFLICT', '此对话正在运行任务，请停止或等待完成后归档。');
      const next = clone(this.state);
      const item = this.require(next, id);
      item.archivedAt = this.now();
      if (next.selected[item.projectId] === id) {
        const other = next.conversations.find(c => c.projectId === item.projectId && !c.archivedAt);
        if (other) next.selected[item.projectId] = other.id;
        else this.add(next, item.projectId);
      }
      await this.persist(next);
    });
  }
  async restore(id: string): Promise<void> {
    await this.exclusive(async () => {
      const next = clone(this.state);
      const item = this.require(next, id, undefined, true);
      delete item.archivedAt;
      next.selected[item.projectId] = id;
      await this.persist(next);
    });
  }
  async saveDraft(
    id: string,
    input: Omit<ConversationDraft, 'revision'>,
  ): Promise<ConversationDraft> {
    return this.exclusive(async () => {
      if (input.text.length > contentLimits.promptCharacters)
        throw new AppError('LIMIT', '对话草稿最多 16,000 字符。');
      if (input.attachment) safePath(input.attachment);
      const next = clone(this.state);
      this.require(next, id);
      const previous = next.drafts[id] ?? { text: '', revision: 0 };
      if (previous.text === input.text && previous.attachment === input.attachment) return previous;
      const draft = { ...input, revision: previous.revision + 1 };
      next.drafts[id] = draft;
      await this.persist(next);
      return freeze(clone(draft));
    });
  }
  async acknowledgeSubmission(id: string, revision?: number): Promise<void> {
    if (revision === undefined) return;
    await this.exclusive(async () => {
      const draft = this.state.drafts[id];
      if (draft?.revision !== revision || (!draft.text && !draft.attachment)) return;
      const next = clone(this.state);
      next.drafts[id] = { text: '', revision: revision + 1 };
      await this.persist(next);
    });
  }
  async acquireRun(
    id: string,
    projectId: string,
    prompt: string,
  ): Promise<{ conversation: Conversation; release(): void }> {
    return this.exclusive(async () => {
      if (this.runs.has(id)) throw new AppError('CONFLICT', '此对话已有运行中的任务。');
      const next = clone(this.state);
      const conversation = this.require(next, id, projectId);
      conversation.updatedAt = this.now();
      if (conversation.titleSource === 'auto' && conversation.title === '新对话')
        conversation.title = titleOf(prompt);
      await this.persist(next);
      this.runs.set(id, (this.runs.get(id) ?? 0) + 1);
      let released = false;
      return {
        conversation: freeze(clone(conversation)),
        release: () => {
          if (released) return;
          released = true;
          const count = (this.runs.get(id) ?? 1) - 1;
          if (count) this.runs.set(id, count);
          else this.runs.delete(id);
        },
      };
    });
  }
}
