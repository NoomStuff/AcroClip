import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { defaultPreferences } from "../../shared/defaults";
import { NotificationSettings } from "./NotificationSettings";

it("uses one row per action and keeps the error banner checked and disabled", () => {
   const html = renderToStaticMarkup(createElement(NotificationSettings, { value: defaultPreferences, onChange: () => undefined }));
   expect(html.match(/notification-settings-row/g)).toHaveLength(4);
   expect(html.match(/type="checkbox"/g)).toHaveLength(8);
   expect(html.match(/disabled=""/g)).toHaveLength(1);
   const errorBanner = html.match(/<input[^>]*aria-label="Error banner"[^>]*>/)?.[0] ?? "";
   expect(errorBanner).toContain('checked=""');
   expect(errorBanner).toContain('disabled=""');
   expect(html).not.toContain("Always shown");
   expect(html).toContain("Capture and save failures.");
   expect(html).toContain("Banner</span>");
   expect(html).toContain("Sound</span>");
   expect(html).not.toContain("Fullscreen");
});
it("renders each action's banner and sound separately", () => {
   const html = renderToStaticMarkup(
      createElement(NotificationSettings, {
         value: {
            ...defaultPreferences,
            notificationStartBanner: false,
            notificationStopSound: false,
            notificationErrorSound: false,
         },
         onChange: () => undefined,
      })
   );
   const input = (label: string) => html.match(new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";
   expect(input("Start capture banner")).not.toContain('checked=""');
   expect(input("Start capture sound")).toContain('checked=""');
   expect(input("Stop capture banner")).toContain('checked=""');
   expect(input("Stop capture sound")).not.toContain('checked=""');
   expect(input("Error sound")).not.toContain('checked=""');
});
