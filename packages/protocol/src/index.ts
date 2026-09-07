/**
 * @concors/protocol
 *
 * The contract between Concors clients (desktop, mobile, web) and Concors daemons (local or
 * remote). This package contains only schemas, types, and pure helpers — no I/O, no runtime
 * assumptions about Node or the browser — so it can be consumed by every client and mirrored
 * one-to-one by a daemon written in any language.
 */

export * from "./version.ts";
export * from "./errors.ts";
export * from "./daemon.ts";
export * from "./client.ts";
export * from "./messages.ts";
export * from "./transport.ts";
export * from "./workspace.ts";
export * from "./workspace-reducer.ts";
export * from "./terminal.ts";

export * from "./projects.ts";
