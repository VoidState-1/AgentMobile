import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ConfigPage, FormScroll, Loading, Section } from '@/shared/ui/forms';
import { Button, T } from '@/shared/ui/primitives';
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
      subtitle="连接服务，为当前项目选择工具"
      action={
        <Button label="添加连接" variant="secondary" onPress={() => router.push('/mcp/server')} />
      }
    >
      {!runtime ? (
        <Loading />
      ) : (
        <FormScroll>
          <Section
            title="服务器"
            hint="使用完整的 Streamable HTTP 端点，例如 https://example.com/mcp。"
          >
            {!config.servers.length && (
              <T tone="secondary" style={{ fontSize: 13 }}>
                还没有 MCP 连接。添加服务器后，检测并选择允许 Agent 调用的工具。
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
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: 9,
                    padding: 12,
                    gap: 5,
                  }}
                >
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <T style={{ flex: 1, fontWeight: '600', fontSize: 13 }}>{server.name}</T>
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
                </Pressable>
              );
            })}
          </Section>
          <UnknownCalls runtime={runtime} />
          <Section title="使用范围">
            <T tone="secondary" style={{ fontSize: 12, lineHeight: 21 }}>
              MCP
              服务器运行在远端，手机负责连接和调用。工具默认关闭，按项目授权，同一项目的各个对话共享授权。任务启动后使用固定配置，演示模式不会调用远端服务。
            </T>
            <T tone="muted" style={{ fontSize: 11, lineHeight: 20 }}>
              首版支持无需认证与 Bearer Token。OAuth、stdio、资源和 Prompt 浏览、MCP Apps
              尚未实现。浏览器预览还需要服务器允许跨域。
            </T>
          </Section>
          {!!error && <T tone="danger">{error}</T>}
        </FormScroll>
      )}
    </ConfigPage>
  );
}
