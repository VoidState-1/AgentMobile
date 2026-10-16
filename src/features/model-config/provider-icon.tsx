import { resolveProviderBrand } from '@/core/models/presets';
import type { ProviderConnection } from '@/core/models/types';
import { useWorkbenchTheme } from '@/shared/theme';
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect, SvgXml } from 'react-native-svg';
import marks from './assets/provider-marks.json';

function DefaultProviderMark() {
  const theme = useWorkbenchTheme();
  return (
    <Svg viewBox="0 0 32 32" width="100%" height="100%">
      <Rect x={2} y={2} width={28} height={28} rx={7} fill={theme.accentSoft} />
      <Path
        d="M10 10 16 16 22 10M10 22 16 16 22 22"
        stroke={theme.accent}
        strokeWidth={1.5}
        fill="none"
      />
      <Path d="m16 12 4 4-4 4-4-4Z" fill={theme.accent} />
      {[
        [10, 10],
        [22, 10],
        [10, 22],
        [22, 22],
      ].map(([cx, cy]) => (
        <Circle key={cx + ':' + cy} cx={cx} cy={cy} r={2} fill={theme.accent} />
      ))}
    </Svg>
  );
}

export function ProviderIcon({
  presetId,
  baseUrl,
  icon,
  size = 28,
}: Partial<Pick<ProviderConnection, 'presetId' | 'baseUrl' | 'icon'>> & { size?: number }) {
  const theme = useWorkbenchTheme();
  const brand = resolveProviderBrand(presetId, baseUrl);
  const mark =
    brand && Object.hasOwn(marks, brand) ? marks[brand as keyof typeof marks] : undefined;
  const uri = icon ? 'data:' + icon.mediaType + ';base64,' + icon.base64 : undefined;
  const [failed, setFailed] = useState<string>();
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={
        uri && failed !== uri ? '自定义供应商图标' : mark ? '供应商品牌图标' : '默认供应商图标'
      }
      style={[styles.frame, { width: size, height: size }]}
    >
      {uri && failed !== uri ? (
        <Image
          source={{ uri }}
          style={styles.image}
          contentFit="cover"
          onError={() => setFailed(uri)}
        />
      ) : mark ? (
        <SvgXml xml={mark} width="100%" height="100%" color={theme.text} />
      ) : (
        <DefaultProviderMark />
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  frame: { borderRadius: 6, overflow: 'hidden', flexShrink: 0 },
  image: { width: '100%', height: '100%' },
});
