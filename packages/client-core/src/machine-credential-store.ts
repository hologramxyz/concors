import type { CredentialStorage } from "./token-store.ts";

/** One native socket credential. Serialized writes and leases keep cancelled mints from surviving. */
export class MachineCredentialStore {
  private generation = 0;
  private writes: Promise<void> = Promise.resolve();
  private readonly storage: CredentialStorage;
  constructor(storage: CredentialStorage) {
    this.storage = storage;
  }
  private write(value: string | null): Promise<void> {
    const result = this.writes.then(() => this.storage.write(value));
    this.writes = result.catch(() => undefined);
    return result;
  }
  clear(): Promise<void> {
    this.generation++;
    return this.write(null);
  }
  begin(scope: string, machineId: string) {
    const generation = ++this.generation;
    return {
      save: async (token: string) => {
        if (generation !== this.generation) return;
        await this.write(JSON.stringify({ scope, machineId, token }));
      },
      clear: async () => {
        if (generation !== this.generation) return;
        await this.clear();
      },
    };
  }
}
