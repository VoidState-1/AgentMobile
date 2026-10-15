import type { MetadataStore } from '@/core/storage/contracts';
import type { ChangeProposal, ProposalWrite } from '@/core/runs/proposals';
import { AppError } from '@/core/errors';

export class ProposalRepository {
  constructor(private readonly store: MetadataStore) {
    if (!store.batch) throw new AppError('STORAGE', '提案仓库需要原子元数据批次能力。');
  }
  get(id: string) {
    return this.store.get<ChangeProposal>('change-proposals', id);
  }
  all() {
    return this.store.all<ChangeProposal>('change-proposals');
  }
  save(proposal: ChangeProposal) {
    return this.store.put('change-proposals', proposal.id, proposal);
  }
  write(id: string) {
    return this.store.get<ProposalWrite>('proposal-writes', id);
  }
  writes() {
    return this.store.all<ProposalWrite>('proposal-writes');
  }
  prepare(write: ProposalWrite) {
    return this.store.put('proposal-writes', write.id, write);
  }
  record(proposal: ChangeProposal, write: ProposalWrite) {
    return this.store.batch!([
      { bucket: 'change-proposals', id: proposal.id, value: proposal },
      { bucket: 'proposal-writes', id: write.id, value: write },
    ]);
  }
}
