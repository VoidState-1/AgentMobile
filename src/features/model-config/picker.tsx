import type { ModelsApi as ModelConfigurationService } from '@/application/services';
import { selectedModelId } from '@/core/models/rules';
import type { ModelConfiguration } from '@/core/models/types';
import { useWorkbenchTheme } from '@/shared/theme';
import { ActionRow } from '@/shared/ui/action-row';
import { EmptyState } from '@/shared/ui/empty-state';
import { Check } from '@/shared/ui/icons';
import { Button, Field, T } from '@/shared/ui/primitives';
import { ViewTabs } from '@/shared/ui/selection';
import { ModalFrame } from '@/shared/ui/sheets';
import { useAction } from '@/shared/use-action';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { ProviderIcon } from './provider-icon';

export function ModelPicker({
  service,
  configuration,
  projectId,
  conversationId,
  onClose,
  onManage,
}: {
  service: ModelConfigurationService;
  configuration: ModelConfiguration;
  projectId?: string;
  conversationId?: string;
  onClose: () => void;
  onManage: () => void;
}) {
  const theme = useWorkbenchTheme();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'favorite'>('all');
  const { busy, error, action } = useAction();
  const selected = selectedModelId(configuration, projectId, conversationId);
  const models = configuration.models
    .filter(
      model =>
        model.enabled &&
        configuration.connections.some(c => c.id === model.connectionId && c.enabled) &&
        model.capabilities.tools.support !== 'unsupported' &&
        (filter === 'all' || model.favorite) &&
        (
          model.name +
          model.apiId +
          configuration.connections.find(c => c.id === model.connectionId)?.name
        )
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.favorite) - Number(a.favorite) ||
        (configuration.recent.indexOf(a.id) < 0 ? 100 : configuration.recent.indexOf(a.id)) -
          (configuration.recent.indexOf(b.id) < 0 ? 100 : configuration.recent.indexOf(b.id)) ||
        a.name.localeCompare(b.name),
    );
  const change = (work: () => Promise<void>) =>
    action(async () => {
      await work();
      onClose();
    });
  return (
    <ModalFrame
      visible
      title="选择模型"
      size="list"
      onClose={onClose}
      busy={busy}
      footer={
        <View style={{ gap: 6 }}>
          {conversationId && configuration.defaults.sessions[conversationId] && (
            <Button
              label="使用项目或全局默认"
              compact
              variant="ghost"
              disabled={busy}
              onPress={() => {
                void change(() => service.setSelection('session', undefined, conversationId));
              }}
            />
          )}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="管理模型" style={{ flex: 1 }} disabled={busy} onPress={onManage} />
          </View>
        </View>
      }
    >
      <View style={{ padding: 12, gap: 8 }}>
        <Field
          label="搜索可用模型"
          hideLabel
          placeholder="模型或连接名称"
          value={search}
          onChangeText={setSearch}
        />
        <ViewTabs
          label="模型筛选"
          value={filter}
          options={[
            { value: 'all', label: '全部' },
            { value: 'favorite', label: '收藏', accessibilityLabel: '模型筛选：收藏' },
          ]}
          onChange={setFilter}
        />
        {!!error && (
          <T tone="danger" variant="caption">
            {error}
          </T>
        )}
      </View>
      <FlatList
        data={models}
        keyExtractor={item => item.id}
        style={{ flex: 1 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <EmptyState
            compact
            title={search || filter === 'favorite' ? '没有匹配的模型' : '暂无可用模型'}
          />
        }
        renderItem={({ item }) => {
          const connection = configuration.connections.find(c => c.id === item.connectionId);
          return (
            <ActionRow
              label={'选择模型 ' + (connection?.name ?? '') + ' · ' + item.name}
              title={(item.favorite ? '★ ' : '') + item.name}
              description={
                (connection?.name ?? '') +
                ' · ' +
                (item.capabilities.tools.support === 'unknown' ? '工具未验证' : '支持工具') +
                ' · ' +
                (item.parameters.allowImages ? '图片已开启' : '仅文字')
              }
              disabled={busy}
              leading={<ProviderIcon {...connection} size={24} />}
              selected={selected === item.id}
              trailing={selected === item.id ? <Check size={17} color={theme.accent} /> : undefined}
              onPress={() => {
                void change(() =>
                  service.setSelection(
                    conversationId ? 'session' : 'global',
                    item.id,
                    conversationId,
                  ),
                );
              }}
            />
          );
        }}
      />
    </ModalFrame>
  );
}
