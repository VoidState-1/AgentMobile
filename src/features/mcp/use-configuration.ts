import { emptyMcpConfiguration } from '@/core/mcp/types';
import { useAction } from '@/shared/use-action';
import { useAppServices } from '@/shared/use-app-services';
import { useServiceSnapshot } from '@/shared/use-service-snapshot';

export function useMcpConfiguration() {
  const { runtime, error: loadError } = useAppServices();
  const operation = useAction();
  const config = useServiceSnapshot(runtime?.mcp.configuration, emptyMcpConfiguration);
  return { runtime, config, ...operation, error: operation.error || loadError };
}
