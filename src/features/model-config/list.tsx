import { useEffect, useState } from 'react';
import { FlatList, Platform, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { providerPresets, protocolNames } from '@/core/models/presets';
import { Button, Field, T } from '@/shared/ui/primitives';
import { ChevronRight, Plus, ShieldCheck } from '@/shared/ui/icons';
import { useWorkbenchTheme } from '@/shared/theme/use-theme';
import { Choices, ConfigPage, Loading, Section, useConfiguration } from './common';

export function ConnectionList() {
  const controller = useConfiguration(); const { runtime, config, busy, error, action } = controller; const theme = useWorkbenchTheme(); const router = useRouter();
  const [search, setSearch] = useState(''); const [keys, setKeys] = useState<Record<string, boolean>>({}); const [adding, setAdding] = useState(false);
  useEffect(() => {
    let current = true;
    if (runtime) void Promise.all(config.connections.map(async (item) => [item.id, await runtime.models.keyReady(item.id)] as const))
      .then((entries) => { if (current) setKeys(Object.fromEntries(entries)); }).catch(() => {});
    return () => { current = false; };
  }, [runtime, config]);
  const defaultModel = config.models.find((model) => model.id === config.defaults.global);
  return <ConfigPage title="模型与供应商" subtitle={config.connections.length + ' 个连接 · ' + config.models.length + ' 个模型'}
    action={<Button label={adding ? '收起' : '添加连接'} icon={Plus} compact variant="secondary" onPress={() => setAdding(!adding)} />}>
    {!runtime ? <Loading /> : <FlatList keyboardShouldPersistTaps="handled" data={config.connections.filter((item) => (item.name + item.baseUrl).toLowerCase().includes(search.toLowerCase()))}
      keyExtractor={(item) => item.id} contentContainerStyle={{ padding: 18, gap: 10 }} ListHeaderComponent={<View style={{ gap: 16, marginBottom: 8 }}>
        <Section title="运行方式" hint="新的选择只影响下一次任务。">
          <Choices label="运行模式" value={config.mode} disabled={busy} options={[{ value: 'demo', label: '演示模式' }, { value: 'remote', label: '模型服务' }]}
            onChange={(mode) => { void action(() => runtime.models.setMode(mode)); }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ flex: 1 }}><T tone="secondary" style={{ fontSize: 11 }}>全局默认</T>
            <T style={{ fontSize: 13 }}>{defaultModel ? (config.connections.find((item) => item.id === defaultModel.connectionId)?.name ?? '') + ' · ' + defaultModel.name : config.defaults.global ? '所选模型已删除，请重新选择' : '尚未选择模型'}</T></View>
            {config.defaults.global && <Button label="清除默认" compact variant="ghost" disabled={busy} onPress={() => { void action(() => runtime.models.setSelection('global', undefined)); }} />}</View>
        </Section>
        {adding && <Section title="选择连接模板" hint="可创建多份同供应商连接，各自保存密钥。">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{providerPresets.map((preset) => <Button key={preset.id} label={preset.name} variant="secondary"
            onPress={() => router.push({ pathname: '/models/connection', params: { preset: preset.id } })} />)}</View>
        </Section>}
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}><ShieldCheck size={16} color={theme.secondary} />
          <T tone="secondary" style={{ fontSize: 11, flex: 1 }}>{Platform.OS === 'web' ? '浏览器密钥仅保留在当前页面会话，刷新后需补填；服务需要允许跨域。' : '凭证保存在设备安全存储，配置与检测保存在本地数据库。'}</T></View>
        {!!error && <T tone="danger">{error}</T>}
        {!!runtime.models.recoveryIssues.length && <T tone="warning">{runtime.models.recoveryIssues.join('\n')}</T>}
        <Field label="搜索连接" placeholder="名称或服务地址" value={search} onChangeText={setSearch} />
      </View>} ListEmptyComponent={<Section title={search ? '没有匹配的连接' : '添加第一个模型服务'}>
        <T tone="secondary">选择供应商模板，保存连接后可以发现模型，也可以手工添加。</T>
        {!search && <Button label="选择供应商" onPress={() => setAdding(true)} />}
      </Section>} renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={'打开连接 ' + item.name}
        onPress={() => router.push({ pathname: '/models/connection', params: { id: item.id } })}
        style={{ padding: 16, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, borderRadius: 11, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: theme.accentSoft, justifyContent: 'center', alignItems: 'center' }}>
          <T tone="accent" style={{ fontWeight: '700', fontSize: 16 }}>{item.name[0].toUpperCase()}</T></View>
        <View style={{ flex: 1 }}><T style={{ fontWeight: '600', fontSize: 14 }}>{item.name}</T>
          <T tone="muted" numberOfLines={1} style={{ fontSize: 11 }}>{item.baseUrl}</T>
          <T tone={!item.enabled || !keys[item.id] ? 'warning' : 'secondary'} style={{ fontSize: 11 }}>{protocolNames[item.protocol]} · {config.models.filter((m) => m.connectionId === item.id).length} 个模型 · {item.enabled ? keys[item.id] ? item.auth === 'none' ? '无需密钥' : '凭证已保存' : '需补填凭证' : '已停用'}</T>
        </View><ChevronRight size={17} color={theme.muted} />
      </Pressable>} />}
  </ConfigPage>;
}
