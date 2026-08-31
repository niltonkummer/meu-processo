import { describe, expect, it, vi } from "vitest";

import {
  CaseDocumentProjectionError,
  PostgresCaseDocumentRepository,
} from "./postgres-case-document-repository.js";

const TENANT = "10000000-0000-7000-8000-000000000001";
const USER = "00000000-0000-7000-8000-000000000001";
const CASE = "83000000-0000-7000-8000-000000000001";

describe("PostgresCaseDocumentRepository projection boundary", () => {
  it("rolls back and rejects malformed rows before they reach the application", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ visible: true }] })
      .mockResolvedValueOnce({ rows: [{
        tenant_id: TENANT,
        document_id: "88000000-0000-7000-8000-000000000001",
        case_id: CASE,
        case_event_id: null,
        title: "",
        document_type: null,
        access_class: "public_official",
        availability_status: "metadata_only",
        expected_media_type: "application/pdf",
        source_created_at: new Date("2026-08-31T10:00:00Z"),
        last_verified_at: new Date("2026-08-31T11:00:00Z"),
        source_code: "djen",
        source_official: true,
        artifact_id: null,
        artifact_media_type: null,
        artifact_size_bytes: null,
        artifact_content_hash: null,
        artifact_expires_at: null,
      }] })
      .mockResolvedValueOnce({ rows: [] });
    const release = vi.fn();
    const repository = new PostgresCaseDocumentRepository({
      connect: vi.fn().mockResolvedValue({ query, release }),
    });

    await expect(repository.list(
      { userId: USER, tenantId: TENANT }, CASE, { limit: 20 },
    )).rejects.toBeInstanceOf(CaseDocumentProjectionError);
    expect(query).toHaveBeenLastCalledWith("rollback");
    expect(release).toHaveBeenCalledOnce();
  });
});
