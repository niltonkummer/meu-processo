import { composeMonitoringWorker } from "./composition/monitoring-worker-composition-root.js";
import { readMonitoringWorkerRuntimeConfig } from "./configuration/monitoring-worker-config.js";

const run = async (): Promise<void> => {
  const config = readMonitoringWorkerRuntimeConfig(process.env);
  const composed = composeMonitoringWorker(config);
  try {
    const summary = await composed.worker.runTick();
    process.stdout.write(
      `${JSON.stringify({ event: "monitoring.worker.tick", ...summary })}\n`,
    );
  } finally {
    await composed.close();
  }
};

void run().catch(() => {
  process.stderr.write("Monitoring worker tick failed.\n");
  process.exitCode = 1;
});
