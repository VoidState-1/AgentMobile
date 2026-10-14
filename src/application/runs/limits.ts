import type { AgentLimits } from '@/core/agent/settings';

export class RunLimitsTracker {
  private rounds = 0;
  private calls = 0;
  error?: string;
  constructor(private readonly limits: AgentLimits) {}
  beforeRequest = () => {
    if (++this.rounds > this.limits.maxModelRounds) {
      this.error = '达到模型请求上限（' + this.limits.maxModelRounds + ' 轮），可在 Agent 设置中提高。已完成的修改已保留。';
      throw new Error(this.error);
    }
  };
  beforeTool = async () => {
    if (++this.calls <= this.limits.maxToolCalls) return;
    this.error = '达到工具调用上限（' + this.limits.maxToolCalls + ' 次），可在 Agent 设置中提高。已完成的修改已保留。';
    return { block: true, reason: this.error, terminate: true };
  };
  timeout() { this.error = '达到任务总时长上限（' + this.limits.maxRuntimeMs / 60_000 + ' 分钟），可在 Agent 设置中提高。已完成的修改已保留。'; }
}
