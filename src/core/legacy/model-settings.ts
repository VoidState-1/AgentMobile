/** Stored v1 shape, read only when migrating provider/model configuration. */
export interface LegacyModelSettings {
  mode: 'demo' | 'remote';
  baseUrl: string;
  model: string;
  imageInput: boolean;
}
