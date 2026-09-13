import { api } from "@/auth/api";
import { useApiResource } from "./api-resource";

export function useSshKeys(organizationId: string | undefined) {
  return useApiResource(`ssh-keys:${organizationId ?? ""}`, () =>
    api.listSshKeys(organizationId === undefined ? {} : { organizationId }),
  );
}
