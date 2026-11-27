import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { SidebarSection } from "./sidebar-section";

const section = (props: Omit<Partial<Parameters<typeof SidebarSection>[0]>, "children"> = {}) =>
  renderToStaticMarkup(
    createElement(SidebarSection, {
      title: "Done",
      label: true,
      ...props,
      children: "Release editor",
    }),
  );

it("starts open unless told otherwise", () => {
  const html = section();
  expect(html).toContain('aria-expanded="true"');
  expect(html).not.toContain("data-collapsed");
});

it("starts folded to its header when asked", () => {
  const html = section({ defaultExpanded: false });
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('data-collapsed="true"');
});

it("draws a function action for whether it is open", () => {
  const action = (expanded: boolean) => (expanded ? "action-open" : "action-folded");
  expect(section({ action })).toContain("action-open");
  expect(section({ action, defaultExpanded: false })).toContain("action-folded");
});
