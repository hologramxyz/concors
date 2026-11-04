import { expect, it } from "vitest";
import {
  cardPosition,
  frameInside,
  parseTourOutcome,
  TOUR_STEPS,
  tourSteps,
  welcomeTitle,
} from "./steps";

const viewport = { width: 1440, height: 900 };
const card = { width: 320, height: 200 };

it("starts on this computer and leaves the cloud for last", () => {
  expect(TOUR_STEPS[0]?.target).toBe("workspaces");
  expect(TOUR_STEPS.at(-1)?.target).toBe("machines");
  expect(new Set(TOUR_STEPS.map((step) => step.target)).size).toBe(TOUR_STEPS.length);
});

it("leaves out workspace steps when there is no workspace to point at", () => {
  expect(tourSteps(true)).toBe(TOUR_STEPS);
  expect(tourSteps(false).map((step) => step.target)).toEqual([
    "workspaces",
    "schedules",
    "search",
    "machines",
  ]);
});

it("puts the card beside a sidebar control", () => {
  expect(cardPosition({ top: 300, left: 8, width: 240, height: 32 }, card, viewport)).toEqual({
    left: 264,
    top: 300,
  });
});

it("keeps a card beside a control near the bottom inside the window", () => {
  expect(cardPosition({ top: 860, left: 8, width: 240, height: 32 }, card, viewport).top).toBe(688);
});

it("puts the card below a control in the main area, or above it without room", () => {
  expect(cardPosition({ top: 8, left: 600, width: 500, height: 36 }, card, viewport)).toEqual({
    left: 600,
    top: 60,
  });
  expect(cardPosition({ top: 800, left: 1300, width: 100, height: 36 }, card, viewport)).toEqual({
    left: 1108,
    top: 584,
  });
});

it("pulls a frame at the window's edge back inside it", () => {
  expect(frameInside({ top: -4.5, left: 211, width: 1235, height: 50 }, viewport, 4)).toEqual({
    top: 4,
    left: 211,
    width: 1225,
    height: 41.5,
  });
  const inside = { top: 100, left: 300, width: 200, height: 40 };
  expect(frameInside(inside, viewport, 4)).toEqual(inside);
});

it("greets by first name only when it has two letters or more", () => {
  expect(welcomeTitle("Jo")).toBe("Welcome to Concors, Jo");
  expect(welcomeTitle("Zoë")).toBe("Welcome to Concors, Zoë");
  expect(welcomeTitle("z")).toBe("Welcome to Concors");
  expect(welcomeTitle("J.")).toBe("Welcome to Concors");
  expect(welcomeTitle("")).toBe("Welcome to Concors");
});

it("reads only outcomes it wrote", () => {
  expect(parseTourOutcome(null)).toBeNull();
  expect(parseTourOutcome("{")).toBeNull();
  expect(parseTourOutcome(JSON.stringify({ outcome: "maybe" }))).toBeNull();
  expect(parseTourOutcome(JSON.stringify({ outcome: "skipped" }))).toBe("skipped");
});
