/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONCORS_API_URL?: string;
  readonly VITE_CONCORS_DAEMON_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
