import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ConfigPage, FormScroll, Loading, Section } from '@/shared/ui/forms';
import { Button, T } from '@/shared/ui/primitives';
import { ChevronRight, Plug } from '@/shared/ui/icons';
import { useWorkbenchTheme } from '@/shared/theme';
import { useWorkbenchUi } from '@/shared/workbench-state';
import { useMcpConfiguration } from './common';
import { UnknownCalls } from './unknown';

export function McpPage() {
  const { runtime, config, error } = useMcpConfiguration();
  const router = useRouter();
  const theme = useWorkbenchTheme();
  const selectedProject = useWorkbenchUi(state => state.projectId);
  const [storedProject, setStoredProject] = useState<string>();
  const projectId = selectedProject ?? storedProject;
  useEffect(() => {
    let current = true;
    if (!selectedProject && runtime)
      void runtime.preferences
        .getWorkbench()
        .then(value => {
          if (current) setStoredProject(value?.projectId);
        })
        .catch(() => {});
    return () => {
      current = false;
    };
  }, [runtime, selectedProject]);
  return (
    <ConfigPage
      title="远程 MCP"
      subtitle={config.servers.length + ' 个连接'}
      action={
        <Button label="添加连接" variant="secondary" onPress={() => router.push('/mcp/server')} />
      }
    >
      {!runtime ? (
        <Loading />
      ) : (
        <FormScroll>
          <Section title="服务器">
            {!config.servers.length && (
              <T tone="secondary" style={{ fontSize: 13 }}>
                暂无连接
              </T>
            )}
            {config.servers.map(server => {
              const allowed = Object.keys(config.grants[projectId ?? '']?.[server.id] ?? {}).length;
              return (
                <Pressable
                  key={server.id}
                  accessibilityRole="button"
                  accessibilityLabel={'配置 MCP ' + server.name}
                  onPress={() =>
                    router.push({ pathname: '/mcp/server', params: { id: server.id } })
                  }
                  style={({ pressed }) => ({
                    borderBottomWidth: 1,
                    borderColor: theme.border,
                    paddingVertical: 9,
                    minHeight: 64,
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: pressed ? theme.inset : 'transparent',
                    gap: 9,
                  })}
                >
                  <Plug size={18} color={server.enabled ? theme.accent : theme.muted} />
                  <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <T numberOfLines={1} style={{ flex: 1, fontWeight: '600', fontSize: 14 }}>
                        {server.name}
                      </T>
                      <T tone={server.enabled ? 'accent' : 'muted'} style={{ fontSize: 11 }}>
                        {server.enabled ? '已启用' : '已停用'}
                      </T>
                    </View>
                    <T tone="muted" numberOfLines={1} style={{ fontSize: 11 }}>
                      {server.url}
                    </T>
                    <T
                      tone={server.check?.status === 'failed' ? 'danger' : 'secondary'}
                      style={{ fontSize: 11 }}
                    >
                      {server.check?.message ?? '尚未检测'} · 当前项目授权 {allowed} 个工具
                    </T>
                  </View>
                  <ChevronRight size={15} color={theme.muted} />
                </Pressable>
              );
            })}
          </Section>
          <UnknownCalls runtime={runtime} />
          {!!error && <T tone="danger">{error}</T>}
        </FormScroll>
      )}
    </ConfigPage>
  );
}
