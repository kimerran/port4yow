import { ActionError, defineAction } from "astro:actions";
// Not "astro:schema": that re-export is deprecated as of Astro 7 and removed in
// Astro 8. Importing from "astro/zod" is the supported path.
import { z } from "astro/zod";
import { AdminAuthError, assertAdmin, getDashboardStats } from "../lib/admin";
import { isSameOrigin } from "../lib/origin";
import { consume } from "../lib/ratelimit";
import {
  AssetInUse,
  MAX_UPLOAD_BYTES,
  UploadRejected,
  deleteAssetGroup,
  processUpload,
  updateAltText as updateAssetAltText,
} from "../lib/upload";

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

/**
 * The two checks every mutating action needs, in one call that cannot be
 * half-applied.
 *
 * #28 requires each mutation to re-check the session AND verify origin. Two
 * separate helpers means an action can call one and miss the other, and the miss
 * is invisible — everything works until someone posts cross-site. Folding them
 * together makes forgetting impossible rather than merely unlikely.
 *
 * Origin first: a cross-site request should be refused before it can learn
 * whether a session exists.
 */
export function requireAdmin(context: {
  request: Request;
  locals: App.Locals;
}): NonNullable<App.Locals["user"]> {
  if (!isSameOrigin(context.request)) {
    throw new ActionError({ code: "FORBIDDEN", message: "Forbidden." });
  }
  try {
    return assertAdmin(context.locals);
  } catch (cause) {
    if (cause instanceof AdminAuthError) {
      throw new ActionError({ code: "UNAUTHORIZED", message: cause.message });
    }
    throw cause;
  }
}

/**
 * Maps a domain refusal to the Actions error shape.
 *
 * `BAD_REQUEST`, not a 500: every one of these is "you asked for something the
 * rules do not allow", which the form can render. A 500 would tell the admin the
 * server broke when in fact it refused, and they would retry the same upload.
 */
function toActionError(cause: unknown): never {
  if (cause instanceof UploadRejected || cause instanceof AssetInUse) {
    throw new ActionError({ code: "BAD_REQUEST", message: cause.message });
  }
  throw cause;
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

  /**
   * Uploads one image (#28).
   *
   * `accept: "form"` so the file arrives as a real multipart upload from a form
   * that needs no JavaScript. Every validation lives in `processUpload`, which
   * reads the file's own bytes — nothing here trusts the filename or the
   * client-supplied `Content-Type`.
   */
  uploadMedia: defineAction({
    accept: "form",
    input: z.object({
      projectId: z.string().min(1),
      altText: z.string().min(1).max(500),
      file: z
        .instanceof(File)
        // The size check is repeated in processUpload against the bytes we
        // actually read. This one refuses earlier, on the declared length, so an
        // oversized body is not buffered any further than it already was.
        .refine((file) => file.size <= MAX_UPLOAD_BYTES, {
          message: "That file is larger than 8 MB.",
        }),
    }),
    handler: async (input, context) => {
      const user = requireAdmin(context);

      /**
       * SPEC §14.9 — 30 uploads/hour/session. Keyed on the user id rather than
       * an IP: the limit is per SESSION in the spec, and an admin behind a
       * changing IP should not get a fresh budget by reconnecting.
       */
      const limit = await consume("upload", user.id);
      if (!limit.allowed) {
        throw new ActionError({
          code: "TOO_MANY_REQUESTS",
          message: `That is a lot of uploads. Try again in ${String(Math.ceil(limit.retryAfterSeconds / 60))} minutes.`,
        });
      }

      try {
        const bytes = new Uint8Array(await input.file.arrayBuffer());
        return await processUpload({
          bytes,
          projectId: input.projectId,
          altText: input.altText,
        });
      } catch (cause) {
        return toActionError(cause);
      }
    },
  }),

  updateAltText: defineAction({
    accept: "form",
    input: z.object({
      keyStem: z.string().min(1).max(256),
      altText: z.string().min(1).max(500),
    }),
    handler: async (input, context) => {
      requireAdmin(context);
      try {
        const updated = await updateAssetAltText(input.keyStem, input.altText);
        return { updated };
      } catch (cause) {
        return toActionError(cause);
      }
    },
  }),

  deleteMedia: defineAction({
    accept: "form",
    input: z.object({ keyStem: z.string().min(1).max(256) }),
    handler: async (input, context) => {
      requireAdmin(context);
      try {
        const deleted = await deleteAssetGroup(input.keyStem);
        return { deleted };
      } catch (cause) {
        return toActionError(cause);
      }
    },
  }),
};
