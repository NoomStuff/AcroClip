import type { ElectronApplication } from "@playwright/test";

// Playwright calls app.quit over the main-process inspector before detaching.
// An immediate quit can destroy that evaluation before its response is sent.
// Defer only the test driver's invocation, then run the real quit handlers.
export async function closeTestApplication(application: ElectronApplication): Promise<void> {
   const child = application.process();
   if (child.exitCode !== null || child.signalCode !== null) return;
   console.log(`Closing test application ${child.pid}`);
   const shutdownEvents: string[] = [];
   const consoleEvent = (message: { text(): string }) => {
      if (message.text().startsWith("Test shutdown:")) shutdownEvents.push(message.text());
   };
   application.on("console", consoleEvent);
   child.once("exit", (code, signal) => shutdownEvents.push(`Process exit: ${code}, ${signal}`));
   let timer: ReturnType<typeof setTimeout> | undefined;
   const closing = (async () => {
      const page = application.windows().find((window) => !window.isClosed());
      if (page) {
         const status = await page.evaluate(async () => {
            const state = await window.acroClip.state();
            return {
               recorder: state.recorder.state,
               pendingSaves: state.recorder.pendingSaves,
               pendingJobs: state.jobs.filter((job) => job.state === "queued" || job.state === "running").length,
            };
         });
         console.log("Test shutdown state:", JSON.stringify(status));
      }
      await application.evaluate(({ app }) => {
         const quit = app.quit.bind(app);
         app.on("before-quit", () => console.log("Test shutdown: before-quit"));
         app.on("will-quit", () => console.log("Test shutdown: will-quit"));
         app.quit = () => {
            console.log("Test shutdown: quit called");
            setTimeout(quit, 0);
         };
      });
      shutdownEvents.push("Playwright context close requested");
      await application.close();
      shutdownEvents.push("Playwright context close returned");
   })();
   try {
      await Promise.race([
         closing,
         new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Test application did not finish normal shutdown within 30 seconds")), 30000);
         }),
      ]);
      console.log("Test application closed normally");
   } catch (error) {
      console.log("Test shutdown events:", JSON.stringify(shutdownEvents));
      // This is the isolated application launched by this fixture. Forced
      // cleanup after the deadline is a test failure, never a successful quit.
      child.kill("SIGKILL");
      throw error;
   } finally {
      application.off("console", consoleEvent);
      clearTimeout(timer);
   }
}
