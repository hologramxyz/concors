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
  // The sidebar tile's corner, scaled down with the tile: a theme with rounder corners would
  // otherwise turn a small tile into a circle.
  const radius = `min(var(--radius-sm), ${size * 0.15}px)`;
  // Below the 14px chip a fixed letter crowds the tile and the folder looks small beside tiles,
  // so there both follow the tile: the letter as the 20px sidebar tile has it (12px, 0.6 of the
  // tile), and the folder drawn at the box's own size.
  const small = size < 14;
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
            className={`flex size-full items-center justify-center bg-sidebar-accent font-semibold text-sidebar-foreground ${small ? "" : size < 20 ? "text-[10px]" : "text-xs"}`}
            style={{ borderRadius: radius, ...(small ? { fontSize: size * 0.6 } : {}) }}
          >
            {/* Trimmed to the letter's cap height, so the letter itself is centred, not its line:
                the font's ascent and descent would leave a capital above the middle. */}
            <span className="[text-box:trim-both_cap_alphabetic]">{projectInitial(name)}</span>
          </span>
        ) : (
          <Folder
            className="shrink-0 text-muted-foreground"
            style={
              small ? { width: size, height: size } : { width: size * 0.8, height: size * 0.8 }
            }
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
          className={`absolute inset-0 size-full object-contain ${loaded ? "" : "opacity-0"}`}
          style={{ borderRadius: radius }}
        />
      )}
    </span>
  );
}
