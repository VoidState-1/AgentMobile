import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWorkbenchTheme } from '@/shared/theme';
import type { DialogsCapability } from './use-workbench';
import { ProjectTree } from './project-tree';

export interface ProjectDrawerProps {
  controller: DialogsCapability;
  width: number;
  wide: boolean;
  children: ReactNode;
}

export function ProjectDrawer({ controller, width, wide, children }: ProjectDrawerProps) {
  const theme = useWorkbenchTheme();
  return (
    <>
      {children}
      {!wide && (
        <Modal
          transparent
          visible={controller.drawerOpen}
          animationType="none"
          onRequestClose={() => controller.setDrawerOpen(false)}
        >
          <View style={{ flex: 1, backgroundColor: theme.overlay }}>
            <Pressable
              accessibilityLabel="关闭侧栏"
              onPress={() => controller.setDrawerOpen(false)}
              style={{ position: 'absolute', inset: 0 }}
            />
            <SafeAreaView
              edges={['top', 'bottom']}
              style={{
                width: Math.min(320, width * 0.88),
                flex: 1,
                backgroundColor: theme.sidebar,
              }}
            >
              <ProjectTree controller={controller} close={() => controller.setDrawerOpen(false)} />
            </SafeAreaView>
          </View>
        </Modal>
      )}
    </>
  );
}
