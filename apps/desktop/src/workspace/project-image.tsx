import { useState } from "react";
import { Folder } from "lucide-react";
export function ProjectImage({ source }: { source: string | null }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className="relative size-4 shrink-0" aria-hidden="true">
      {(!loaded || failed) && <Folder className="size-4 text-muted-foreground" />}
      {source && !failed && (
        <img
          src={source}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 size-4 rounded-sm object-cover ${loaded ? "" : "opacity-0"}`}
        />
      )}
    </span>
  );
}
