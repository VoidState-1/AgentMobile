import { SerialQueue } from '@/core/serial-queue';
import type { MetadataStore } from '@/core/storage/contracts';
import type { WorkbenchPreferences } from '@/core/preferences';

export class PreferencesService {
  private readonly queue = new SerialQueue();
  constructor(private readonly metadata: MetadataStore) {}
  getWorkbench = () => this.metadata.get<WorkbenchPreferences>('preferences', 'workbench');
  saveWorkbench(value: WorkbenchPreferences): Promise<void> {
    const copy = { ...value };
    return this.queue.run(() => this.metadata.put('preferences', 'workbench', copy));
  }
}
