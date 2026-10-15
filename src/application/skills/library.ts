import { cloneJsonDto as clone, freezeJsonDto as freeze } from '@/core/json-dto';
import { SerialQueue } from '@/core/serial-queue';
import { AppError } from '@/core/errors';
import { Signal } from '@/core/signal';
import type { MetadataStore } from '@/core/storage/contracts';
import {
  emptySkillConfiguration,
  type SkillBundle,
  type SkillConfiguration,
  type SkillRepository,
} from '@/core/skills/types';
import { explicitSkills, skillLimits, validateSkillMetadata } from '@/core/skills/rules';

export class SkillService {
  private state = freeze(emptySkillConfiguration());
  private readonly queue = new SerialQueue();
  private readonly signal = new Signal();
  private unsettled = false;
  constructor(
    private metadata: MetadataStore,
    readonly repository: SkillRepository,
  ) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => this.signal.subscribe(listener);
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    return this.queue.run(work);
  }
  private async persist(value: SkillConfiguration) {
    value.revision = this.state.revision + 1;
    await this.metadata.put('skills', 'configuration', value);
    this.state = freeze(clone(value));
    this.signal.publish();
  }
  async initialize() {
    await this.exclusive(async () => {
      const saved = await this.metadata.get<SkillConfiguration>('skills', 'configuration');
      if (saved) {
        if (saved.schemaVersion !== 1)
          throw new AppError('STORAGE', '技能配置格式不匹配，请重建开发实例。');
        this.state = freeze(clone(saved));
      }
      await this.repository.initialize();
      await this.reconcile();
    });
  }
  private async reconcile() {
    const snapshot = await this.repository.snapshot();
    const next = { ...clone(this.state), ...snapshot };
    for (const grants of Object.values(next.grants))
      for (const [name, revision] of Object.entries(grants)) {
        if (!next.skills.some(skill => skill.name === name && skill.revision === revision))
          delete grants[name];
      }
    await this.persist(next);
    this.unsettled = false;
  }
  private ready() {
    if (this.unsettled)
      throw new AppError('STORAGE', '技能库修改尚未完成，请重新打开应用恢复后再操作。');
  }
  private saveFailed(error: unknown, message: string): never {
    if (
      error instanceof AppError &&
      ['VALIDATION', 'CONFLICT', 'LIMIT'].includes(error.code) &&
      !this.repository.recoveryRequired
    ) {
      this.unsettled = false;
      throw error;
    }
    // A Git/file effect or its metadata receipt may already exist. Keep admission
    // closed even when the underlying failure has a safe, typed message.
    throw new AppError('STORAGE', message);
  }
  async install(bundles: SkillBundle[], expectedCommit: string) {
    return this.exclusive(async () => {
      this.ready();
      if (expectedCommit !== this.state.commit)
        throw new AppError('CONFLICT', '技能库已变化，请重新预览后导入。');
      bundles.forEach(validateSkillMetadata);
      if (
        new Set([
          ...this.state.skills.map(skill => skill.name),
          ...bundles.map(skill => skill.name),
        ]).size > skillLimits.installed
      )
        throw new AppError('VALIDATION', '技能库最多安装 128 个技能。');
      this.unsettled = true;
      try {
        await this.repository.replace(
          bundles,
          [],
          expectedCommit,
          '安装或更新技能 ' + bundles.map(skill => skill.name).join('、'),
        );
        await this.reconcile();
      } catch (error) {
        this.saveFailed(error, '技能保存未完成，请保留数据并重新打开应用恢复。');
      }
    });
  }
  async remove(name: string, expectedCommit: string) {
    return this.exclusive(async () => {
      this.ready();
      if (expectedCommit !== this.state.commit)
        throw new AppError('CONFLICT', '技能库已变化，请重新打开后删除。');
      this.unsettled = true;
      try {
        await this.repository.replace([], [name], expectedCommit, '删除技能 ' + name);
        await this.reconcile();
      } catch (error) {
        this.saveFailed(error, '技能删除未完成，请重新打开应用恢复。');
      }
    });
  }
  async grant(projectId: string, name: string, allow: boolean, revision: string) {
    return this.exclusive(async () => {
      this.ready();
      const skill = this.state.skills.find(skill => skill.name === name);
      if (!skill || skill.revision !== revision)
        throw new AppError('VALIDATION', '技能版本已变化，请重新查看后启用。');
      if (['__proto__', 'prototype', 'constructor'].includes(projectId))
        throw new AppError('VALIDATION', '技能项目标识无效。');
      const next = clone(this.state);
      next.grants[projectId] ??= {};
      if (allow) next.grants[projectId][name] = revision;
      else delete next.grants[projectId][name];
      if (Object.keys(next.grants[projectId]).length > skillLimits.enabled)
        throw new AppError('VALIDATION', '单项目最多启用 64 个技能。');
      await this.persist(next);
    });
  }
  async capture(projectId: string, prompt: string) {
    return this.exclusive(async () => {
      this.ready();
      const skills = this.state.skills.filter(
        skill => this.state.grants[projectId]?.[skill.name] === skill.revision,
      );
      const explicit = explicitSkills(
        prompt,
        this.state.skills.map(skill => skill.name),
      );
      for (const name of explicit)
        if (!skills.some(skill => skill.name === name))
          throw new AppError(
            'VALIDATION',
            '技能 $' + name + ' 尚未在此项目启用，请先在 Agent Skills 中启用。',
          );
      return freeze({ skills: clone(skills), explicit });
    });
  }
}
