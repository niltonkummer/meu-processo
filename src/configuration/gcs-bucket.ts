const GCS_BUCKET_NAME = /^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$/;

export const isValidGcsBucketName = (value: unknown): value is string =>
  typeof value === "string" && GCS_BUCKET_NAME.test(value);
