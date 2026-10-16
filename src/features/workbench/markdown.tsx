import { useEffect, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { ImageOff } from '@/shared/ui/icons';
import { safePath } from '@/core/workspace/path';
import { T } from '@/shared/ui/primitives';
import { useWorkbenchTheme } from '@/shared/theme';

function Inline({ text, tone = 'text' }: { text: string; tone?: 'text' | 'secondary' }) {
  const theme = useWorkbenchTheme();
  return (
    <T tone={tone} style={{ fontSize: 14, lineHeight: 25 }}>
      {text.split(/(\*\*.*?\*\*|`[^`]+`)/g).map((part, index) =>
        part.startsWith('**') ? (
          <T tone={tone} key={index} style={{ fontWeight: '600' }}>
            {part.slice(2, -2)}
          </T>
        ) : part.startsWith('`') ? (
          <T key={index} style={{ fontFamily: 'monospace', fontSize: 12, color: theme.accent }}>
            {part.slice(1, -1)}
          </T>
        ) : (
          <T tone={tone} key={index}>
            {part}
          </T>
        ),
      )}
    </T>
  );
}

export function resolveImagePath(documentPath: string, target: string): string {
  const decoded = decodeURIComponent(target);
  if (/^[a-z]+:|^\/|\\|\u0000/i.test(decoded)) throw new Error('外部图片不自动加载');
  const parts = documentPath.split('/').slice(0, -1);
  for (const part of decoded.split('/')) {
    if (part === '..') {
      if (!parts.length) throw new Error('图片路径越界');
      parts.pop();
    } else if (part && part !== '.') parts.push(part);
  }
  return safePath(parts.join('/'));
}

function LocalImage({
  source,
  alt,
  load,
}: {
  source: string;
  alt: string;
  load: (target: string) => Promise<string>;
}) {
  const theme = useWorkbenchTheme();
  const [state, setState] = useState<{
    source: string;
    load: typeof load;
    uri?: string;
    failed?: boolean;
  }>();
  const currentState = state?.source === source && state.load === load ? state : undefined;
  useEffect(() => {
    let current = true;
    load(source)
      .then(uri => {
        if (current) setState({ source, load, uri });
      })
      .catch(() => {
        if (current) setState({ source, load, failed: true });
      });
    return () => {
      current = false;
    };
  }, [source, load]);
  return (
    <View style={{ gap: 6, marginVertical: 10 }}>
      {currentState?.uri ? (
        <Image
          source={{ uri: currentState.uri }}
          contentFit="contain"
          accessibilityLabel={alt}
          style={{ height: 220, width: '100%', borderRadius: 9, backgroundColor: theme.inset }}
        />
      ) : (
        <View
          style={{
            height: 70,
            borderRadius: 9,
            backgroundColor: theme.inset,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
          }}
        >
          <ImageOff size={19} color={theme.muted} />
          <T tone="muted" style={{ fontSize: 12 }}>
            {currentState?.failed ? '图片不可用' : '加载图片…'}
          </T>
        </View>
      )}
      {!!alt && (
        <T tone="secondary" style={{ textAlign: 'center', fontSize: 12 }}>
          {alt}
        </T>
      )}
    </View>
  );
}

/** Safe, native rendering for common Markdown. No HTML or remote image loading. */
export function Markdown({
  content,
  loadImage,
  tone = 'text',
}: {
  content: string;
  loadImage?: (target: string) => Promise<string>;
  tone?: 'text' | 'secondary';
}) {
  const theme = useWorkbenchTheme();
  const lines = content.split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line.startsWith('```')) {
      const code = [];
      while (++index < lines.length && !lines[index].startsWith('```')) code.push(lines[index]);
      blocks.push(
        <ScrollView
          horizontal
          key={index}
          style={{ backgroundColor: theme.code, borderRadius: 9, marginVertical: 6 }}
          contentContainerStyle={{ padding: 12 }}
        >
          <T
            selectable
            tone={tone}
            style={{
              fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
              fontSize: 12,
              lineHeight: 20,
            }}
          >
            {code.join('\n')}
          </T>
        </ScrollView>,
      );
    } else if (/^#{1,3} /.test(line)) {
      const level = line.match(/^#+/)![0].length;
      blocks.push(
        <T
          accessibilityRole="header"
          tone={tone}
          key={index}
          style={{
            fontSize: level === 1 ? 22 : level === 2 ? 17 : 15,
            fontWeight: '600',
            lineHeight: level === 1 ? 31 : 26,
            marginTop: 16,
            marginBottom: 6,
          }}
        >
          {line.replace(/^#+ /, '')}
        </T>,
      );
    } else if (/^!\[.*?\]\(.+?\)$/.test(line) && loadImage) {
      const match = /^!\[(.*?)\]\((.+?)\)$/.exec(line)!;
      blocks.push(<LocalImage key={index} source={match[2]} alt={match[1]} load={loadImage} />);
    } else if (/^[-*] /.test(line)) {
      blocks.push(
        <View
          key={index}
          style={{ flexDirection: 'row', gap: 9, paddingLeft: 4, marginVertical: 2 }}
        >
          <T tone="muted">•</T>
          <View style={{ flex: 1 }}>
            <Inline text={line.slice(2)} tone={tone} />
          </View>
        </View>,
      );
    } else if (/^> /.test(line)) {
      blocks.push(
        <View
          key={index}
          style={{
            borderLeftWidth: 2,
            borderColor: theme.border,
            paddingLeft: 12,
            marginVertical: 5,
          }}
        >
          <T tone="secondary" style={{ fontSize: 13, lineHeight: 23 }}>
            {line.slice(2)}
          </T>
        </View>,
      );
    } else if (/^---+$/.test(line.trim()))
      blocks.push(
        <View
          key={index}
          style={{ height: 1, backgroundColor: theme.border, marginVertical: 12 }}
        />,
      );
    else if (!line.trim()) blocks.push(<View key={index} style={{ height: 7 }} />);
    else
      blocks.push(
        <View key={index} style={{ marginVertical: 2 }}>
          <Inline text={line} tone={tone} />
        </View>,
      );
  }
  return <View>{blocks}</View>;
}
