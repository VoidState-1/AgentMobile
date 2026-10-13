import { Buffer } from 'buffer';
import * as Crypto from 'expo-crypto';

// Pi UUID generation needs Web Crypto; Git uses Buffer in its browser build.
const runtime = globalThis as unknown as {
  Buffer?: typeof Buffer;
  crypto?: { getRandomValues: typeof Crypto.getRandomValues; randomUUID: typeof Crypto.randomUUID };
};
runtime.Buffer ??= Buffer;
runtime.crypto ??= { getRandomValues: Crypto.getRandomValues, randomUUID: Crypto.randomUUID };
