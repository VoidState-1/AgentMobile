import { useDraftGuard } from '@/shared/use-draft-guard';
import { CredentialField } from '@/shared/ui/credential-field';
import { DisclosureRow } from '@/shared/ui/disclosure-row';
import { FormFooter } from '@/shared/ui/feedback';
import { ConfirmSheet } from '@/shared/ui/sheets';
import { useProjectSelection } from '@/shared/use-project-selection';
import { UnknownCalls } from './unknown';

import type { McpServer, McpServerInput } from '@/core/mcp/types';
import { useWorkbenchTheme } from '@/shared/theme';
import { ConfigPage, FormScroll, Loading, NumberField, Section, Toggle } from '@/shared/ui/forms';
import { Button, Field, T } from '@/shared/ui/primitives';
import { SegmentedControl } from '@/shared/ui/selection';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Switch, View } from 'react-native';
import { useMcpConfiguration } from './use-configuration';

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
  const { projectId, setProjectId, projects, error: projectError } = useProjectSelection(runtime);
  const dirty = JSON.stringify(draft) !== saved || !!token || remove;
  const guard = useDraftGuard(dirty);
  useEffect(() => {
    let current = true;
    if (server)
      void runtime!.mcp.configuration
        .keyReady(server.id)
        .then(value => {
          if (current) setReady(value);
        })
        .catch(() => {});
    return () => {
      current = false;
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
      onBack={() => guard.exit(() => (router.canGoBack() ? router.back() : router.replace('/mcp')))}
      footer={
        <FormFooter error={error || projectError} notice={notice}>
          <Button
            label="保存 MCP 连接"
            busy={busy && !probing}
            disabled={probing || (!!server && !dirty)}
            onPress={save}
          />
        </FormFooter>
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
          <NumberField
            label="请求超时"
            accessibilityLabel="MCP 请求超时（秒）"
            unit="秒"
            value={String(draft.timeoutMs / 1000)}
            keyboardType="number-pad"
            editable={!busy}
            onChangeText={value => update({ timeoutMs: Number(value) * 1000 })}
          />
          <Toggle
            label="启用 MCP 连接"
            value={draft.enabled}
            disabled={busy}
            onChange={enabled => update({ enabled })}
          />
        </Section>
        <Section title="认证">
          <SegmentedControl
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
            <CredentialField
              label="MCP Token"
              value={token}
              onChange={setToken}
              ready={ready}
              remove={remove}
              onRemoveChange={setRemove}
              disabled={busy}
              changedWarning={
                credentialChanged ? '服务器或认证已变更，需重新绑定 Token。' : undefined
              }
            />
          )}
        </Section>
        {server && (
          <>
            <Section title="检测与工具发现">
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
                <T tone="warning" variant="meta">
                  先保存修改，再检测或授权工具。
                </T>
              )}
              {!!server.check && (
                <T tone={server.check.status === 'passed' ? 'accent' : 'danger'} variant="caption">
                  {server.check.message}
                </T>
              )}
              {!!server.protocolVersion && (
                <T tone="muted" variant="meta">
                  {server.serverInfo} · MCP {server.protocolVersion}
                </T>
              )}
            </Section>
            <Section title="项目工具授权">
              <T tone="secondary" variant="caption">
                允许后，Agent 可自动向此服务器发送工具参数。
              </T>
              {projects.length ? (
                <SegmentedControl
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
                <T tone="secondary" variant="caption">
                  先检测连接以获取工具目录。
                </T>
              )}
              {server.tools.map(tool => (
                <View
                  key={tool.name}
                  style={{ borderTopWidth: 1, borderColor: theme.border, paddingTop: 4, gap: 4 }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <DisclosureRow
                      label={'查看工具定义 ' + tool.name}
                      expanded={expanded === tool.name}
                      onPress={() => setExpanded(expanded === tool.name ? undefined : tool.name)}
                      style={{ flex: 1 }}
                    >
                      <T numberOfLines={1}>{tool.name}</T>
                      <T tone={tool.readOnlyHint ? 'muted' : 'warning'} variant="caption">
                        {tool.readOnlyHint ? '服务声明只读' : '可能修改远端状态'}
                      </T>
                    </DisclosureRow>
                    <Switch
                      accessibilityLabel={'允许自动调用 ' + tool.name}
                      trackColor={{ true: theme.accent, false: theme.border }}
                      value={
                        config.grants[projectId]?.[server.id]?.[tool.name] === tool.fingerprint
                      }
                      disabled={busy || dirty || !projectId || !!tool.unavailableReason}
                      onValueChange={allow => {
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
                  </View>
                  {!!tool.unavailableReason && (
                    <T tone="warning" variant="caption">
                      {tool.unavailableReason}
                    </T>
                  )}
                  {!!tool.description && (
                    <T
                      tone="secondary"
                      numberOfLines={expanded === tool.name ? undefined : 2}
                      variant="caption"
                    >
                      {tool.description}
                    </T>
                  )}
                  {expanded === tool.name && (
                    <View
                      style={{ padding: 8, backgroundColor: theme.inset, borderRadius: 4, gap: 4 }}
                    >
                      {!!tool.title && <T>{tool.title}</T>}
                      <T selectable tone="secondary" variant="caption">
                        {JSON.stringify(tool.inputSchema, null, 2)}
                      </T>
                    </View>
                  )}
                </View>
              ))}
            </Section>
            <UnknownCalls runtime={runtime!} serverId={server.id} disabled={busy} />
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
      <ConfirmSheet
        visible={deleting}
        title="删除 MCP 连接"
        busy={busy}
        onClose={() => setDeleting(false)}
        confirmLabel="确认删除 MCP 连接"
        onConfirm={() =>
          guard.allow(() => {
            void action(async () => {
              await runtime!.mcp.configuration.removeServer(server!.id);
              router.replace('/mcp');
            });
          })
        }
        danger
        description={
          <>
            <T tone="secondary">
              该连接及项目授权将被移除。正在执行的任务使用启动时配置，调用历史仍保留。
            </T>
          </>
        }
      />
    </ConfigPage>
  );
}
