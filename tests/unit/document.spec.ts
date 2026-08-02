import { describe, expect, it } from "vitest";
import { ALLOWED_DOCUMENT_MIME_TYPES, MAX_DOCUMENT_SIZE_BYTES, validateDocumentUpload } from "../../src/domain/document";

describe("validateDocumentUpload", () => {
  it("accepts a normal-sized, allowed file", () => {
    expect(validateDocumentUpload(1024, "application/pdf")).toBeNull();
  });

  it("accepts exactly the maximum size", () => {
    expect(validateDocumentUpload(MAX_DOCUMENT_SIZE_BYTES, "application/pdf")).toBeNull();
  });

  it("rejects a file one byte over the maximum size", () => {
    expect(validateDocumentUpload(MAX_DOCUMENT_SIZE_BYTES + 1, "application/pdf")).toBe("too_large");
  });

  it("rejects a disallowed MIME type", () => {
    expect(validateDocumentUpload(1024, "application/x-msdownload")).toBe("type_not_allowed");
  });

  it("checks size before type - a too-large file of a disallowed type still reports too_large first", () => {
    expect(validateDocumentUpload(MAX_DOCUMENT_SIZE_BYTES + 1, "application/x-msdownload")).toBe("too_large");
  });

  it("accepts every type in the documented allow-list", () => {
    for (const mimeType of ALLOWED_DOCUMENT_MIME_TYPES) {
      expect(validateDocumentUpload(1024, mimeType)).toBeNull();
    }
  });
});
