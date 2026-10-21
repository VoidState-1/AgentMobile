import { useWorkbenchTheme } from '@/shared/theme';
import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProjectTree } from './project-tree';
import type { NavigationCapability } from './use-workbench';

export interface ProjectDrawerProps {
  controller: NavigationCapability;
  width: number;
  wide: boolean;
  children: ReactNode;
}

export function ProjectDrawer({ controller, width, wide, children }: ProjectDrawerProps) {
  const theme = useWorkbenchTheme();
  const reduceMotion = useReducedMotion();
  const drawerWidth = Math.min(320, width * 0.88);
  const { drawerOpen } = controller;
  const panelStyle = useAnimatedStyle(
    () => ({
      transform: [
        {
          translateX: withTiming(drawerOpen ? 0 : -drawerWidth, {
            duration: reduceMotion ? 0 : 240,
          }),
        },
      ],
    }),
    [drawerOpen, drawerWidth, reduceMotion],
  );
  const overlayStyle = useAnimatedStyle(
    () => ({
      opacity: withTiming(drawerOpen ? 1 : 0, { duration: reduceMotion ? 0 : 200 }),
    }),
    [drawerOpen, reduceMotion],
  );
  return (
    <>
      {children}
      {!wide && (
        <Modal
          transparent
          visible={drawerOpen}
          animationType="none"
          onRequestClose={() => controller.setDrawerOpen(false)}
        >
          <View
            aria-hidden={!drawerOpen}
            accessibilityElementsHidden={!drawerOpen}
            importantForAccessibility={drawerOpen ? 'auto' : 'no-hide-descendants'}
            pointerEvents={drawerOpen ? 'auto' : 'none'}
            style={{ flex: 1, display: drawerOpen ? 'flex' : 'none' }}
          >
            <Animated.View
              pointerEvents="none"
              style={[
                { position: 'absolute', inset: 0, backgroundColor: theme.overlay },
                overlayStyle,
              ]}
            />
            <Pressable
              accessibilityLabel="关闭侧栏"
              disabled={!drawerOpen}
              onPress={() => controller.setDrawerOpen(false)}
              style={{ position: 'absolute', inset: 0 }}
            />
            <Animated.View
              aria-hidden={!drawerOpen}
              accessibilityElementsHidden={!drawerOpen}
              importantForAccessibility={drawerOpen ? 'auto' : 'no-hide-descendants'}
              pointerEvents={drawerOpen ? 'auto' : 'none'}
              style={[
                {
                  width: drawerWidth,
                  flex: 1,
                  backgroundColor: theme.sidebar,
                },
                panelStyle,
              ]}
            >
              <SafeAreaView edges={['top', 'bottom']} style={{ flex: 1 }}>
                <ProjectTree
                  controller={controller}
                  close={() => controller.setDrawerOpen(false)}
                />
              </SafeAreaView>
            </Animated.View>
          </View>
        </Modal>
      )}
    </>
  );
}
