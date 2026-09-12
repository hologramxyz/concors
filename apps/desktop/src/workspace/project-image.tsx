import { useState } from "react";
import { Folder } from "lucide-react";
import { projectInitial } from "./project-initial";
export function ProjectImage({
  source,
  isGit,
  name,
}: {
  source: string | null;
  isGit: boolean;
  name: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span
      className="relative flex size-[20px] shrink-0 items-center justify-center"
      aria-hidden="true"
      data-project-icon={source && loaded && !failed ? "favicon" : isGit ? "initial" : "folder"}
    >
      {(!loaded || failed) &&
        (isGit ? (
          <span className="flex size-[20px] items-center justify-center rounded-sm bg-sidebar-accent text-xs font-semibold text-sidebar-foreground">
            {projectInitial(name)}
          </span>
        ) : (
          <Folder className="size-4 text-muted-foreground" />
        ))}
      {source && !failed && (
        <img
          src={source}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 size-[20px] rounded-sm object-contain ${loaded ? "" : "opacity-0"}`}
        />
      )}
    </span>
  );
}
