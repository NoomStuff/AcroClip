import { describe, expect, it } from "vitest";
import type { GameCandidate } from "../../shared/types";
import { applicationChoiceName, applicationChoices } from "./application-choices";

const window = (id: string, executable: string, name: string, applicationName?: string): GameCandidate => ({
   id,
   pid: 1,
   name,
   executable,
   foreground: false,
   fullscreen: false,
   ...(applicationName ? { applicationName } : {}),
});

describe("applicationChoices", () => {
   it("offers each app once, under its short name, and leaves out the Store app host", () => {
      const choices = applicationChoices([
         window("window:1", "C:\\Apps\\Helium\\helium.exe", "Steam Support - Helium", "Helium"),
         window("window:2", "C:/apps/helium/HELIUM.exe", "Desktop Leafette - Helium", "Helium"),
         window("window:3", "C:\\Windows\\System32\\ApplicationFrameHost.exe", "Settings", "Application Frame Host"),
         window("window:4", "C:\\Discord\\discord.exe", "Friends - Discord", "Discord"),
      ]);
      expect(choices.map((app) => app.id)).toEqual(["window:1", "window:4"]);
      expect(choices.map(applicationChoiceName)).toEqual(["Helium", "Discord"]);
   });
});
