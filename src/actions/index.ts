import { ActionError, defineAction } from "astro:actions";
// Not "astro:schema": that re-export is deprecated as of Astro 7 and removed in
// Astro 8. Importing from "astro/zod" is the supported path.
import { z } from "astro/zod";
import { AdminAuthError, assertAdmin, getDashboardStats } from "../lib/admin";
import {
  MESSAGE_STATUSES,
  MessageNotFound,
  setMessageStatus,
} from "../lib/messages";
import { isSameOrigin } from "../lib/origin";
import {
  DuplicateStackName,
  ReorderMismatch,
  StackItemInUse,
  StackItemNotFound,
  createStackItem,
  deleteStackItem,
  reorderStackItems,
  updateStackItem,
} from "../lib/stack";
import { SUIT_ENUM_VALUES } from "../lib/suits";
import { consume } from "../lib/ratelimit";
import { db } from "../lib/db";
import {
  AssetInUse,
  MAX_UPLOAD_BYTES,
  UploadRejected,
  deleteAssetGroup,
  processUpload,
  updateAltText as updateAssetAltText,
} from "../lib/upload";
import {
  PublishBlockedError,
  ReorderMismatchError,
  SlugImmutableError,
  nextSequence,
  normalizeSlug,
  publishProject,
  reorderProjects,
  resolveSlug,
  unpublishProject,
} from "../lib/projects";

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
 * The two checks every action needs, in one call that cannot be half-applied.
 *
 * #27 requires each mutation to re-check the session AND verify origin. Two
 * separate helpers means an action can call one and miss the other, and the miss
 * is invisible — everything still works until someone posts cross-site. Folding
 * them together makes forgetting impossible rather than merely unlikely.
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
 * Maps a domain error to the Actions error shape.
 *
 * `BAD_REQUEST` rather than a 500: these are all "you asked for something the
 * rules do not allow", which the form can render. A 500 would tell the admin
 * the server broke when in fact it refused.
 */
function toActionError(cause: unknown): never {
  if (
    cause instanceof PublishBlockedError ||
    cause instanceof SlugImmutableError ||
    cause instanceof ReorderMismatchError ||
    cause instanceof DuplicateStackName ||
    cause instanceof StackItemInUse ||
    cause instanceof StackItemNotFound ||
    cause instanceof ReorderMismatch ||
    cause instanceof UploadRejected ||
    cause instanceof AssetInUse ||
    cause instanceof MessageNotFound
  ) {
    throw new ActionError({ code: "BAD_REQUEST", message: cause.message });
  }
  throw cause;
}

/**
 * An empty form field means "not set", not an invalid URL.
 *
 * `z.url()` rather than the deprecated `z.string().url()` — zod 4 moved it to a
 * top-level constructor and warns on the old form.
 */
const optionalUrl = z
  .union([z.literal(""), z.url().max(512)])
  .transform((value) => (value === "" ? null : value));

/**
 * The writable project fields. `slug` is handled separately — see `resolveSlug`.
 *
 * Every optional field is `.nullable()` with a default rather than `.optional()`:
 * this project runs `exactOptionalPropertyTypes`, and an `undefined` spread into
 * a Prisma `create`/`update` is a type error there. Always-present values also
 * remove the "did the caller mean clear, or leave alone?" ambiguity, which for
 * an edit form is always "clear".
 */
const ProjectFields = z.object({
  title: z.string().trim().min(1).max(120),
  suit: z.enum(["DIAMONDS", "SPADES", "HEARTS", "CLUBS"]),
  summary: z.string().trim().max(180),
  role: z.string().trim().max(120),
  timeline: z.string().trim().max(120),
  problem: z.string().max(5000),
  body: z.string().max(50000),
  outcome: z.string().max(5000),
  liveUrl: optionalUrl.default(""),
  repoUrl: optionalUrl.default(""),
  coverImageId: z
    .union([z.literal(""), z.string().min(1)])
    .transform((value) => (value === "" ? null : value))
    .default(""),
  stackItemIds: z.array(z.string().min(1)).max(40).default([]),
});

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
   * Creates a DRAFT. Never PUBLISHED — publication goes through `publish`, which
   * is the only place the SPEC §6 gate runs.
   */
  createProject: defineAction({
    accept: "form",
    input: ProjectFields.extend({ slug: z.string().trim().min(1).max(96) }),
    handler: async (input, context) => {
      requireAdmin(context);
      try {
        const slug = normalizeSlug(input.slug);
        if (slug.length === 0) {
          throw new ActionError({
            code: "BAD_REQUEST",
            message: "Slug must contain at least one letter or number.",
          });
        }

        const { stackItemIds, slug: _ignored, ...fields } = input;
        const project = await db.project.create({
          data: {
            ...fields,
            slug,
            sequence: await nextSequence(),
            status: "DRAFT",
            stack: {
              create: stackItemIds.map((stackItemId, sortOrder) => ({
                stackItemId,
                sortOrder,
              })),
            },
          },
          // Narrow select — never the whole row into a template (AGENT §2).
          select: { id: true, slug: true },
        });
        return project;
      } catch (cause) {
        return toActionError(cause);
      }
    },
  }),

  updateProject: defineAction({
    accept: "form",
    input: ProjectFields.extend({
      id: z.string().min(1),
      slug: z.string().trim().min(1).max(96).optional(),
    }),
    handler: async (input, context) => {
      requireAdmin(context);
      try {
        const current = await db.project.findUnique({
          where: { id: input.id },
          select: { slug: true, status: true },
        });
        if (!current) {
          throw new ActionError({
            code: "NOT_FOUND",
            message: "That project no longer exists.",
          });
        }

        // Throws SlugImmutableError for a published project (SPEC §4).
        const slug = resolveSlug(
          current,
          input.slug === undefined ? undefined : normalizeSlug(input.slug),
        );

        const { id, stackItemIds, slug: _ignored, ...fields } = input;
        await db.project.update({
          where: { id },
          data: {
            ...fields,
            slug,
            // Replace rather than merge: the form submits the full set, so a
            // removed item must actually disappear.
            stack: {
              deleteMany: {},
              create: stackItemIds.map((stackItemId, sortOrder) => ({
                stackItemId,
                sortOrder,
              })),
            },
          },
          select: { id: true },
        });
        return { id, slug };
      } catch (cause) {
        return toActionError(cause);
      }
    },
  }),

  /** SPEC §6's gate lives in `publishProject`, re-read from the database. */
  publishProject: defineAction({
    accept: "form",
    input: z.object({ id: z.string().min(1) }),
    handler: async (input, context) => {
      requireAdmin(context);
      try {
        await publishProject(input.id);
        return { ok: true };
      } catch (cause) {
        return toActionError(cause);
      }
    },
  }),

  unpublishProject: defineAction({
    accept: "form",
    input: z.object({ id: z.string().min(1) }),
    handler: async (input, context) => {
      requireAdmin(context);
      await unpublishProject(input.id);
      return { ok: true };
    },
  }),

  /** One transaction, and the list must name every project — see reorderProjects. */
  reorderProjects: defineAction({
    accept: "form",
    input: z.object({ orderedIds: z.array(z.string().min(1)).min(1).max(200) }),
    handler: async (input, context) => {
      requireAdmin(context);
      try {
        await reorderProjects(input.orderedIds);
        return { ok: true };
      } catch (cause) {
        return toActionError(cause);
      }
    },
  }),

  /**
   * Stack items (#29). Suit values come from `SUIT_ENUM_VALUES`, derived from
   * the same `SUITS` list the public site renders — a second hand-written list
   * of the four suits would drift, and the one that drifts is the one nobody
   * looks at.
   */
  createStackItem: defineAction({
    accept: "form",
    input: z.object({
      name: z.string().trim().min(1).max(60),
      suit: z.enum(SUIT_ENUM_VALUES),
      featured: z.boolean().default(false),
    }),
    handler: async (input, context) => {
      requireAdmin(context);
      try {
        return await createStackItem(input);
      } catch (cause) {
        return toActionError(cause);
      }
    },
  }),

  updateStackItem: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().min(1),
      name: z.string().trim().min(1).max(60),
      suit: z.enum(SUIT_ENUM_VALUES),
      featured: z.boolean().default(false),
    }),
    handler: async (input, context) => {
      requireAdmin(context);
      try {
        await updateStackItem(input);
        return { ok: true };
      } catch (cause) {
        return toActionError(cause);
      }
    },
  }),

  /**
   * `confirmed` is the second step of a two-step delete. The first submit
   * refuses and names the projects that list the item; the second proceeds.
   * A JavaScript `confirm()` would not do — these pages ship no client script,
   * and a confirmation that only exists in JavaScript is not a confirmation.
   */
  deleteStackItem: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().min(1),
      confirmed: z.boolean().default(false),
    }),
    handler: async (input, context) => {
      requireAdmin(context);
      try {
        return await deleteStackItem(input.id, input.confirmed);
      } catch (cause) {
        return toActionError(cause);
      }
    },
  }),

  reorderStackItems: defineAction({
    accept: "form",
    input: z.object({
      suit: z.enum(SUIT_ENUM_VALUES),
      orderedIds: z.array(z.string().min(1)).min(1).max(200),
    }),
    handler: async (input, context) => {
      requireAdmin(context);
      try {
        await reorderStackItems(input.suit, input.orderedIds);
        return { ok: true };
      } catch (cause) {
        return toActionError(cause);
      }
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

  /**
   * Triage a contact message (#30). The only mutation the inbox performs —
   * messages are never edited or deleted from here, because a stored
   * submission is a record of something a person sent.
   */
  setMessageStatus: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().min(1),
      status: z.enum(MESSAGE_STATUSES),
    }),
    handler: async (input, context) => {
      requireAdmin(context);
      try {
        await setMessageStatus(input.id, input.status);
        return { ok: true };
      } catch (cause) {
        return toActionError(cause);
      }
    },
  }),
};
