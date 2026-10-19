import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defaultPreferences } from "../../src/shared/defaults";

test("Windows screen preview preserves neutral colors through compositor feedback", async () => {
   test.skip(process.platform !== "win32" || process.env["ACROCLIP_TEST_SCREEN_COLOR"] !== "1", "Uses a controlled fullscreen fixture on Windows");
   test.setTimeout(90000);
   const profile = await mkdtemp(join(tmpdir(), "acroclip-screen-color-"));
   const collection = join(profile, "clips");
   await mkdir(collection);
   await writeFile(
      join(profile, "preferences.json"),
      JSON.stringify({
         ...defaultPreferences,
         audioSourcesVersion: undefined,
         audioSources: [],
         setupComplete: true,
         collection,
         sourceKind: "app",
         sourceId: "window:0:0",
         captureAudio: false,
         microphone: false,
         shortcut: "Control+Alt+Shift+F7",
      })
   );
   const desktop = await electron.launch({
      args: [resolve("."), "--disable-gpu-sandbox"],
      env: { ...process.env, ACROCLIP_TEST: "1", ACROCLIP_PROFILE: profile },
   });
   try {
      const page = await desktop.firstWindow();
      const displayId = await desktop.evaluate(async ({ BrowserWindow, screen }) => {
         const fixture = new BrowserWindow({ title: "Screen color fixture", width: 640, height: 360, frame: false, webPreferences: { sandbox: true } });
         await fixture.loadURL(
            "data:text/html," +
               encodeURIComponent(
                  `<title>Screen color fixture</title><body style="margin:0;overflow:hidden"><canvas id="c" width="640" height="360" style="width:100vw;height:100vh"></canvas><script>const c=document.getElementById('c'),x=c.getContext('2d');const colors=['#808080','#404040','#c0c0c0','#ff0000','#00ff00','#0000ff','#202020','#e0e0e0'];function paint(){if(window.freeze)return;colors.forEach((v,i)=>{x.fillStyle=v;x.fillRect(i%4*160,32+Math.floor(i/4)*164,160,164)});const t=Date.now()>>>0;for(let i=0;i<32;i++){x.fillStyle=(t>>>i)&1?'white':'black';x.fillRect(i*16,0,16,32)}requestAnimationFrame(paint)}paint()</script>`
               )
         );
         const display = screen.getDisplayMatching(fixture.getBounds());
         fixture.setAlwaysOnTop(true, "screen-saver");
         fixture.setBounds(display.bounds);
         fixture.setFullScreen(true);
         fixture.show();
         fixture.focus();
         return String(display.id);
      });
      // Prime the counters while only the controlled fixture is rendering.
      await desktop.evaluate(({ app }) => app.getAppMetrics());
      await page.waitForTimeout(3000);
      const baseline = await desktop.evaluate(({ app }) => app.getAppMetrics());
      const sources = await page.evaluate(() => window.acroClip.sources());
      const source = sources.find((item) => item.kind === "screen" && item.displayId === displayId);
      expect(source).toBeDefined();
      await page.evaluate(async (id) => {
         const state = await window.acroClip.state();
         await window.acroClip.savePreferences({ ...state.preferences, sourceKind: "screen", sourceId: id });
      }, source!.id);
      await expect(page.locator(".preview-canvas.ready")).toBeVisible({ timeout: 20000 });
      await desktop.evaluate(({ app }) => app.getAppMetrics());
      await page.waitForTimeout(5000);
      const preview = await desktop.evaluate(({ app }) => app.getAppMetrics());
      const latency = await page.locator(".preview-stream").evaluate(async (video: HTMLVideoElement) => {
         const surface = document.createElement("canvas");
         surface.width = 640;
         surface.height = 360;
         const context = surface.getContext("2d")!;
         const values: number[] = [];
         for (let count = 0; count < 18; count++) {
            await new Promise<void>((resolve) => video.requestVideoFrameCallback(() => resolve()));
            context.drawImage(video, 0, 0, 640, 360);
            const pixels = context.getImageData(0, 0, 640, 32).data;
            let timestamp = 0;
            for (let bit = 0; bit < 32; bit++) if (pixels[(16 * 640 + bit * 16 + 8) * 4]! > 128) timestamp += 2 ** bit;
            values.push((Date.now() - (timestamp >>> 0)) >>> 0);
         }
         return values;
      });
      await desktop.evaluate(({ BrowserWindow }) =>
         BrowserWindow.getAllWindows()
            .find((window) => window.getTitle() === "Screen color fixture")!
            .webContents.executeJavaScript("window.freeze=true")
      );
      const passes: number[][][] = [];
      for (let pass = 0; pass < 12; pass++) {
         await page.waitForTimeout(250);
         const geometry = await page.locator(".preview-stream").evaluate((video: HTMLVideoElement) => {
            const bounds = video.getBoundingClientRect(),
               scale = Math.min(bounds.width / video.videoWidth, bounds.height / video.videoHeight),
               width = video.videoWidth * scale,
               height = video.videoHeight * scale;
            return { x: bounds.x + (bounds.width - width) / 2, y: bounds.y + (bounds.height - height) / 2, width, height };
         });
         const png = await page.screenshot({ clip: geometry });
         const colors = await desktop.evaluate(({ nativeImage }, encoded) => {
            const data = nativeImage.createFromBuffer(Buffer.from(encoded, "base64")).resize({ width: 640, height: 360 }).toBitmap();
            return Array.from({ length: 8 }, (_, index) => {
               const offset = ((32 + Math.floor(index / 4) * 164 + 82) * 640 + (index % 4) * 160 + 80) * 4;
               return [data[offset + 2]!, data[offset + 1]!, data[offset]!];
            });
         }, png.toString("base64"));
         passes.push(colors);
         for (const index of [0, 1, 2, 6, 7]) expect(Math.max(...colors[index]!) - Math.min(...colors[index]!)).toBeLessThanOrEqual(2);
         for (const [index, expected] of [
            [0, 128],
            [1, 64],
            [2, 192],
         ])
            for (const channel of colors[index!]!) expect(Math.abs(channel - expected!)).toBeLessThanOrEqual(2);
         await desktop.evaluate(
            ({ BrowserWindow }, encoded) =>
               BrowserWindow.getAllWindows()
                  .find((window) => window.getTitle() === "Screen color fixture")!
                  .webContents.executeJavaScript(
                     "new Promise(resolve=>{const image=new Image();image.onload=()=>{document.getElementById('c').getContext('2d').drawImage(image,0,0,640,360);resolve()};image.src=" +
                        JSON.stringify("data:image/png;base64," + encoded) +
                        "})"
                  ),
            png.toString("base64")
         );
      }
      const cpu = (metrics: typeof baseline) => metrics.reduce((sum, process) => sum + process.cpu.percentCPUUsage, 0);
      console.log(
         "Screen preview proof",
         JSON.stringify({
            latency,
            cpuBaseline: cpu(baseline),
            cpuPreview: cpu(preview),
            baselineMemoryKB: baseline.reduce((sum, process) => sum + process.memory.workingSetSize, 0),
            previewMemoryKB: preview.reduce((sum, process) => sum + process.memory.workingSetSize, 0),
            passes,
         })
      );
      expect(latency.sort((a, b) => a - b)[9]).toBeLessThan(250);
      await page.locator(".preview-stream").evaluate((video: HTMLVideoElement) => {
         (window as unknown as { previewTracks: MediaStreamTrack[] }).previewTracks = (video.srcObject as MediaStream).getTracks();
      });
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await expect
         .poll(() =>
            page.evaluate(() => (window as unknown as { previewTracks: MediaStreamTrack[] }).previewTracks.every((track) => track.readyState === "ended"))
         )
         .toBe(true);
      expect((await page.evaluate(() => window.acroClip.state())).recorder.state).toBe("stopped");
   } finally {
      await desktop.close();
   }
});
