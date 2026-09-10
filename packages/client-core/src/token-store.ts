import type { TokenStore } from "@concors/api-client";
export interface CredentialStorage {
  read(): Promise<string | null>;
  write(token: string | null): Promise<void>;
}

/** Hydrate before using ApiClient. Serialize writes so sign-out always wins. */
export class HydratedTokenStore implements TokenStore {
  private token: string | null = null;
  private hydrated = false;
  private loading: Promise<void> | null = null;
  private writes: Promise<void> = Promise.resolve();
  private error: unknown;
  private readonly storage: CredentialStorage;
  constructor(storage: CredentialStorage) {
    this.storage = storage;
  }
  hydrate(): Promise<void> {
    return (this.loading ??= this.storage
      .read()
      .then((token) => {
        this.token = token;
        this.hydrated = true;
      })
      .catch((error: unknown) => {
        this.loading = null;
        throw error;
      }));
  }
  get(): string | null {
    if (!this.hydrated) throw new Error("Session storage is still loading");
    return this.token;
  }
  set(token: string | null): void {
    if (!this.hydrated) throw new Error("Session storage is still loading");
    this.token = token;
    this.writes = this.writes
      .then(() => this.storage.write(token))
      .then(() => {
        this.error = undefined;
      })
      .catch((error: unknown) => {
        this.error = error;
      });
  }
  /** Do not report auth complete before secure persistence succeeds. */
  async flush(): Promise<void> {
    await this.writes;
    if (this.error) throw new Error("Could not save the session securely. Please try again.");
  }
}
