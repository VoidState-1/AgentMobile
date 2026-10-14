import { AppError } from '../errors';
export class ProtocolError extends AppError {
  constructor(message: string) { super('REMOTE', message); }
}

/** Only host-authored messages cross into task logs; never echo provider bodies. */
export class ModelServiceError extends Error {
  constructor(status: number) {
    const messages: Record<number, string> = {
      400: '模型服务拒绝了请求（HTTP 400），请检查模型名称、图片输入和工具调用支持。',
      401: 'API Key 无效或已过期（HTTP 401），请在设置中更新密钥。',
      402: '模型账户余额不足（HTTP 402），请充值后重试。',
      403: '当前密钥没有访问此模型的权限（HTTP 403）。',
      404: '服务地址或模型不存在（HTTP 404），请检查设置。',
      429: '模型请求过于频繁（HTTP 429），请稍后重试。',
    };
    super(messages[status] ?? (status >= 500 ? '模型服务暂不可用（HTTP ' + status + '），请稍后重试。' :
      '模型服务返回 HTTP ' + status + '，请检查连接设置。'));
  }
}
