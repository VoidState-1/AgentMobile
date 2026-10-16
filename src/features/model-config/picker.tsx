import { useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ModelsApi as ModelConfigurationService } from '@/application/services';
import type { ModelConfiguration } from '@/core/models/types';
import { selectedModelId, selectedModelMode } from '@/core/models/rules';
import { Button, Field, IconButton, T } from '@/shared/ui/primitives';
import { Check, X } from '@/shared/ui/icons';
import { useWorkbenchTheme } from '@/shared/theme';
import { Choices } from './common';

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
  const inset = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'favorite'>('all');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = selectedModelId(configuration, projectId, conversationId);
  const mode = selectedModelMode(configuration, conversationId);
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
  const change = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '选择失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={() => {
        if (!busy) onClose();
      }}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'web' ? undefined : 'padding'}
        style={{
          flex: 1,
          backgroundColor: theme.overlay,
          justifyContent: width < 700 ? 'flex-end' : 'center',
          alignItems: 'center',
          padding: width < 700 ? 0 : 16,
        }}
      >
        <Pressable
          accessibilityLabel="关闭模型选择"
          disabled={busy}
          onPress={onClose}
          style={{ position: 'absolute', inset: 0 }}
        />
        <View
          style={{
            width: '100%',
            maxWidth: 560,
            height: Math.min(height * 0.86, 650),
            paddingBottom: Math.max(8, inset.bottom),
            borderRadius: 8,
            borderBottomLeftRadius: width < 700 ? 0 : 8,
            borderBottomRightRadius: width < 700 ? 0 : 8,
            backgroundColor: theme.surface,
            borderWidth: 1,
            borderColor: theme.border,
            overflow: 'hidden',
          }}
        >
          <View
            style={{
              paddingLeft: 12,
              paddingRight: 4,
              minHeight: 48,
              borderBottomWidth: 1,
              borderColor: theme.border,
              flexDirection: 'row',
              alignItems: 'center',
            }}
          >
            <View style={{ flex: 1 }}>
              <T accessibilityRole="header" style={{ fontWeight: '600', fontSize: 15 }}>
                选择模型
              </T>
            </View>
            <IconButton icon={X} label="关闭" disabled={busy} onPress={onClose} />
          </View>
          <View style={{ padding: 12, gap: 8 }}>
            <Field
              label="搜索可用模型"
              hideLabel
              placeholder="模型或连接名称"
              value={search}
              onChangeText={setSearch}
            />
            <Choices
              label="模型筛选"
              value={filter}
              options={[
                { value: 'all', label: '全部' },
                { value: 'favorite', label: '收藏' },
              ]}
              onChange={setFilter}
            />
            {!!error && (
              <T tone="danger" style={{ fontSize: 12 }}>
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
              <T tone="muted" style={{ padding: 20, fontSize: 12 }}>
                {search || filter === 'favorite' ? '没有匹配的模型' : '暂无可用模型'}
              </T>
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  '选择模型 ' +
                  (configuration.connections.find(c => c.id === item.connectionId)?.name ?? '') +
                  ' · ' +
                  item.name
                }
                disabled={busy}
                onPress={() => {
                  void change(() =>
                    service.setSelection(
                      conversationId ? 'session' : 'global',
                      item.id,
                      conversationId,
                    ),
                  );
                }}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  minHeight: 52,
                  flexDirection: 'row',
                  gap: 10,
                  alignItems: 'center',
                  backgroundColor:
                    mode === 'remote' && selected === item.id ? theme.accentSoft : theme.surface,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.border,
                }}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T style={{ fontSize: 13, fontWeight: '500' }}>
                    {item.favorite ? '★ ' : ''}
                    {item.name}
                  </T>
                  <T tone="secondary" style={{ fontSize: 11 }}>
                    {configuration.connections.find(c => c.id === item.connectionId)?.name} ·{' '}
                    {item.capabilities.tools.support === 'unknown' ? '工具未验证' : '支持工具'} ·{' '}
                    {item.parameters.allowImages ? '图片已开启' : '仅文字'}
                  </T>
                </View>
                {mode === 'remote' && selected === item.id && (
                  <Check size={17} color={theme.accent} />
                )}
              </Pressable>
            )}
          />
          <View
            style={{
              paddingHorizontal: 12,
              paddingTop: 8,
              gap: 6,
              borderTopWidth: 1,
              borderColor: theme.border,
            }}
          >
            {conversationId &&
              (configuration.defaults.sessions[conversationId] ||
                configuration.sessionModes?.[conversationId]) && (
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
              <Button
                label="演示模式"
                variant="secondary"
                disabled={busy}
                style={{ flex: 1 }}
                onPress={() => {
                  void change(() => service.setMode('demo', conversationId));
                }}
              />
              <Button label="管理模型" style={{ flex: 1 }} disabled={busy} onPress={onManage} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
