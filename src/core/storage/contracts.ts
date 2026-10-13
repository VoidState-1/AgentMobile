export interface MetadataStore {
  get<T>(bucket: string, id: string): Promise<T | undefined>;
  put<T>(bucket: string, id: string, value: T): Promise<void>;
  all<T>(bucket: string): Promise<T[]>;
}

export interface StorageStat {
  kind: 'file' | 'directory';
  size: number;
  mtime: number;
}

/** Internal host-only filesystem; never supplied to model tools directly. */
export interface HostFileSystem {
  read(path: string): Promise<Uint8Array>;
  write(path: string, bytes: Uint8Array): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  list(path: string): Promise<string[]>;
  stat(path: string): Promise<StorageStat>;
}

export interface CredentialStore {
  get(reference?: string): Promise<string>;
  set(value: string, reference?: string): Promise<void>;
}
