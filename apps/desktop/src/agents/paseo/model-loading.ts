// Adapted from getpaseo/paseo, a7a708bec99e935ee4b8c6f7314a4b9a9984cfa6. Apache-2.0; see third-party/paseo-LICENSE.
// Copyright (c) 2025-present Mohamed Boudra. Modified for Concors; see docs/agent-interface.md.
interface ProviderModelsQueryState {
  isFetching: boolean;
  isLoading: boolean;
}

export function isProviderModelsQueryLoading(input: ProviderModelsQueryState): boolean {
  return input.isLoading || input.isFetching;
}
