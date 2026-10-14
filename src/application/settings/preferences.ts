import type { MetadataStore } from '@/core/storage/contracts';
import type { WorkbenchPreferences } from '@/core/preferences/types';

export class PreferencesService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly metadata: MetadataStore) {}
  getWorkbench = () => this.metadata.get<WorkbenchPreferences>('preferences', 'workbench');
  saveWorkbench(value: WorkbenchPreferences): Promise<void> {
    const copy = { ...value };
    const next = this.queue.catch(() => {}).then(() => this.metadata.put('preferences', 'workbench', copy));
    this.queue = next; return next;
  }
}
