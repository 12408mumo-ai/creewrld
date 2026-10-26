import { beforeEach, describe, expect, it } from "vitest";
import {
  STUDIO_KEY,
  STUDIO_PASSPHRASE,
  isStudioUnlocked,
  lockStudio,
  normalizePassphrase,
  passphraseMatches,
  readStudioFlag,
  setStudioStorage,
  unlockStudio
} from "../../src/data/studio.js";

/** In-memory sessionStorage stand-in. */
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    clear: () => map.clear(),
    _map: map
  };
}

let session;

beforeEach(() => {
  session = memoryStorage();
  setStudioStorage(session);
});

describe("the studio passphrase", () => {
  it("is creewrld.com", () => {
    expect(STUDIO_PASSPHRASE).toBe("creewrld.com");
  });

  it("matches only the exact passphrase, after trimming and folding case", () => {
    expect(passphraseMatches("creewrld.com")).toBe(true);
    expect(passphraseMatches("  creewrld.com  ")).toBe(true);
    expect(passphraseMatches("CreeWrld.COM")).toBe(true);

    expect(passphraseMatches("creewrld")).toBe(false);
    expect(passphraseMatches("creewrld.com ")).toBe(true);
    expect(passphraseMatches("creewrld.co")).toBe(false);
    expect(passphraseMatches("creewrld.comm")).toBe(false);
    expect(passphraseMatches("")).toBe(false);
    expect(passphraseMatches(undefined)).toBe(false);
    expect(passphraseMatches(null)).toBe(false);
  });

  it("normalises the way the form expects", () => {
    expect(normalizePassphrase("  CreeWrld.Com \n")).toBe("creewrld.com");
  });
});

describe("the session flag", () => {
  it("is absent until the studio is unlocked", () => {
    expect(isStudioUnlocked()).toBe(false);
    expect(session.getItem(STUDIO_KEY)).toBeNull();
  });

  it("is written as 'true' on a correct passphrase", () => {
    expect(unlockStudio("creewrld.com")).toBe(true);
    expect(session.getItem("isAdmin")).toBe("true");
    expect(isStudioUnlocked()).toBe(true);
  });

  it("is not written for a wrong passphrase", () => {
    expect(unlockStudio("nope")).toBe(false);
    expect(session.getItem("isAdmin")).toBeNull();
    expect(isStudioUnlocked()).toBe(false);
  });

  it("is removed by locking", () => {
    unlockStudio("creewrld.com");
    lockStudio();
    expect(session.getItem("isAdmin")).toBeNull();
    expect(isStudioUnlocked()).toBe(false);
  });

  it("treats any value other than 'true' as locked", () => {
    session.setItem("isAdmin", "false");
    expect(isStudioUnlocked()).toBe(false);
    session.setItem("isAdmin", "1");
    expect(isStudioUnlocked()).toBe(false);
  });

  it("survives storage being unavailable, without throwing", () => {
    setStudioStorage({
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      }
    });

    expect(() => unlockStudio("creewrld.com")).not.toThrow();
    expect(unlockStudio("creewrld.com")).toBe(true); // still unlocks this page
    expect(isStudioUnlocked()).toBe(false);          // just cannot be remembered
    expect(() => lockStudio()).not.toThrow();
  });
});

describe("readStudioFlag — the three-way answer", () => {
  it("is false when the flag is absent", () => {
    expect(readStudioFlag()).toBe(false);
  });

  it("is true once unlocked", () => {
    unlockStudio("creewrld.com");
    expect(readStudioFlag()).toBe(true);
  });

  it("is null — not false — when storage cannot be read", () => {
    setStudioStorage({
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      }
    });

    // The distinction matters: a locked-down browser is not a logout.
    expect(readStudioFlag()).toBeNull();
    expect(isStudioUnlocked()).toBe(false);
  });
});
