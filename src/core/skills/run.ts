import type { SkillSummary, SkillResource } from './types';
import type { ToolResult } from '../agent/tools';

export interface LoadedSkill { name: string; revision: string; alreadyLoaded?: boolean; message?: string; instructions?: string; resources?: Pick<SkillResource, 'path' | 'kind'>[]; scope?: string }
export interface SkillRunPort {
  snapshots: readonly SkillSummary[];
  explicit: readonly string[];
  load(name: string): Promise<LoadedSkill>;
  read(name: string, path: string, offset: number, length: number, allowImages: boolean, signal?: AbortSignal): Promise<ToolResult>;
}
