import { SerialQueue } from '@/core/serial-queue';
import { AppError } from '@/core/errors';
import type { MetadataStore } from '@/core/storage/contracts';
import { defaultAgentSettings, validateAgentSettings, type AgentSettings } from '@/core/agent/settings';

const frozenCopy = (value: AgentSettings): AgentSettings => Object.freeze({ ...value, limits: Object.freeze({ ...value.limits }) });

/** SQLite metadata owns settings; each task captures an immutable revision. */
export class AgentSettingsService {
  private state = frozenCopy(defaultAgentSettings());
  private readonly queue = new SerialQueue();
  constructor(private readonly metadata: MetadataStore) {}
  getSnapshot = (): AgentSettings => this.state;
  async initialize(): Promise<void> {
    const saved = await this.metadata.get<AgentSettings>('settings', 'agent');
    if (saved) {
      if (saved.schemaVersion !== 1) throw new AppError('STORAGE', 'Agent 设置格式需要更新应用后读取。');
      validateAgentSettings(saved); this.state = frozenCopy(saved);
    }
  }
  async save(input: Pick<AgentSettings, 'systemPrompt' | 'limits'>, expectedRevision: number): Promise<AgentSettings> {
    const value = { ...input, limits: { ...input.limits } };
    const work = async () => {
      if (expectedRevision !== this.state.revision) throw new AppError('CONFLICT', 'Agent 设置已变化，请重新打开设置后编辑。');
      validateAgentSettings(value);
      const next: AgentSettings = { ...value, schemaVersion: 1, revision: this.state.revision + 1 };
      await this.metadata.put('settings', 'agent', next); this.state = frozenCopy(next); return this.state;
    };
    return this.queue.run(work);
  }
}
