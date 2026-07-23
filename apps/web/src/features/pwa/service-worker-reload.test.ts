import { describe, expect, it } from "vitest";
import { shouldReloadOnControllerChange } from "./service-worker-registration";

// sw.js claims clients on activate, so the very first install fires controllerchange on a
// page that never had a controller. Reloading there wiped in-progress user input (the auth
// form lost its earliest-typed field). Only a real takeover — a page that already had a
// controller — may reload, and only once.
describe("controllerchange reload policy", () => {
  it("does not reload when the first install merely claims an uncontrolled page", () => {
    expect(shouldReloadOnControllerChange(false, false)).toBe(false);
  });

  it("reloads when a new version takes over a page that already had a controller", () => {
    expect(shouldReloadOnControllerChange(true, false)).toBe(true);
  });

  it("never reloads twice", () => {
    expect(shouldReloadOnControllerChange(true, true)).toBe(false);
  });
});
