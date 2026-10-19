import { useState } from 'react';
import { View } from 'react-native';
import { Button, Field, T } from '@/shared/ui/primitives';
import type { GitCapability } from './use-workbench';
import type { GitRepositoryInfo } from '@/core/git/repository';

export function GitRepositoryPane({ controller }: { controller: GitCapability }) {
  const info = controller.repository;
  return info ? (
    <RepositoryForm key={controller.projectId} controller={controller} info={info} />
  ) : null;
}
function RepositoryForm({
  controller,
  info,
}: {
  controller: GitCapability;
  info: GitRepositoryInfo;
}) {
  const [branchName, setBranchName] = useState('');
  const [branchRef, setBranchRef] = useState<string>();
  const [tagName, setTagName] = useState('');
  const [name, setName] = useState(info.identity.name);
  const [email, setEmail] = useState(info.identity.email);
  const [remoteName, setRemoteName] = useState('origin');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [credentialRemote, setCredentialRemote] = useState<string>();
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [pushDraft, setPushDraft] = useState<{ source: string | null; value: string }>();
  const pushBranch =
    pushDraft?.source === info.head.branch ? pushDraft.value : (info.head.branch ?? 'main');
  const disabled =
    controller.busy || controller.projectActive || controller.dirty || controller.projectLoading;
  const local = info.branches.filter(branch => !branch.remote);
  return (
    <View style={{ gap: 24 }}>
      <View style={{ gap: 6 }}>
        <T variant="title">
          {info.head.kind === 'unborn'
            ? '尚未提交'
            : info.head.kind === 'detached'
              ? '分离 HEAD'
              : info.head.branch}
        </T>
        {!!info.head.oid && (
          <T tone="secondary" variant="caption">
            {info.head.oid.slice(0, 12)}
          </T>
        )}
        {info.state !== 'none' && <T tone="warning">正在进行 {info.state}，请先完成或中止。</T>}
        {controller.transfer && (
          <View style={{ gap: 6 }}>
            <T
              variant="caption"
              tone={controller.transfer.state === 'unknown' ? 'warning' : 'secondary'}
            >
              {
                { fetch: '获取', push: '推送', verifyPush: '核对推送', clone: '克隆' }[
                  controller.transfer.method
                ]
              }{' '}
              · {controller.transfer.name} ·{' '}
              {
                {
                  running: '进行中',
                  completed: '完成',
                  cancelled: '已取消',
                  failed: '失败',
                  unknown: '结果待核对',
                }[controller.transfer.state]
              }
              {controller.transfer.total > 0
                ? ` · ${controller.transfer.completed}/${controller.transfer.total}`
                : ''}
              {controller.transfer.bytes > 0
                ? ` · ${(controller.transfer.bytes / 1024).toFixed(0)} KiB`
                : ''}
            </T>
            {controller.transfer.state === 'running' && (
              <Button
                label="取消 Git 传输"
                compact
                variant="ghost"
                onPress={controller.cancelTransfer}
              />
            )}
          </View>
        )}
        {info.pendingPushes?.map(push => (
          <View key={push.id} style={{ gap: 6 }}>
            <T tone="warning" variant="caption">
              {push.name}/{push.branch} 的推送结果尚未确认（{push.oid.slice(0, 7)}）。
            </T>
            <Button
              label={'核对 ' + push.name + '/' + push.branch}
              compact
              disabled={disabled}
              variant="secondary"
              onPress={() => {
                void controller.repositoryCommand({ method: 'verifyPush', id: push.id });
              }}
            />
          </View>
        ))}
      </View>
      <View style={{ gap: 8 }}>
        <T variant="label">本地分支</T>
        {local.map(branch => (
          <View key={branch.name} style={{ gap: 6, paddingVertical: 4 }}>
            <View>
              <T>
                {branch.name}
                {branch.current ? ' · 当前' : ''}
              </T>
              <T variant="caption" tone="secondary">
                {branch.upstream
                  ? `${branch.upstream} · 领先 ${branch.ahead ?? 0} · 落后 ${branch.behind ?? 0}`
                  : branch.oid.slice(0, 7)}
              </T>
            </View>
            {!branch.current && (
              <View style={{ flexDirection: 'row', gap: 4, flexWrap: 'wrap' }}>
                {info.capabilities.merge && (
                  <Button
                    label={'合并 ' + branch.name}
                    compact
                    variant="ghost"
                    disabled={disabled || info.state !== 'none'}
                    onPress={() => {
                      void controller.mergeBranch(branch.name, branch.oid);
                    }}
                  />
                )}
                {info.capabilities.rebase && (
                  <Button
                    label={'变基至 ' + branch.name}
                    compact
                    variant="ghost"
                    disabled={disabled || info.state !== 'none'}
                    onPress={() => controller.confirmRebaseBranch(branch.name, branch.oid)}
                  />
                )}
                <Button
                  label={'切换到 ' + branch.name}
                  compact
                  variant="ghost"
                  disabled={disabled}
                  onPress={() => {
                    void controller.repositoryCommand({ method: 'checkout', name: branch.name });
                  }}
                />
                <Button
                  label={'删除分支 ' + branch.name}
                  compact
                  variant="ghost"
                  disabled={disabled}
                  onPress={() =>
                    controller.confirmRepositoryCommand({
                      method: 'branchDelete',
                      name: branch.name,
                    })
                  }
                />
              </View>
            )}
          </View>
        ))}
        <Field
          label="新分支名称"
          value={branchName}
          onChangeText={setBranchName}
          editable={!disabled}
          autoCapitalize="none"
        />
        {branchRef && (
          <T variant="caption" tone="secondary">
            起点 · {branchRef.slice(0, 12)}
          </T>
        )}
        <Button
          label="创建分支"
          disabled={disabled || !branchName.trim()}
          onPress={() => {
            void controller.repositoryCommand({
              method: 'branchCreate',
              name: branchName.trim(),
              ...(branchRef ? { ref: branchRef } : {}),
            });
          }}
        />
      </View>
      <View style={{ gap: 8 }}>
        <T variant="label">提交身份</T>
        <Field label="Git 姓名" value={name} onChangeText={setName} editable={!disabled} />
        <Field
          label="Git 邮箱"
          value={email}
          onChangeText={setEmail}
          editable={!disabled}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <Button
          label="保存提交身份"
          variant="secondary"
          disabled={disabled || !name.trim() || !email.trim()}
          onPress={() => {
            void controller.repositoryCommand({
              method: 'identity',
              name: name.trim(),
              email: email.trim(),
            });
          }}
        />
      </View>
      <View style={{ gap: 8 }}>
        <T variant="label">远程仓库</T>
        {info.remotes.map(remote => (
          <View key={remote.name} style={{ gap: 5 }}>
            <T>{remote.name}</T>
            <T tone="secondary" variant="caption" selectable>
              {remote.url}
            </T>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <Button
                label={'编辑远程 ' + remote.name}
                compact
                variant="ghost"
                disabled={disabled}
                onPress={() => {
                  setRemoteName(remote.name);
                  setRemoteUrl(remote.url);
                }}
              />
              {info.capabilities.fetch && (
                <Button
                  label={'获取 ' + remote.name}
                  compact
                  variant="secondary"
                  disabled={disabled}
                  onPress={() => {
                    void controller.repositoryCommand({ method: 'fetch', name: remote.name });
                  }}
                />
              )}
              {info.capabilities.push && (
                <Button
                  label={'推送到 ' + remote.name}
                  compact
                  variant="secondary"
                  disabled={disabled || !info.head.oid || !pushBranch.trim()}
                  onPress={() => {
                    void controller.repositoryCommand({
                      method: 'push',
                      name: remote.name,
                      branch: pushBranch.trim(),
                    });
                  }}
                />
              )}
              {info.capabilities.fetch && (
                <Button
                  label={
                    remote.credentialUsername ? '认证 · ' + remote.credentialUsername : '配置认证'
                  }
                  compact
                  variant="ghost"
                  disabled={disabled}
                  onPress={() => {
                    setCredentialRemote(remote.name);
                    setUsername(remote.credentialUsername ?? '');
                    setToken('');
                  }}
                />
              )}
            </View>
          </View>
        ))}
        {info.capabilities.push && (
          <Field
            label="推送到远程分支"
            value={pushBranch}
            onChangeText={value => setPushDraft({ source: info.head.branch, value })}
            editable={!disabled}
            autoCapitalize="none"
          />
        )}
        {credentialRemote &&
          (() => {
            const remote = info.remotes.find(remote => remote.name === credentialRemote);
            return remote ? (
              <View style={{ gap: 8 }}>
                <T variant="label">{remote.name} 的 HTTPS 认证</T>
                <Field
                  label="Git 用户名"
                  value={username}
                  onChangeText={setUsername}
                  editable={!disabled}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Field
                  label="访问令牌"
                  value={token}
                  onChangeText={setToken}
                  editable={!disabled}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Button
                  label="保存 Git 认证"
                  variant="secondary"
                  disabled={disabled || !username.trim() || !token}
                  onPress={() => {
                    void controller
                      .saveCredential(remote.name, remote.url, { username, token })
                      .then(saved => {
                        if (saved) {
                          setToken('');
                          setCredentialRemote(undefined);
                        }
                      });
                  }}
                />
                {remote.credentialUsername && (
                  <Button
                    label="移除 Git 认证"
                    variant="ghost"
                    disabled={disabled}
                    onPress={() => {
                      void controller.saveCredential(remote.name, remote.url, null).then(saved => {
                        if (saved) {
                          setToken('');
                          setCredentialRemote(undefined);
                        }
                      });
                    }}
                  />
                )}
                <Button
                  label="关闭认证设置"
                  compact
                  variant="ghost"
                  disabled={disabled}
                  onPress={() => {
                    setToken('');
                    setCredentialRemote(undefined);
                  }}
                />
              </View>
            ) : null;
          })()}
        {!info.capabilities.fetch && (
          <T tone="secondary" variant="caption">
            远程 Git 传输请使用原生应用。
          </T>
        )}
        <Field
          label="远程名称"
          value={remoteName}
          onChangeText={setRemoteName}
          editable={!disabled}
          autoCapitalize="none"
        />
        <Field
          label="HTTPS 仓库地址"
          value={remoteUrl}
          onChangeText={setRemoteUrl}
          editable={!disabled}
          autoCapitalize="none"
          keyboardType="url"
        />
        <Button
          label="保存远程仓库"
          variant="secondary"
          disabled={disabled || !remoteName.trim() || !remoteUrl.trim()}
          onPress={() => {
            void controller.repositoryCommand({
              method: 'remoteSave',
              name: remoteName.trim(),
              url: remoteUrl.trim(),
            });
          }}
        />
        {info.branches
          .filter(branch => branch.remote)
          .map(branch => (
            <View key={branch.name} style={{ gap: 4 }}>
              <T>{branch.name}</T>
              {info.capabilities.merge && (
                <Button
                  label={'合并 ' + branch.name}
                  compact
                  variant="secondary"
                  disabled={disabled || info.state !== 'none'}
                  onPress={() => {
                    void controller.mergeBranch(branch.name, branch.oid);
                  }}
                />
              )}
              {info.capabilities.rebase && (
                <Button
                  label={'变基至 ' + branch.name}
                  compact
                  variant="secondary"
                  disabled={disabled || info.state !== 'none'}
                  onPress={() => controller.confirmRebaseBranch(branch.name, branch.oid)}
                />
              )}
              <Button
                label={'从 ' + branch.name + ' 创建分支'}
                compact
                variant="ghost"
                disabled={disabled}
                onPress={() => {
                  setBranchName(branch.name.slice(branch.name.indexOf('/') + 1));
                  setBranchRef(branch.oid);
                }}
              />
              {info.head.branch && (
                <Button
                  label={'将 ' + branch.name + ' 设为上游'}
                  compact
                  variant="ghost"
                  disabled={disabled}
                  onPress={() => {
                    void controller.repositoryCommand({
                      method: 'upstream',
                      name: info.head.branch!,
                      upstream: branch.name,
                    });
                  }}
                />
              )}
            </View>
          ))}
        {local.find(branch => branch.current)?.upstream && (
          <Button
            label="取消当前分支上游"
            compact
            variant="ghost"
            disabled={disabled}
            onPress={() => {
              void controller.repositoryCommand({
                method: 'upstream',
                name: info.head.branch!,
                upstream: null,
              });
            }}
          />
        )}
      </View>
      <View style={{ gap: 8 }}>
        <T variant="label">标签</T>
        {info.tags.map(tag => (
          <View key={tag.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <T style={{ flex: 1 }}>
              {tag.name} · {tag.oid.slice(0, 7)}
            </T>
            <Button
              label={'删除标签 ' + tag.name}
              compact
              variant="ghost"
              disabled={disabled}
              onPress={() =>
                controller.confirmRepositoryCommand({ method: 'tagDelete', name: tag.name })
              }
            />
          </View>
        ))}
        <Field
          label="标签名称"
          value={tagName}
          onChangeText={setTagName}
          editable={!disabled}
          autoCapitalize="none"
        />
        <Button
          label="创建标签"
          variant="secondary"
          disabled={disabled || !tagName.trim()}
          onPress={() => {
            void controller.repositoryCommand({ method: 'tagCreate', name: tagName.trim() });
          }}
        />
      </View>
    </View>
  );
}
