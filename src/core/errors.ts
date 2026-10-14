export type AppErrorCode = 'VALIDATION' | 'CONFLICT' | 'CANCELLED' | 'STORAGE' | 'REMOTE' | 'UNKNOWN';

/** Only these public fields cross the application boundary. No native cause is retained. */
export class AppError extends Error {
  constructor(readonly code: AppErrorCode, message: string, readonly uncertain = false) {
    super(message); this.name = 'AppError';
  }
}

export function publicError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : '';
  const safe = /^(INVALID_PATH|VERSION_CONFLICT|工作区|项目配置|文件超过|文本超过|目标文件|操作 ID|历史已|恢复未|请|请输入|暂存区|提交说明|技能|SKILL\.md|ZIP|已有技能|系统提示词|模型|连接|服务|此连接|此配置|当前|任务|单次|历史任务|达到|MCP|端点|工具定义|特殊名称|单个项目|检测|所选|图片|凭证|输入|不支持|只允许|同一个|Gemini)/.test(message);
  return safe ? new AppError(message.startsWith('VERSION_CONFLICT') ? 'CONFLICT' : 'VALIDATION', message) :
    new AppError('STORAGE', '本地操作失败，请重试或重新打开应用恢复。');
}
