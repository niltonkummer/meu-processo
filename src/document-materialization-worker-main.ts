import { composeDocumentMaterializationWorker } from
  "./composition/document-materialization-worker-composition-root.js";
import { readDocumentMaterializationRuntimeConfig } from
  "./configuration/document-materialization-worker-config.js";

const run = async (): Promise<void> => {
  const config = readDocumentMaterializationRuntimeConfig(process.env);
  if (config.mode === "disabled") {
    process.stdout.write(JSON.stringify({
      event: "document.materialization.worker.disabled",
    }) + "\n");
    return;
  }
  const composed = await composeDocumentMaterializationWorker(config);
  try {
    const summary = await composed.worker.runTick();
    process.stdout.write(JSON.stringify({
      event: "document.materialization.worker.tick", ...summary,
    }) + "\n");
  } finally {
    await composed.close();
  }
};

void run().catch(() => {
  process.stderr.write("Document materialization worker tick failed.\n");
  process.exitCode = 1;
});

