import { composeOutboxDispatcher } from "./composition/outbox-dispatcher-composition-root.js";
import { readOutboxDispatcherRuntimeConfig } from "./configuration/outbox-dispatcher-config.js";

const run = async (): Promise<void> => {
  const config = readOutboxDispatcherRuntimeConfig(process.env);
  const composed = composeOutboxDispatcher(config);
  try {
    const summary = await composed.dispatcher.runTick();
    process.stdout.write(
      `${JSON.stringify({ event: "outbox.dispatcher.tick", ...summary })}\n`,
    );
  } finally {
    await composed.close();
  }
};

void run().catch(() => {
  process.stderr.write("Outbox dispatcher tick failed.\n");
  process.exitCode = 1;
});
