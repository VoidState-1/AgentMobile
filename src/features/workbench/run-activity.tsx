import { runStateLabels } from '@/shared/format';
import type { RunsCapability } from '@/features/workbench/use-workbench';
import { useWorkbenchTheme } from '@/shared/theme';
import { T } from '@/shared/ui/primitives';
import { memo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';

/** Compact global roots view; child activity stays in its delegation trace. */
export const RunActivity = memo(function RunActivity({
  controller,
}: {
  controller: RunsCapability;
}) {
  const theme = useWorkbenchTheme();
  if (!controller.runs.length) return null;
  return (
    <View
      testID="run-activity"
      style={{
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
        backgroundColor: theme.surface,
        paddingVertical: 6,
      }}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 14, gap: 8, alignItems: 'center' }}
      >
        <T tone="muted" variant="meta">
          活动任务 · {controller.runs.length}
        </T>
        {controller.runs.map(run => (
          <Pressable
            key={run.id}
            accessibilityRole="button"
            accessibilityLabel={'查看活动任务 ' + run.prompt}
            disabled={controller.busy}
            onPress={() => controller.returnToActiveConversation(run)}
            style={{
              paddingHorizontal: 9,
              paddingVertical: 5,
              borderWidth: 1,
              borderColor: theme.border,
              borderRadius: 7,
              maxWidth: 200,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor:
                run.conversationId === controller.conversationId ? theme.accentSoft : theme.surface,
            }}
          >
            {run.state !== 'queued' && <ActivityIndicator size={10} color={theme.accent} />}
            <View style={{ minWidth: 0, flexShrink: 1 }}>
              <T numberOfLines={1} variant="meta">
                {controller.projects.find(project => project.id === run.projectId)?.name ?? '项目'}{' '}
                · {run.prompt}
              </T>
              <T tone="muted" variant="meta">
                {runStateLabels[run.state]}
              </T>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
});
