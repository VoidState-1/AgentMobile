export interface SkillMetadata {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string;
}
export interface SkillResource {
  path: string;
  revision: string;
  kind: 'text' | 'image' | 'binary';
}
export interface SkillSummary extends SkillMetadata {
  revision: string;
  commit: string;
  files: SkillResource[];
  warnings: string[];
}
export interface SkillBundle extends SkillMetadata {
  files: { path: string; bytes: Uint8Array }[];
  warnings: string[];
}
export interface SkillLibrarySnapshot {
  commit: string;
  skills: SkillSummary[];
  issues: string[];
}
export interface SkillConfiguration extends SkillLibrarySnapshot {
  schemaVersion: 1;
  revision: number;
  grants: Record<string, Record<string, string>>;
}
export interface SkillVersion {
  commit: string;
  revision: string;
  message: string;
  timestamp: number;
}
export interface SkillVersionPage {
  versions: SkillVersion[];
  cursor?: string;
}
export interface SkillRepository {
  readonly recoveryRequired: boolean;
  initialize(): Promise<void>;
  snapshot(): Promise<SkillLibrarySnapshot>;
  replace(
    bundles: SkillBundle[],
    remove: string[],
    expectedCommit: string,
    message: string,
  ): Promise<string>;
  read(commit: string, name: string, path: string): Promise<Uint8Array>;
  versions(name: string, cursor?: string, limit?: number): Promise<SkillVersionPage>;
  bundle(commit: string, name: string): Promise<SkillBundle>;
}
export const emptySkillConfiguration = (): SkillConfiguration => ({
  schemaVersion: 1,
  revision: 0,
  commit: '',
  skills: [],
  issues: [],
  grants: {},
});
