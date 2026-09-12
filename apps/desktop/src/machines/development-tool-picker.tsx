import type { DevelopmentTools, MachineCatalog } from "@concors/api-client";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import nodeLogo from "./tool-logos/nodedotjs.svg";
import dockerLogo from "./tool-logos/docker.svg";
import pythonLogo from "./tool-logos/python.svg";
import goLogo from "./tool-logos/go.svg";
import rustLogo from "./tool-logos/rust.svg";

const additionalTools = [
  { id: "python", name: "Python", description: "Python & uv", logo: pythonLogo, color: "#4B8BBE" },
  { id: "go", name: "Go", description: "Go compiler & tools", logo: goLogo, color: "#00ADD8" },
  { id: "rust", name: "Rust", description: "Rust & Cargo", logo: rustLogo, color: "#D9A183" },
] as const;

function ToolCard({
  name,
  description,
  logo,
  color,
  checked,
  onChange,
  children,
  wide = false,
}: {
  readonly name: string;
  readonly description: string;
  readonly logo: string;
  readonly color: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly children?: ReactNode;
  readonly wide?: boolean;
}) {
  return (
    <div
      className={`${wide ? "sm:col-span-2" : ""} relative flex min-w-0 flex-col rounded-xl border transition-colors ${checked ? "border-foreground/35 bg-foreground/[0.035]" : "border-border bg-background/20 hover:border-foreground/20"}`}
    >
      <label className="relative flex cursor-pointer items-start gap-3.5 p-5">
        <input
          type="checkbox"
          aria-label={name}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0"
        />
        <span
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-background/70 ring-1 ring-foreground/5 ring-inset"
          aria-hidden="true"
        >
          <span
            className="size-7"
            style={{ backgroundColor: color, mask: `url("${logo}") center / contain no-repeat` }}
          />
        </span>
        <span className="min-w-0 flex-1 pt-0.5">
          <span className="block text-sm font-medium text-foreground">{name}</span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
            {description}
          </span>
        </span>
        <span
          aria-hidden="true"
          className={`mt-1 flex size-4 shrink-0 items-center justify-center rounded border peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background ${checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}
        >
          {checked && <Check className="size-3" strokeWidth={3} />}
        </span>
      </label>
      {children}
    </div>
  );
}

export function DevelopmentToolPicker({
  tools,
  catalog,
  onChange,
}: {
  readonly tools: DevelopmentTools;
  readonly catalog: NonNullable<MachineCatalog["developmentTools"]>;
  readonly onChange: (tools: DevelopmentTools) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ToolCard
        name="Node.js"
        description="JavaScript & TypeScript"
        logo={nodeLogo}
        color="#5FA04E"
        checked={tools.node !== null}
        onChange={(checked) =>
          onChange({ ...tools, node: checked ? (catalog.nodeVersions[0] ?? "lts") : null })
        }
      >
        <div className="relative mx-5 mt-auto mb-5">
          <select
            aria-label="Node.js version"
            disabled={tools.node === null}
            value={tools.node ?? "lts"}
            onChange={(event) =>
              onChange({ ...tools, node: event.target.value as DevelopmentTools["node"] })
            }
            className="h-9 w-full appearance-none rounded-md border border-border/70 bg-background/50 py-1.5 pr-8 pl-3 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            {catalog.nodeVersions.map((version) => (
              <option key={version} value={version}>
                {version === "lts" ? "Latest LTS" : `Node ${version} · latest patch`}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute top-3 right-3 size-3 text-muted-foreground"
          />
        </div>
      </ToolCard>
      {additionalTools
        .filter((tool) => catalog.additionalTools?.includes(tool.id))
        .map((tool) => (
          <ToolCard
            key={tool.id}
            name={tool.name}
            description={tool.description}
            logo={tool.logo}
            color={tool.color}
            checked={tools[tool.id] === true}
            onChange={(checked) => onChange({ ...tools, [tool.id]: checked })}
          >
            <p className="mx-5 mt-auto mb-5 flex h-9 items-center text-xs text-muted-foreground">
              Latest stable
            </p>
          </ToolCard>
        ))}
      <ToolCard
        wide
        name="Docker"
        description="Containers & Compose · latest stable"
        logo={dockerLogo}
        color="#2496ED"
        checked={tools.docker}
        onChange={(checked) => onChange({ ...tools, docker: checked })}
      />
    </div>
  );
}
