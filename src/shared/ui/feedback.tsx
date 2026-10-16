import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { T } from './primitives';

export function Feedback({ error, notice }: { error?: string; notice?: string }) {
  return (
    <>
      {!!error && (
        <T accessibilityRole="alert" tone="danger" variant="caption">
          {error}
        </T>
      )}
      {!!notice && (
        <T tone="accent" variant="caption">
          {notice}
        </T>
      )}
    </>
  );
}

export function FormFooter({
  error,
  notice,
  children,
}: {
  error?: string;
  notice?: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.footer}>
      <Feedback error={error} notice={notice} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ footer: { gap: 6 } });
