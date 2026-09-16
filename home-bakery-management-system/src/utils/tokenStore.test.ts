import { describe, it, expect, beforeEach } from "vitest";
import { getDeviceToken, setDeviceToken, clearDeviceToken } from "./tokenStore";

describe("tokenStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a token through localStorage", async () => {
    expect(await getDeviceToken()).toBeNull();
    await setDeviceToken("abc123");
    expect(await getDeviceToken()).toBe("abc123");
  });

  it("clears a stored token", async () => {
    await setDeviceToken("abc123");
    await clearDeviceToken();
    expect(await getDeviceToken()).toBeNull();
  });
});
