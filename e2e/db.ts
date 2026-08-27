/**
 * Direct database access for assertions the browser cannot make (#39).
 *
 * Used sparingly and only for *verification* — never to set up a scenario a
 * user could set up through the interface. The contact endpoint answers 200 for
 * a genuine submission and for one it classifies as spam, deliberately and
 * identically (SPEC §7), so a status code cannot tell them apart. Only the row
 * can.
 */
export async function contactMessageByEmail(
  email: string,
): Promise<{ status: string; name: string } | null> {
  const { db } = await import("../src/lib/db.ts");
  return db.contactMessage.findFirst({
    where: { email },
    select: { status: true, name: true },
    orderBy: { createdAt: "desc" },
  });
}
