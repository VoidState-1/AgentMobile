import { useWorkbenchTheme } from '@/shared/theme';
import { ActionRow } from '@/shared/ui/action-row';
import { EmptyState } from '@/shared/ui/empty-state';
import { Feedback } from '@/shared/ui/feedback';
import { ConfigPage, FormScroll, Loading, Section } from '@/shared/ui/forms';
import { ChevronRight, Plug, Plus } from '@/shared/ui/icons';
import { T, ToolbarAction } from '@/shared/ui/primitives';
import { useProjectSelection } from '@/shared/use-project-selection';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { UnknownCalls } from './unknown';
import { useMcpConfiguration } from './use-configuration';

export function McpPage() {
  const { runtime, config, error } = useMcpConfiguration();
  const router = useRouter();
  const theme = useWorkbenchTheme();
  const { projectId, error: projectError } = useProjectSelection(runtime);
  return (
    <ConfigPage
      title="远程 MCP"
      subtitle={config.servers.length + ' 个连接'}
      action={
        <ToolbarAction label="添加连接" icon={Plus} onPress={() => router.push('/mcp/server')} />
      }
    >
      {!runtime ? (
        <Loading />
      ) : (
        <FormScroll>
          <Section title="服务器">
            {!config.servers.length && <EmptyState compact title="暂无连接" />}
            {config.servers.map(server => {
              const allowed = Object.keys(config.grants[projectId ?? '']?.[server.id] ?? {}).length;
              return (
                <ActionRow
                  key={server.id}
                  label={'配置 MCP ' + server.name}
                  onPress={() =>
                    router.push({ pathname: '/mcp/server', params: { id: server.id } })
                  }
                  title={server.name}
                  description={server.url}
                  meta={
                    (server.check?.message ?? '尚未检测') + ' · 当前项目授权 ' + allowed + ' 个工具'
                  }
                  metaTone={server.check?.status === 'failed' ? 'danger' : 'secondary'}
                  leading={<Plug size={18} color={server.enabled ? theme.accent : theme.muted} />}
                  trailing={
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <T tone={server.enabled ? 'accent' : 'muted'} variant="meta">
                        {server.enabled ? '已启用' : '已停用'}
                      </T>
                      <ChevronRight size={16} color={theme.muted} />
                    </View>
                  }
                />
              );
            })}
          </Section>
          <UnknownCalls runtime={runtime} />
          <Feedback error={error || projectError} />
        </FormScroll>
      )}
    </ConfigPage>
  );
}
