import { ActionError, defineAction } from "astro:actions";
// Not "astro:schema": that re-export is deprecated as of Astro 7 and removed in
// Astro 8. Importing from "astro/zod" is the supported path.
import { z } from "astro/zod";
import { AdminAuthError, assertAdmin, getDashboardStats } from "../lib/admin";

/**
 * The Astro Actions foundation (SPEC §6, #26). Every admin mutation in Sprint 6
 * is added here, one action per operation, each with a Zod input schema.
 *
 * This file is a thin adapter by design. The logic — and above all the
 * authorization rule — lives in `src/lib/admin.ts`, because `astro:actions` is a
 * virtual module that only Astro's build resolves, so nothing in this file can
 * be unit tested.
 *
 * **Every action starts with `requireAdmin(context)`.** No exceptions, and no
 * action reads identity from its own input — see `assertAdmin` for why that is
 * the only check an action gets rather than a second one.
 */

/** `assertAdmin`, with its failure mapped to the Actions error shape. */
export function requireAdmin(context: {
  locals: App.Locals;
}): NonNullable<App.Locals["user"]> {
  try {
    return assertAdmin(context.locals);
  } catch (cause) {
    if (cause instanceof AdminAuthError) {
      throw new ActionError({ code: "UNAUTHORIZED", message: cause.message });
    }
    throw cause;
  }
}

export const server = {
  /**
   * The dashboard's own counts, as an action.
   *
   * It exists so the wiring is exercised by something real before #27–#31 depend
   * on it — an untested foundation is where five issues would each discover the
   * same problem separately. It is also the reference shape: guard first, Zod
   * input second, work third.
   */
  getStats: defineAction({
    // An empty object rather than no schema: every action carries one, so adding
    // an input later is an edit rather than a new decision.
    input: z.object({}),
    handler: async (_input, context) => {
      const user = requireAdmin(context);
      return getDashboardStats(user.id);
    },
  }),
};
