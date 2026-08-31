import { composeApiServer } from "./composition/api-composition-root.js";
import { readRuntimeConfig } from "./configuration/runtime-config.js";

const config = readRuntimeConfig(process.env);
const server = composeApiServer(config);

server.listen(config.port, "0.0.0.0", () => {
  console.log(`Meu Processo listening on port ${config.port}`);
});
