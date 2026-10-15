import { Pressable, ScrollView, View } from 'react-native';
import type { DialogsCapability } from './use-workbench';
import { Brain, ChevronRight, Layers, Laptop, Moon, Plug, Settings2, Sun } from '@/shared/ui/icons';
import { T } from '@/shared/ui/primitives';
import { useWorkbenchTheme } from '@/shared/theme';

export function WorkbenchSettings({ controller }: { controller: DialogsCapability }) {
  const theme = useWorkbenchTheme();
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ padding: 12, width: '100%', maxWidth: 680, alignSelf: 'center' }}
    >
      {[
        { label: '模型与供应商', Icon: Settings2, action: controller.openModelConfig },
        { label: 'Agent 设置', Icon: Brain, action: controller.openAgentSettings },
        { label: '远程 MCP', Icon: Plug, action: controller.openMcpConfig },
        { label: 'Agent Skills', Icon: Layers, action: controller.openSkills },
      ].map(({ label, Icon, action }) => (
        <Pressable
          key={label}
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={action}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            minHeight: 48,
            paddingHorizontal: 4,
            borderBottomWidth: 1,
            borderColor: theme.border,
            backgroundColor: pressed ? theme.inset : 'transparent',
          })}
        >
          <Icon size={18} color={theme.accent} />
          <T style={{ flex: 1 }}>{label}</T>
          <ChevronRight size={15} color={theme.muted} />
        </Pressable>
      ))}
      <T tone="muted" style={{ fontSize: 12, marginTop: 20, marginBottom: 8 }}>
        外观
      </T>
      <View
        style={{
          flexDirection: 'row',
          backgroundColor: theme.inset,
          borderRadius: 6,
          padding: 3,
          gap: 3,
        }}
      >
        {(
          [
            { mode: 'system', label: '跟随系统', Icon: Laptop },
            { mode: 'light', label: '浅色', Icon: Sun },
            { mode: 'dark', label: '深色', Icon: Moon },
          ] as const
        ).map(({ mode, label, Icon }) => (
          <Pressable
            key={mode}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ selected: controller.appearance === mode }}
            onPress={() => controller.setAppearance(mode)}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: 4,
              flexDirection: 'row',
              gap: 6,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: controller.appearance === mode ? theme.surface : 'transparent',
            }}
          >
            <Icon
              size={16}
              color={controller.appearance === mode ? theme.accent : theme.secondary}
            />
            <T
              tone={controller.appearance === mode ? 'accent' : 'secondary'}
              style={{ fontSize: 12 }}
            >
              {label}
            </T>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
