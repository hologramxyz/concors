import { initialOf } from "@/auth/auth-state";
import { useState, type ReactNode } from "react";
import { UserRound } from "lucide-react";
import { cn } from "cn";
import { useAccountImage } from "./use-account-image";

interface Person {
  id?: string;
  name: string;
  email: string;
  image?: string | null;
}

/** Shared by desktop, the sidebar rail, profile settings, and the mobile account drawer. */
export function AccountAvatar({
  user,
  githubEnabled = false,
  className,
}: {
  user: Person | null | undefined;
  githubEnabled?: boolean;
  className?: string;
}) {
  const { loading, src } = useAccountImage(user, githubEnabled);
  const fallback = user ? initialOf(user) : <UserRound className="size-4" />;
  return (
    <span
      aria-hidden="true"
      data-account-avatar=""
      data-loading={loading || undefined}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-xs font-semibold text-primary-foreground",
        className,
      )}
    >
      {loading ? (
        <span className="size-full bg-muted" />
      ) : src ? (
        <AvatarImage key={`${user?.id ?? "profile"}:${src}`} src={src} fallback={fallback} />
      ) : (
        fallback
      )}
    </span>
  );
}

function AvatarImage({ src, fallback }: { src: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    fallback
  ) : (
    <img
      src={src}
      alt=""
      className="size-full bg-muted object-cover"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  );
}
