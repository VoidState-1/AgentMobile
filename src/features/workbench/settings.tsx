import { emptyMcpConfiguration } from '@/core/mcp/types';
import { emptySkillConfiguration } from '@/core/skills/types';
import { useWorkbenchTheme } from '@/shared/theme';
import { ActionRow } from '@/shared/ui/action-row';
import { Brain, ChevronRight, Laptop, Layers, Moon, Plug, Settings2, Sun } from '@/shared/ui/icons';
import { T } from '@/shared/ui/primitives';
import { SegmentedControl } from '@/shared/ui/selection';
import { useAppServices } from '@/shared/use-app-services';
import { useServiceSnapshot } from '@/shared/use-service-snapshot';
import { ScrollView, View } from 'react-native';
import type { SettingsCapability } from './use-workbench';

export function WorkbenchSettings({ controller }: { controller: SettingsCapability }) {
  const theme = useWorkbenchTheme();
  const { runtime, error } = useAppServices();
  const mcpConfig = useServiceSnapshot(runtime?.mcp.configuration, emptyMcpConfiguration);
  const skillConfig = useServiceSnapshot(runtime?.skills, emptySkillConfiguration);
  const mcp = '已启用 ' + mcpConfig.servers.filter(server => server.enabled).length;
  const skills = controller.projectId
    ? '已启用 ' +
      skillConfig.skills.filter(
        skill => skillConfig.grants[controller.projectId!]?.[skill.name] === skill.revision,
      ).length
    : skillConfig.skills.length + ' 个技能';
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 12, width: '100%', maxWidth: 680, alignSelf: 'center' }}
    >
      {[
        {
          label: '模型与供应商',
          Icon: Settings2,
          value: controller.modelLabel,
          action: controller.openModelConfig,
        },
        {
          label: 'Agent 设置',
          Icon: Brain,
          value: undefined,
          action: controller.openAgentSettings,
        },
        { label: '远程 MCP', Icon: Plug, value: mcp, action: controller.openMcpConfig },
        { label: 'Agent Skills', Icon: Layers, value: skills, action: controller.openSkills },
      ].map(({ label, Icon, value, action }) => (
        <ActionRow
          key={label}
          label={label}
          title={label}
          onPress={action}
          leading={<Icon size={18} color={theme.accent} />}
          trailing={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '48%' }}>
              {!!value && (
                <T tone="secondary" variant="caption" numberOfLines={1} style={{ flexShrink: 1 }}>
                  {value}
                </T>
              )}
              <ChevronRight size={16} color={theme.muted} />
            </View>
          }
        />
      ))}
      <View style={{ marginTop: 16 }}>
        <SegmentedControl
          label="外观"
          value={controller.appearance}
          onChange={controller.setAppearance}
          options={[
            { value: 'system', label: '跟随系统', accessibilityLabel: '跟随系统', icon: Laptop },
            { value: 'light', label: '浅色', accessibilityLabel: '浅色', icon: Sun },
            { value: 'dark', label: '深色', accessibilityLabel: '深色', icon: Moon },
          ]}
        />
      </View>
      {!!error && <T tone="danger">{error}</T>}
    </ScrollView>
  );
}
