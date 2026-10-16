import { AppError } from '@/core/errors';
import { providerPresets } from './presets';
import type { ProviderConnection } from './types';

export const providerKey = (id: string) => 'preset:' + id;
export const connectionKey = (id: string) => 'connection:' + id;

export function providerKeys(connections: readonly ProviderConnection[]): string[] {
  return [
    ...providerPresets
      .filter(preset => preset.id !== 'custom')
      .map(preset => providerKey(preset.id)),
    ...connections
      .filter(connection => connection.presetId === 'custom')
      .map(connection => connectionKey(connection.id)),
  ];
}

export function orderedProviderKeys(
  order: readonly string[],
  connections: readonly ProviderConnection[],
): string[] {
  const available = new Set(providerKeys(connections));
  return [...new Set([...order.filter(key => available.has(key)), ...available])];
}

/** Reordering filtered rows must leave every hidden row in its original slot. */
export function mergeVisibleProviderOrder(
  order: readonly string[],
  visible: readonly string[],
): string[] {
  const selected = new Set(visible);
  if (selected.size !== visible.length || visible.some(key => !order.includes(key)))
    throw new AppError('CONFLICT', '供应商列表已变化，请重新拖拽排序。');
  let index = 0;
  return order.map(key => (selected.has(key) ? visible[index++] : key));
}
