import { useState } from "react";
import { Folder } from "lucide-react";
import { projectInitial } from "./project-initial";
export function ProjectImage({
  source,
  isGit,
  name,
  size = 20,
}: {
  source: string | null;
  isGit: boolean;
  name: string;
  /** Pixels; sidebar rows use 20, compact chips 16. */
  size?: number;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden="true"
      data-project-icon={source && loaded && !failed ? "favicon" : isGit ? "initial" : "folder"}
    >
      {(!loaded || failed) &&
        (isGit ? (
          <span
            className={`flex size-full items-center justify-center rounded-sm bg-sidebar-accent font-semibold text-sidebar-foreground ${size < 20 ? "text-[10px]" : "text-xs"}`}
          >
            {projectInitial(name)}
          </span>
        ) : (
          <Folder
            className="text-muted-foreground"
            style={{ width: size * 0.8, height: size * 0.8 }}
          />
        ))}
      {source && !failed && (
        <img
          src={source}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 size-full rounded-sm object-contain ${loaded ? "" : "opacity-0"}`}
        />
      )}
    </span>
  );
}
