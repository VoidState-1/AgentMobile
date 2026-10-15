import { memo, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { diffLines } from 'diff';
import { ArrowLeftRight, FileText, RotateCcw } from '@/shared/ui/icons';
import type { GitCapability } from './use-workbench';
import { isImage } from '@/core/workspace/path';
import { Button, Sheet, T } from '@/shared/ui/primitives';
import { useWorkbenchTheme } from '@/shared/theme';
import { fileName } from '@/shared/format';

export const ReviewSheet = memo(function ReviewSheet({ controller }: { controller: GitCapability }) {
  const theme = useWorkbenchTheme();
  const value = controller.review!;
  const [index, setIndex] = useState(0);
  const file = value.files[index] ?? value.files[0];
  const lines = useMemo(() => {
    if (!file || isImage(file.path)) return [];
    let before = 0; let after = 0;
    return diffLines(file.before.slice(0, 12000), file.after.slice(0, 12000)).flatMap((part) => {
      const entries = part.value.split('\n');
      if (entries[entries.length - 1] === '') entries.pop();
      return entries.map((text) => {
        if (!part.added) before++;
        if (!part.removed) after++;
        return { text, before: part.added ? '' : String(before), after: part.removed ? '' : String(after),
          kind: part.added ? 'added' : part.removed ? 'removed' : 'context' };
      });
    });
  }, [file]);
  return <Sheet visible title={value.title} subtitle={value.files.length + ' 个文件 · ' + (value.description ?? (value.task ? '任务开始前与结束后' : value.area === 'staged' ? 'HEAD 与暂存区' : value.area === 'unstaged' ? '暂存区与工作区' : '父提交与所选提交'))}
    onClose={() => controller.setReview(undefined)} wide busy={controller.busy}
    footer={<View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <T tone="secondary" style={{ fontSize: 11, flex: 1 }}>{value.description ?? (controller.dirty ? '编辑器中有未保存的修改，请先保存。' : value.restoreRef ? '恢复到工作区，已有提交历史保留' : value.area ? '保存、暂存与提交分别管理' : '当前没有可撤销的文件变化')}</T>
      {value.restoreRef && <Button label={value.task ? '撤销修改' : '恢复此版本'} icon={RotateCcw}
        disabled={!!controller.projectActive || controller.busy || controller.dirty} onPress={controller.confirmRestore} />}
    </View>}>
    {!!controller.error && <T tone="danger" style={{ fontSize: 12 }}>{controller.error}</T>}
    {value.files.length === 0 ? <View style={{ alignItems: 'center', padding: 35, gap: 12 }}>
      <ArrowLeftRight size={28} color={theme.muted} /><T tone="secondary">没有文件变化</T></View> : <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {value.files.map((entry, entryIndex) => <Pressable key={entry.path} accessibilityRole="button"
          accessibilityLabel={'查看变化 ' + entry.path} onPress={() => setIndex(entryIndex)}
          style={{ paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 7,
            backgroundColor: entryIndex === index ? theme.accentSoft : theme.inset }}>
          <FileText size={14} color={entryIndex === index ? theme.accent : theme.secondary} />
          <T tone={entryIndex === index ? 'accent' : 'secondary'} style={{ fontSize: 12 }}>{fileName(entry.path)}</T>
        </Pressable>)}
      </ScrollView>
      <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
          <T style={{ fontSize: 12, fontWeight: '500' }}>{file?.kind} · {file?.path}</T>
          <T tone="muted" style={{ fontSize: 11 }}>{isImage(file?.path ?? '') ? '图片对比' : '逐行变化'}</T>
        </View>
        {file && isImage(file.path) ? <View style={{ gap: 14 }}>
          {[{ label: '修改前', uri: file.before }, { label: '修改后', uri: file.after }].map((entry) => <View key={entry.label} style={{ gap: 7 }}>
            <T tone="secondary" style={{ fontSize: 12 }}>{entry.label}</T>
            {entry.uri ? <Image source={{ uri: entry.uri }} contentFit="contain" style={{ height: 210, backgroundColor: theme.inset, borderRadius: 9 }} /> :
              <T tone="muted" style={{ fontSize: 12 }}>没有图片</T>}
          </View>)}
        </View> : <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 9, overflow: 'hidden' }}>
          <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }}>
            <View style={{ flexGrow: 1 }}>
              {lines.map((line, lineIndex) => <View key={lineIndex} style={{ flexDirection: 'row',
                backgroundColor: line.kind === 'added' ? theme.added : line.kind === 'removed' ? theme.removed : theme.code }}>
                <T tone="muted" style={{ width: 33, textAlign: 'right', paddingRight: 6, fontSize: 10, lineHeight: 23 }}>{line.before}</T>
                <T tone="muted" style={{ width: 33, textAlign: 'right', paddingRight: 6, fontSize: 10, lineHeight: 23 }}>{line.after}</T>
                <T style={{ width: 19, fontSize: 12, lineHeight: 23, color: line.kind === 'added' ? theme.success : line.kind === 'removed' ? theme.danger : theme.muted }}>
                  {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
                </T>
                <T selectable style={{ paddingRight: 14, fontFamily: 'monospace', fontSize: 12, lineHeight: 23 }}>{line.text || ' '}</T>
              </View>)}
            </View>
          </ScrollView>
        </View>}
        {file && (file.before.length > 12000 || file.after.length > 12000) && <T tone="muted" style={{ fontSize: 11 }}>较长内容仅预览前 12,000 字符，完整内容可在文件中查看。</T>}
      </View>
    </>}
  </Sheet>;
});
