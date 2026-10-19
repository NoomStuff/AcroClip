import { app, BrowserWindow } from "electron";
import process from "node:process";
app.setPath("userData", process.env.ACROCLIP_PROFILE);
app.whenReady().then(() => {
   const window = new BrowserWindow({ width: 1100, height: 650, webPreferences: { sandbox: true } });
   window.loadFile(process.env.ACROCLIP_SLIDER_FIXTURE);
});
app.on("window-all-closed", () => app.quit());
