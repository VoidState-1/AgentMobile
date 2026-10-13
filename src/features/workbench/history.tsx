import { Pressable, ScrollView, View } from 'react-native';
import { Check, ChevronRight, GitCommitHorizontal, History } from './icons';
import type { Workbench } from './use-workbench';
import { T } from './ui';
import { useWorkbenchTheme } from './theme';
import { dateLabel } from './format';

export function HistoryPane({ controller }: { controller: Workbench }) {
  const theme = useWorkbenchTheme();
  return <ScrollView style={{ flex: 1, backgroundColor: theme.surface }} contentContainerStyle={{ padding: 22, maxWidth: 820, width: '100%', alignSelf: 'center' }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 8 }}>
      <History size={19} color={theme.secondary} /><T style={{ fontSize: 16, fontWeight: '600' }}>项目版本</T>
    </View>
    <T tone="secondary" style={{ fontSize: 12, marginBottom: 24 }}>每次保存都有记录。先查看变化，再选择恢复。</T>
    {controller.versions.map((version, index) => <Pressable key={version.oid} accessibilityRole="button"
      accessibilityLabel={'查看版本 ' + version.oid.slice(0, 7)} disabled={controller.busy}
      onPress={() => { void controller.reviewVersion(version); }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 18, paddingHorizontal: 8,
        borderBottomWidth: 1, borderColor: theme.border, backgroundColor: pressed ? theme.inset : 'transparent', borderRadius: 8 })}>
      <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: index === 0 ? theme.accentSoft : theme.inset,
        alignItems: 'center', justifyContent: 'center' }}><GitCommitHorizontal size={18} color={index === 0 ? theme.accent : theme.muted} /></View>
      <View style={{ flex: 1, gap: 4 }}><T style={{ fontSize: 13, fontWeight: '500' }}>{version.message.split('\n')[0]}</T>
        <T tone="muted" style={{ fontSize: 11 }}>{dateLabel(version.timestamp)} · {version.oid.slice(0, 7)}</T>
        {index === 0 && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Check size={12} color={theme.success} />
          <T style={{ fontSize: 11, color: theme.success }}>当前版本</T></View>}
      </View>
      <ChevronRight size={16} color={theme.muted} style={{ marginTop: 7 }} />
    </Pressable>)}
  </ScrollView>;
}
