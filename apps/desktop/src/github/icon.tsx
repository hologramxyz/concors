import type { HTMLAttributes } from "react";
import logo from "./github.svg";

/** GitHub mark from Simple Icons (CC0). */
export function GitHubIcon({ style, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      {...props}
      style={{
        display: "inline-block",
        backgroundColor: "currentColor",
        mask: `url("${logo}") center / contain no-repeat`,
        ...style,
      }}
    />
  );
}
