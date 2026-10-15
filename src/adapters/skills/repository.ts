import { AppError } from '@/core/errors';
import { Buffer } from 'buffer';
import type {
  SkillBundle,
  SkillRepository,
  SkillSummary,
  SkillVersion,
  SkillVersionPage,
} from '@/core/skills/types';
import { resourceKind, skillLimits, skillPath } from '@/core/skills/rules';
import type { WorkspaceApplication } from '@/application/workspace/service';
import { decodeSkillText, parseSkill, validateBundle } from './package';

const libraryId = 'agent-skills-library';
const prefix = (name: string) => 'skills/' + name + '/';
export class GitSkillRepository implements SkillRepository {
  constructor(readonly workspace: WorkspaceApplication) {}
  get recoveryRequired(): boolean {
    return this.workspace.needsRecovery(libraryId);
  }
  private revision(files: { path: string; revision: string }[]): Promise<string> {
    return this.workspace.git.revision(
      Buffer.from(JSON.stringify(files.map(file => [file.path, file.revision]).sort())),
    );
  }
  async initialize() {
    if (!(await this.workspace.projects()).length)
      await this.workspace.create('Agent Skills', libraryId);
    await this.workspace.recover();
  }
  private async at(commit: string) {
    const entries = (await this.workspace.git.entries(libraryId, commit)).filter(file =>
      file.path.startsWith('skills/'),
    );
    if (entries.length > skillLimits.libraryFiles)
      throw new AppError('VALIDATION', '技能库资源数量超过 4,096 项。');
    const skills: SkillSummary[] = [];
    const issues: string[] = [];
    for (const file of entries.filter(entry => /^skills\/[^/]+\/SKILL\.md$/.test(entry.path))) {
      const name = file.path.split('/')[1];
      try {
        const bytes = await this.workspace.git.readAt(libraryId, commit, file.path);
        if (bytes.length > skillLimits.instructionBytes)
          throw new AppError('VALIDATION', 'SKILL.md 超过 64 KB。');
        const metadata = parseSkill(decodeSkillText(bytes));
        if (metadata.name !== name) throw new AppError('VALIDATION', '目录名与技能名不一致。');
        const files = entries
          .filter(item => item.path.startsWith(prefix(name)))
          .map(item => ({
            path: skillPath(item.path.slice(prefix(name).length)),
            revision: item.revision,
            kind: resourceKind(item.path),
          }));
        const revision = await this.revision(files);
        const warnings = [
          files.some(item => item.path.startsWith('scripts/'))
            ? '包含脚本：本版本可阅读，不执行。'
            : '',
          metadata.allowedTools ? 'allowed-tools 不授予额外工具权限。' : '',
          metadata.compatibility ? '环境要求：' + metadata.compatibility : '',
        ].filter(Boolean);
        skills.push({ ...metadata, revision, commit, files, warnings });
      } catch {
        issues.push(name + ' 的 SKILL.md 或资源路径无效，未加入可用目录。');
      }
    }
    return {
      commit,
      skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
      issues: [
        ...(this.workspace.needsRecovery(libraryId)
          ? ['技能库修改需要恢复，已暂停写入；可用技能仍读取已提交版本。']
          : []),
        ...issues,
      ],
    };
  }
  snapshot = async () => this.at(await this.workspace.git.head(libraryId));
  async replace(bundles: SkillBundle[], remove: string[], expectedCommit: string, message: string) {
    if (this.workspace.needsRecovery(libraryId))
      throw new AppError('VALIDATION', '技能库需要恢复，请重新打开应用。');
    const validated = bundles.map(bundle => {
      const parsed = validateBundle(bundle.files);
      if (parsed.name !== bundle.name)
        throw new AppError('VALIDATION', '技能包名称与 SKILL.md 的 name 不一致。');
      return parsed;
    });
    if (new Set(validated.map(bundle => bundle.name)).size !== validated.length)
      throw new AppError('VALIDATION', '导入包中存在同名技能。');
    const entries = await this.workspace.git.entries(libraryId, expectedCommit);
    const touched = new Set([...validated.map(bundle => bundle.name), ...remove]);
    const replacements = validated.flatMap(bundle =>
      bundle.files.map(file => ({
        path: prefix(bundle.name) + file.path,
        bytes: file.bytes as Uint8Array | null,
      })),
    );
    if (
      replacements.some(file =>
        entries.some(
          entry => entry.path !== file.path && entry.path.toLowerCase() === file.path.toLowerCase(),
        ),
      )
    )
      throw new AppError('VALIDATION', '技能资源路径仅大小写变化暂不支持，请使用新名称。');
    const paths = new Set(replacements.map(file => file.path));
    const deleted = entries
      .filter(
        entry =>
          entry.path.startsWith('skills/') &&
          touched.has(entry.path.split('/')[1]) &&
          !paths.has(entry.path),
      )
      .map(entry => ({ path: entry.path, bytes: null }));
    if (
      entries.length -
        deleted.length +
        replacements.filter(file => !entries.some(entry => entry.path === file.path)).length >
      skillLimits.libraryFiles + 2
    )
      throw new AppError('VALIDATION', '技能库资源数量超过 4,096 项。');
    return this.workspace.saveSkillRevision(
      libraryId,
      [...replacements, ...deleted],
      expectedCommit,
      message,
    );
  }
  async read(commit: string, name: string, path: string) {
    return this.workspace.git.readAt(libraryId, commit, prefix(name) + skillPath(path));
  }
  async bundle(commit: string, name: string): Promise<SkillBundle> {
    const files = (await this.workspace.git.entries(libraryId, commit)).filter(entry =>
      entry.path.startsWith(prefix(name)),
    );
    return validateBundle(
      await Promise.all(
        files.map(async file => ({
          path: file.path.slice(prefix(name).length),
          bytes: await this.read(commit, name, file.path.slice(prefix(name).length)),
        })),
      ),
    );
  }
  async versions(name: string, cursor?: string, limit = 30): Promise<SkillVersionPage> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new AppError('VALIDATION', '技能版本每页需要 1–100 条。');
    const versions: SkillVersion[] = [];
    let previous = '';
    let gitCursor: string | undefined;
    if (cursor) {
      let position: { name: string; previous: string; gitCursor: string };
      try {
        position = JSON.parse(cursor);
      } catch {
        throw new AppError('CONFLICT', '技能版本游标无效。');
      }
      if (
        position.name !== name ||
        typeof position.previous !== 'string' ||
        typeof position.gitCursor !== 'string'
      )
        throw new AppError('CONFLICT', '技能版本游标不属于此技能。');
      previous = position.previous;
      gitCursor = position.gitCursor;
    }
    while (true) {
      // One commit at a time avoids discarding an unread suffix of a Git page.
      const page = await this.workspace.git.historyPage(libraryId, { cursor: gitCursor, limit: 1 });
      const version = page.versions[0];
      if (!version) return { versions };
      const entries = (await this.workspace.git.entries(libraryId, version.oid)).filter(file =>
        file.path.startsWith(prefix(name)),
      );
      const present = entries.some(file => file.path === prefix(name) + 'SKILL.md');
      const revision = present
        ? await this.revision(
            entries.map(file => ({
              path: skillPath(file.path.slice(prefix(name).length)),
              revision: file.revision,
            })),
          )
        : '';
      if (present && revision !== previous)
        versions.push({
          commit: version.oid,
          revision,
          message: version.message.split('\n')[0],
          timestamp: version.timestamp,
        });
      previous = revision;
      gitCursor = page.cursor;
      if (!gitCursor || versions.length === limit)
        return {
          versions,
          cursor: gitCursor ? JSON.stringify({ name, previous, gitCursor }) : undefined,
        };
    }
  }
}
