import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { McpAttempt, McpServer, McpServerInput } from '@/core/mcp/types';
import type { Project } from '@/core/projects';
import {
  Choices,
  ConfigPage,
  FormScroll,
  Loading,
  Section,
  Toggle,
  useDraftGuard,
} from '@/shared/ui/forms';
import { Button, Field, Sheet, T } from '@/shared/ui/primitives';
import { useWorkbenchTheme } from '@/shared/theme';
import { useWorkbenchUi } from '@/shared/workbench-state';
import { useMcpConfiguration } from './common';

const edit = (server: McpServer): McpServerInput => ({
  id: server.id,
  name: server.name,
  url: server.url,
  auth: server.auth,
  enabled: server.enabled,
  timeoutMs: server.timeoutMs,
});
export function McpServerPage() {
  const controller = useMcpConfiguration();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const server = controller.config.servers.find(item => item.id === id);
  if (!controller.runtime)
    return (
      <ConfigPage title="MCP 连接">
        <Loading />
        {!!controller.error && <T tone="danger">{controller.error}</T>}
      </ConfigPage>
    );
  if (id && !server)
    return (
      <ConfigPage title="连接已删除">
        <T style={{ padding: 20 }}>返回列表后重新选择连接。</T>
      </ConfigPage>
    );
  return <ServerEditor key={id ?? 'new'} controller={controller} server={server} />;
}
function ServerEditor({
  controller,
  server,
}: {
  controller: ReturnType<typeof useMcpConfiguration>;
  server?: McpServer;
}) {
  const { runtime, config, busy, error, action } = controller;
  const router = useRouter();
  const theme = useWorkbenchTheme();
  const initial: McpServerInput = server
    ? edit(server)
    : { name: '', url: '', auth: 'bearer', enabled: true, timeoutMs: 120_000 };
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const revision = useRef(server?.revision);
  const [token, setToken] = useState('');
  const [remove, setRemove] = useState(false);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [probing, setProbing] = useState(false);
  const probe = useRef<AbortController | undefined>(undefined);
  const [expanded, setExpanded] = useState<string>();
  const [unknown, setUnknown] = useState<McpAttempt[]>([]);
  const [confirmRetry, setConfirmRetry] = useState<McpAttempt>();
  const selectedProject = useWorkbenchUi(state => state.projectId);
  const [projectId, setProjectId] = useState(selectedProject ?? '');
  const [projects, setProjects] = useState<Project[]>([]);
  const dirty = JSON.stringify(draft) !== saved || !!token || remove;
  const guard = useDraftGuard(dirty);
  useEffect(() => {
    let current = true;
    void runtime!.workspace.projects().then(values => {
      if (current) setProjects(values);
    });
    if (!selectedProject)
      void runtime!.preferences.getWorkbench().then(value => {
        if (current) setProjectId(value?.projectId ?? '');
      });
    return () => {
      current = false;
    };
  }, [runtime, selectedProject]);
  useEffect(() => {
    let current = true;
    if (server)
      void runtime!.mcp.configuration
        .keyReady(server.id)
        .then(value => {
          if (current) setReady(value);
        })
        .catch(() => {});
    const refresh = () => {
      void runtime!.mcp
        .unknown(server?.id)
        .then(values => {
          if (current) setUnknown(values);
        })
        .catch(() => {});
    };
    refresh();
    const unsubscribe = runtime!.agent.subscribe(refresh);
    return () => {
      current = false;
      unsubscribe();
    };
  }, [runtime, server]);
  useEffect(() => () => probe.current?.abort(), []);
  const update = (value: Partial<McpServerInput>) => {
    setDraft({ ...draft, ...value });
    setNotice('');
  };
  let credentialChanged = false;
  try {
    credentialChanged =
      !!server &&
      (new URL(server.url).origin !== new URL(draft.url).origin || server.auth !== draft.auth);
  } catch {}
  const save = () => {
    void action(async () => {
      const value = await runtime!.mcp.configuration.saveServer(
        draft,
        { value: token || undefined, remove },
        revision.current,
      );
      const next = edit(value);
      setDraft(next);
      setSaved(JSON.stringify(next));
      revision.current = value.revision;
      setToken('');
      setRemove(false);
      setNotice('MCP 连接已保存。');
      if (!server)
        guard.allow(() => router.replace({ pathname: '/mcp/server', params: { id: value.id } }));
    });
  };
  const discover = () => {
    void action(async () => {
      const abort = new AbortController();
      probe.current = abort;
      setProbing(true);
      setNotice('');
      try {
        await runtime!.mcp.discover(server!.id, abort.signal);
        setNotice('工具目录已更新，请选择项目授权。');
      } finally {
        setProbing(false);
        probe.current = undefined;
      }
    });
  };
  return (
    <ConfigPage
      title={server ? server.name : '添加 MCP 连接'}
      subtitle="Streamable HTTP"
      onBack={() => guard.exit(() => (router.canGoBack() ? router.back() : router.replace('/mcp')))}
      footer={
        <View style={{ gap: 6 }}>
          {!!error && (
            <T tone="danger" style={{ fontSize: 12 }}>
              {error}
            </T>
          )}
          {!!notice && (
            <T tone="accent" style={{ fontSize: 12 }}>
              {notice}
            </T>
          )}
          <Button
            label="保存 MCP 连接"
            busy={busy && !probing}
            disabled={probing || (!!server && !dirty)}
            onPress={save}
          />
        </View>
      }
    >
      <FormScroll>
        <Section title="连接信息">
          <Field
            label="MCP 连接名称"
            value={draft.name}
            maxLength={80}
            editable={!busy}
            onChangeText={name => update({ name })}
            placeholder="例如：资料搜索"
          />
          <Field
            label="MCP 端点"
            value={draft.url}
            keyboardType="url"
            editable={!busy}
            onChangeText={url => update({ url })}
            placeholder="https://example.com/mcp"
          />
          <T tone="muted" style={{ fontSize: 11 }}>
            填写完整端点，不会自动补路径。使用 HTTPS，本机开发地址可用 HTTP。
          </T>
          <Field
            label="MCP 请求超时（秒）"
            value={String(draft.timeoutMs / 1000)}
            keyboardType="number-pad"
            editable={!busy}
            onChangeText={value => update({ timeoutMs: Number(value) * 1000 })}
          />
          <Toggle
            label="启用 MCP 连接"
            hint="停用后新任务不再获得该服务工具，运行中的任务使用原配置。"
            value={draft.enabled}
            disabled={busy}
            onChange={enabled => update({ enabled })}
          />
        </Section>
        <Section
          title="认证"
          hint={
            Platform.OS === 'web'
              ? 'Token 仅在浏览器内存保存；刷新后需要重新填写。'
              : 'Token 保存在设备安全存储，与模型凭证分开。'
          }
        >
          <Choices
            label="MCP 认证方式"
            value={draft.auth}
            options={[
              { value: 'bearer', label: 'Bearer Token' },
              { value: 'none', label: '无需认证' },
            ]}
            disabled={busy}
            onChange={auth => {
              update({ auth });
              setToken('');
            }}
          />
          {draft.auth === 'bearer' && (
            <>
              <T
                tone={credentialChanged || remove || !ready ? 'warning' : 'accent'}
                style={{ fontSize: 12 }}
              >
                {credentialChanged
                  ? '服务器或认证已变更，需重新绑定 Token。'
                  : remove
                    ? '保存后将移除 Token'
                    : ready
                      ? 'Token 已保存 · 留空保留现有凭证'
                      : 'Token 缺失 · 可先保存连接，稍后补填'}
              </T>
              <Field
                label="MCP Token"
                value={token}
                secureTextEntry
                maxLength={8192}
                editable={!busy}
                placeholder={ready ? '留空保留，填写则替换' : '输入 Bearer Token'}
                onChangeText={setToken}
              />
              {ready && (
                <Toggle
                  label="移除已保存 Token"
                  value={remove}
                  disabled={busy}
                  onChange={setRemove}
                />
              )}
            </>
          )}
        </Section>
        {server && (
          <>
            <Section
              title="检测与工具发现"
              hint="只获取目录，不执行工具。输入定义变化会撤销对应授权，新工具默认关闭。"
            >
              <Button
                label={probing ? '正在发现工具' : '检测并发现工具'}
                variant="secondary"
                busy={probing}
                disabled={busy || dirty}
                onPress={discover}
              />
              {probing && (
                <Button label="停止检测" variant="ghost" onPress={() => probe.current?.abort()} />
              )}
              {dirty && (
                <T tone="warning" style={{ fontSize: 11 }}>
                  先保存修改，再检测或授权工具。
                </T>
              )}
              {!!server.check && (
                <T
                  tone={server.check.status === 'passed' ? 'accent' : 'danger'}
                  style={{ fontSize: 12 }}
                >
                  {server.check.message}
                </T>
              )}
              {!!server.protocolVersion && (
                <T tone="muted" style={{ fontSize: 11 }}>
                  {server.serverInfo} · MCP {server.protocolVersion}
                </T>
              )}
            </Section>
            <Section
              title="项目工具授权"
              hint="每个项目最多启用 32 个远程工具。允许后 Agent 可自动调用，参数会发送到服务器。只读标记由服务声明。"
            >
              {projects.length ? (
                <Choices
                  label="授权项目"
                  value={projectId}
                  options={projects.map(project => ({ value: project.id, label: project.name }))}
                  disabled={busy}
                  onChange={setProjectId}
                />
              ) : (
                <T tone="muted">请先创建项目。</T>
              )}
              {!server.tools.length && (
                <T tone="secondary" style={{ fontSize: 12 }}>
                  先检测连接以获取工具目录。
                </T>
              )}
              {server.tools.map(tool => (
                <View
                  key={tool.name}
                  style={{ borderTopWidth: 1, borderColor: theme.border, paddingTop: 12, gap: 7 }}
                >
                  <Toggle
                    label={'允许自动调用 ' + tool.name}
                    hint={
                      tool.unavailableReason ??
                      (tool.title || (tool.readOnlyHint ? '服务声明：只读' : '可能修改远端状态'))
                    }
                    value={config.grants[projectId]?.[server.id]?.[tool.name] === tool.fingerprint}
                    disabled={busy || dirty || !projectId || !!tool.unavailableReason}
                    onChange={allow => {
                      void action(() =>
                        runtime!.mcp.configuration.grant(
                          projectId,
                          server.id,
                          tool.name,
                          allow,
                          tool.fingerprint,
                        ),
                      );
                    }}
                  />
                  {!!tool.description && (
                    <T
                      tone="secondary"
                      numberOfLines={expanded === tool.name ? undefined : 3}
                      style={{ fontSize: 11, lineHeight: 19 }}
                    >
                      {tool.description}
                    </T>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={'查看工具定义 ' + tool.name}
                    onPress={() => setExpanded(expanded === tool.name ? undefined : tool.name)}
                  >
                    <T tone="accent" style={{ fontSize: 11 }}>
                      {expanded === tool.name ? '收起定义' : '查看输入定义'}
                    </T>
                  </Pressable>
                  {expanded === tool.name && (
                    <T selectable tone="muted" style={{ fontSize: 11, lineHeight: 18 }}>
                      {JSON.stringify(tool.inputSchema, null, 2)}
                    </T>
                  )}
                </View>
              ))}
            </Section>
            {!!unknown.length && (
              <Section
                title="待核对的远端调用"
                hint="网络中断或回执保存失败不代表远端未执行。解除限制前，请自行核对服务器执行状态。"
              >
                {unknown.map(attempt => (
                  <View key={attempt.id} style={{ gap: 7 }}>
                    <T tone="warning" style={{ fontSize: 12 }}>
                      {attempt.tool} ·{' '}
                      {attempt.state === 'dispatched' ? '等待回执或尚未收束' : '远端结果未知'}
                    </T>
                    <T tone="muted" style={{ fontSize: 11 }}>
                      {new Date(attempt.createdAt).toLocaleString()}
                    </T>
                    <T selectable style={{ fontSize: 11 }}>
                      {attempt.preview}
                    </T>
                    <Button
                      label={'核对后解除重试限制 ' + attempt.tool}
                      variant="secondary"
                      disabled={busy || attempt.state !== 'unknown'}
                      onPress={() => setConfirmRetry(attempt)}
                    />
                  </View>
                ))}
              </Section>
            )}
            <Button
              label="删除 MCP 连接"
              variant="danger"
              disabled={busy}
              onPress={() => setDeleting(true)}
            />
          </>
        )}
      </FormScroll>
      {guard.guard}
      <Sheet
        visible={deleting}
        title="删除 MCP 连接"
        onClose={() => setDeleting(false)}
        busy={busy}
        footer={
          <Button
            label="确认删除 MCP 连接"
            variant="danger"
            busy={busy}
            onPress={() =>
              guard.allow(() => {
                void action(async () => {
                  await runtime!.mcp.configuration.removeServer(server!.id);
                  router.replace('/mcp');
                });
              })
            }
          />
        }
      >
        <T tone="secondary">
          该连接及项目授权将被移除。正在执行的任务使用启动时配置，调用历史仍保留。
        </T>
      </Sheet>
      <Sheet
        visible={!!confirmRetry}
        title="解除重试限制"
        busy={busy}
        onClose={() => setConfirmRetry(undefined)}
        footer={
          <Button
            label="已核对，允许再次调用"
            busy={busy}
            onPress={() => {
              void action(async () => {
                await runtime!.mcp.acknowledge(confirmRetry!.id);
                setConfirmRetry(undefined);
                setUnknown(await runtime!.mcp.unknown(server!.id));
              });
            }}
          />
        }
      >
        <T tone="warning">
          解除后，Agent
          可以再次发送相同调用，可能造成重复操作。请确认你已核对远端执行状态。这个操作只解除本地限制，不会立即调用服务器。
        </T>
      </Sheet>
    </ConfigPage>
  );
}
