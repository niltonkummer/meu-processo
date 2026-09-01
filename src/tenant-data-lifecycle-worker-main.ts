import { composeTenantDataLifecycleWorker } from
  "./composition/tenant-data-lifecycle-worker-composition-root.js";
import { readTenantDataLifecycleWorkerRuntimeConfig } from
  "./configuration/tenant-data-lifecycle-worker-config.js";

const run = async (): Promise<void> => {
  const config = readTenantDataLifecycleWorkerRuntimeConfig(process.env);
  if (config.mode === "disabled") {
    process.stdout.write(JSON.stringify({
      event: "tenant.data.lifecycle.worker.disabled",
    }) + "\n");
    return;
  }
  const composed = await composeTenantDataLifecycleWorker(config);
  try {
    const summary = await composed.worker.runTick();
    process.stdout.write(JSON.stringify({
      event: "tenant.data.lifecycle.worker.tick", ...summary,
    }) + "\n");
  } finally {
    await composed.close();
  }
};

void run().catch(() => {
  process.stderr.write("Tenant data lifecycle worker tick failed.\n");
  process.exitCode = 1;
});
