import { afterEach, expect, it, vi } from "vitest";
import { NativeSessions } from "./native-sessions.ts";
import { TestAgentProvider } from "./testing/provider.ts";
import { ProviderRegistry } from "./providers/registry.ts";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function setup(engine = "codex") {
  const registry = new ProviderRegistry();
  const config = registry.config("codex");
  vi.spyOn(registry, "config").mockImplementation((id) => ({
    ...config,
    id,
    engine: engine as typeof config.engine,
  }));
  vi.spyOn(registry, "installed").mockReturnValue(true);
  const providers: TestAgentProvider[] = [];
  const factory = vi.fn(
    (cwd: string, onInput: ConstructorParameters<typeof TestAgentProvider>[0]) => {
      const provider = new TestAgentProvider(onInput);
      provider.cwd = cwd;
      vi.spyOn(provider, "initialize");
      providers.push(provider);
      return provider;
    },
  );
  return { service: new NativeSessions(factory, registry), factory, providers, registry };
}

it("shares discovery in flight, filters queries without launching another process, and refreshes explicitly", async () => {
  const { service, providers } = setup();
  try {
    const pages = await Promise.all([
      service.list("codex", process.cwd()),
      service.list("codex", process.cwd(), undefined, "CLI session"),
    ]);
    expect(pages[0].sessions).toHaveLength(100);
    expect(providers).toHaveLength(1);
    expect(providers[0]?.requests.map((r) => r.method)).toEqual(["session/list"]);
    expect(providers[0]?.closed).toBe(true);
    await service.list("codex", process.cwd(), undefined, "125", true);
    expect(providers).toHaveLength(2);
    const next = await service.list("codex", process.cwd(), "100", "125");
    expect(next.sessions.map((s) => s.id)).toEqual(["external-thread-125"]);
    expect(next.nextCursor).toBeNull();
  } finally {
    await service.close();
  }
});

it.each(["claude", "pi", "omp"])(
  "does not initialize a %s conversation to list transcripts",
  async (engine) => {
    const { service, providers } = setup(engine);
    try {
      await service.list(engine, process.cwd());
      expect(providers[0]?.initialize).not.toHaveBeenCalled();
      expect(providers[0]?.requests.map((r) => r.method)).toEqual(["session/list"]);
    } finally {
      await service.close();
    }
  },
);

it("scopes offered IDs to provider configuration and directory and expires them", async () => {
  const { service, registry } = setup();
  try {
    await service.list("codex", process.cwd());
    expect(service.selected("codex", process.cwd(), "external-thread").title).toBe("CLI session");
    expect(() => service.selected("claude", process.cwd(), "external-thread")).toThrow("Refresh");
    expect(() => service.selected("codex", "/another-workspace", "external-thread")).toThrow(
      "Refresh",
    );
    vi.spyOn(registry, "revision", "get").mockReturnValue(1);
    expect(() => service.selected("codex", process.cwd(), "external-thread")).toThrow("Refresh");
  } finally {
    await service.close();
  }
});

it("expires cached pages and offered sessions", async () => {
  const { service, providers } = setup();
  try {
    await service.list("codex", process.cwd());
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
    await service.list("codex", process.cwd());
    expect(providers).toHaveLength(2);
    vi.mocked(Date.now).mockReturnValue(now + 400_000);
    expect(() => service.selected("codex", process.cwd(), "external-thread")).toThrow("Refresh");
  } finally {
    await service.close();
  }
});

it("does not offer another directory's sessions and blocks known busy sessions", async () => {
  const { service, factory } = setup();
  factory.mockImplementation((cwd, handler) => {
    const provider = new TestAgentProvider(handler);
    vi.spyOn(provider, "request").mockResolvedValue({
      sessions: [
        {
          id: "foreign",
          title: "Foreign",
          directory: "/another-workspace",
          updatedAt: new Date().toISOString(),
        },
        {
          id: "busy",
          title: "Busy",
          directory: cwd + "/.",
          updatedAt: new Date().toISOString(),
          busy: true,
        },
      ],
    });
    return provider;
  });
  try {
    const page = await service.list("codex", process.cwd());
    expect(page.sessions.map((s) => s.id)).toEqual(["busy"]);
    expect(() => service.selected("codex", process.cwd(), "foreign")).toThrow("Refresh");
    expect(() => service.selected("codex", process.cwd(), "busy")).toThrow("still working");
  } finally {
    await service.close();
  }
});

it("times out and closes failed probes, and allows another provider to succeed", async () => {
  vi.useFakeTimers();
  const { service, factory } = setup();
  const provider = new TestAgentProvider(async () => ({}));
  vi.spyOn(provider, "initialize").mockImplementation(() => new Promise(() => undefined));
  factory.mockReturnValueOnce(provider);
  try {
    const failed = expect(service.list("codex", process.cwd())).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(15_000);
    await failed;
    expect(provider.closed).toBe(true);
    expect((await service.list("another-profile", process.cwd())).sessions).toHaveLength(100);
  } finally {
    await service.close();
  }
});
