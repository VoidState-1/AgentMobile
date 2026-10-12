import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/theme/palette';

export default function WorkspaceScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.mark}>
            <Text style={styles.markText}>A</Text>
          </View>
          <Text style={styles.brand}>Agent Mobile</Text>
        </View>

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>你的随身创作空间</Text>
          <Text accessibilityRole="header" style={styles.title}>
            让想法，{'\n'}慢慢成为作品。
          </Text>
          <Text style={styles.description}>
            在一个地方整理文字与图片，和 AI 一起修改，留住每一步创作。
          </Text>
        </View>

        <View style={styles.sectionHeader}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            工作区
          </Text>
          <Text style={styles.count}>0 个项目</Text>
        </View>

        <View style={styles.emptyState}>
          <View style={styles.emptyMark}>
            <Text style={styles.emptyMarkText}>＋</Text>
          </View>
          <Text style={styles.emptyTitle}>这里，等待你的第一份作品</Text>
          <Text style={styles.emptyDescription}>
            你的资料、图片和创作将在这里汇集。
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background },
  content: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 40,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mark: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: palette.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markText: { color: palette.surface, fontSize: 20, fontWeight: '700' },
  brand: { color: palette.text, fontSize: 18, fontWeight: '600' },
  hero: { paddingTop: 64, paddingBottom: 52, gap: 18 },
  eyebrow: { color: palette.accent, fontSize: 13, fontWeight: '600' },
  title: { color: palette.text, fontSize: 38, lineHeight: 50, fontWeight: '700' },
  description: {
    color: palette.textSecondary,
    fontSize: 16,
    lineHeight: 27,
    maxWidth: 440,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sectionTitle: { color: palette.text, fontSize: 20, fontWeight: '600' },
  count: { color: palette.textSecondary, fontSize: 13 },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 44,
    paddingHorizontal: 20,
    gap: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.surface,
  },
  emptyMark: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: palette.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyMarkText: { color: palette.accent, fontSize: 28 },
  emptyTitle: { color: palette.text, fontSize: 16, fontWeight: '600' },
  emptyDescription: {
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 23,
    textAlign: 'center',
  },
});
