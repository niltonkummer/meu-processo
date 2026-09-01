import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const certificatePath = resolve(
  repositoryRoot,
  "config/certificates/supabase-prod-ca-2021.crt",
);

describe("Supabase TLS trust bundle", () => {
  it("pins the published CA and includes it in the production image", () => {
    const certificate = new X509Certificate(readFileSync(certificatePath));
    const dockerfile = readFileSync(resolve(repositoryRoot, "Dockerfile"), "utf8");

    expect(certificate.fingerprint256).toBe(
      "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:" +
      "82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA",
    );
    expect(certificate.subject).toContain("CN=Supabase Root 2021 CA");
    expect(certificate.validTo).toBe("Apr 26 10:56:53 2031 GMT");
    expect(dockerfile).toContain(
      "NODE_EXTRA_CA_CERTS=/app/config/certificates/supabase-prod-ca-2021.crt",
    );
    expect(dockerfile).toContain(
      "/app/config/certificates/supabase-prod-ca-2021.crt",
    );
  });
});
