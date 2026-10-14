export interface ModelSettings {
  mode: 'demo' | 'remote';
  baseUrl: string;
  model: string;
  imageInput: boolean;
}

export const defaultSettings: ModelSettings = {
  mode: 'demo',
  baseUrl: '',
  model: '',
  imageInput: false,
};
