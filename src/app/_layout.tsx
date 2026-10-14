import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useWorkbenchTheme } from '@/shared/theme/use-theme';

export default function RootLayout() {
  const theme = useWorkbenchTheme();
  const navigationTheme = theme.dark ? DarkTheme : DefaultTheme;
  return (
    <SafeAreaProvider style={{ backgroundColor: theme.surface }}>
      <ThemeProvider value={{ ...navigationTheme, colors: { ...navigationTheme.colors,
        background: theme.surface, card: theme.surface, text: theme.text, border: theme.border, primary: theme.accent } }}>
        <StatusBar style={theme.dark ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            statusBarStyle: theme.dark ? 'light' : 'dark',
            contentStyle: { backgroundColor: theme.background },
          }}
        />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
