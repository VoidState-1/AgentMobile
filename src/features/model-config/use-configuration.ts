import { emptyModelConfiguration } from '@/core/models/types';
import { useAction } from '@/shared/use-action';
import { useAppServices } from '@/shared/use-app-services';
import { useServiceSnapshot } from '@/shared/use-service-snapshot';

export function useModelConfiguration() {
  const { runtime, error: loadError } = useAppServices();
  const operation = useAction();
  const config = useServiceSnapshot(runtime?.models, emptyModelConfiguration);
  return { runtime, config, ...operation, error: operation.error || loadError };
}
export type ModelConfigurationController = ReturnType<typeof useModelConfiguration>;
