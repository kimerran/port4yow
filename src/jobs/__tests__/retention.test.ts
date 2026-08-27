import { describe, expect, it } from "vitest";

// env.ts parses at import and crashes without a valid environment, and
// jobs/index.ts reaches it through db.ts. The fixture goes in before the import.
const SECRET = "x".repeat(48);
Object.assign(process.env, {
  PUBLIC_SITE_URL: "http://localhost:4321",
  DATABASE_URL: "postgresql://a:b@localhost:5432/c",
  SESSION_SECRET: SECRET,
  FORM_SECRET: SECRET,
  IP_HASH_SALT: SECRET,
  S3_ENDPOINT: "http://localhost:9000",
  S3_BUCKET: "b",
  S3_ACCESS_KEY_ID: "k",
  S3_SECRET_ACCESS_KEY: "s",
  CONTACT_TO_EMAIL: "a@b.com",
});

const { monthsBefore, RETENTION_MONTHS, JOB_NAMES } =
  await import("../index.ts");

const iso = (date: Date): string => date.toISOString();

describe("retention window (#36, SPEC §14.10)", () => {
  it("is the 24 months the privacy note promises", () => {
    expect(RETENTION_MONTHS).toBe(24);
  });

  it("registers contact:prune on the shared runner", () => {
    // #35 built one entry point so every job shares an exit-code contract.
    // A prune that is not in JOB_NAMES is a prune `pnpm job` cannot invoke.
    expect(JOB_NAMES).toContain("contact:prune");
  });

  it("subtracts whole calendar months, not 730 days", () => {
    // 2024 is a leap year, so 24 months back from here is 731 days — a
    // day-based window would land on the wrong date.
    const now = new Date("2026-03-15T12:00:00.000Z");
    expect(iso(monthsBefore(now, RETENTION_MONTHS))).toBe(
      "2024-03-15T12:00:00.000Z",
    );
  });

  it("keeps the time of day, so a monthly run has a stable cutoff", () => {
    const now = new Date("2026-07-01T23:59:59.999Z");
    expect(iso(monthsBefore(now, 24))).toBe("2024-07-01T23:59:59.999Z");
  });

  /**
   * The one shape that goes wrong without the clamp: `setUTCMonth` rolls a
   * non-existent 2022-02-29 forward to 2022-03-01, moving the cutoff a day
   * later and deleting a day of messages earlier than promised.
   */
  it("clamps 29 February to the last day of a non-leap February", () => {
    const now = new Date("2024-02-29T09:00:00.000Z");
    expect(iso(monthsBefore(now, 24))).toBe("2022-02-28T09:00:00.000Z");
  });

  it("does not move a date that exists in the target month", () => {
    const now = new Date("2026-01-31T00:00:00.000Z");
    expect(iso(monthsBefore(now, 24))).toBe("2024-01-31T00:00:00.000Z");
  });

  it("crosses a year boundary correctly", () => {
    const now = new Date("2026-01-15T00:00:00.000Z");
    expect(iso(monthsBefore(now, 1))).toBe("2025-12-15T00:00:00.000Z");
  });

  it("puts a 23-month-old message inside the window and a 25-month-old outside", () => {
    const now = new Date("2026-06-15T00:00:00.000Z");
    const cutoff = monthsBefore(now, RETENTION_MONTHS);
    const at23 = new Date("2024-07-15T00:00:00.000Z");
    const at25 = new Date("2024-05-15T00:00:00.000Z");

    // The job deletes `createdAt < cutoff`; this is that predicate.
    expect(at23.getTime() < cutoff.getTime()).toBe(false);
    expect(at25.getTime() < cutoff.getTime()).toBe(true);
  });
});
