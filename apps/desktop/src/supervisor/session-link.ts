import { createContext } from "react";

export const SessionLinkContext = createContext<((sessionId: string) => void) | null>(null);
export function sessionLink(href: string | undefined): string | null {
  const match =
    /^concors:\/\/session\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(
      href ?? "",
    );
  return match?.[1] ?? null;
}
