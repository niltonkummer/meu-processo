import { createBrowserRendererServer } from "./infrastructure/browser-renderer-server.js";
import { PlaywrightTjrsDriverFactory } from "./infrastructure/playwright-tjrs-driver.js";

const port = Number(process.env.PORT ?? 8080);
if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be a valid TCP port.");
}

const server = createBrowserRendererServer({
  driverFactory: new PlaywrightTjrsDriverFactory(),
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Browser renderer listening on port ${port}`);
});
