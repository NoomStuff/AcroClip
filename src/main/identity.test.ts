import { afterEach, expect, it, vi } from "vitest";
import { isPackagedApp, windowsAppId } from "./identity";
vi.mock("electron", () => ({ app: { isPackaged: true } }));
const original = Object.getOwnPropertyDescriptor(process, "defaultApp");
afterEach(() => {
   if (original === undefined) Reflect.deleteProperty(process, "defaultApp");
   else Object.defineProperty(process, "defaultApp", original);
});
it("keeps branded default_app launches in development mode", () => {
   Object.defineProperty(process, "defaultApp", { configurable: true, value: true });
   expect(isPackagedApp()).toBe(false);
   expect(windowsAppId()).toBe("dev.acroclip.app.development");
});
it("recognizes a packaged branded runtime", () => {
   Reflect.deleteProperty(process, "defaultApp");
   expect(isPackagedApp()).toBe(true);
   expect(windowsAppId()).toBe("dev.acroclip.app");
});
