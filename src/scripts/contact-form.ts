/**
 * Progressive enhancement for the contact form (#21).
 *
 * The form works without this file: it is a native POST to `/api/contact`. This
 * upgrades it in place so a validation failure keeps every entered value instead
 * of costing the visitor their message.
 *
 * Kept in its own module so the logic is testable, and imported from an
 * Astro-processed `<script>` so CSP hashes it (#11).
 */

/** BRAND §8 — the verb carries through the flow. */
const LABELS = {
  idle: "Send message",
  busy: "Sending…",
  done: "Message sent",
} as const;

interface ErrorPayload {
  errors?: Record<string, string>;
  message?: string;
}

/**
 * The one generic failure string, in the interface's voice (BRAND §8): it says
 * what happened and what to do. Not "Oops! Something went wrong."
 */
const GENERIC_ERROR =
  "That didn't send. Check your connection and try again, or email directly.";

const setFieldError = (
  form: HTMLFormElement,
  name: string,
  text: string,
): void => {
  const slot = form.querySelector<HTMLElement>(`[data-error-for="${name}"]`);
  const input = form.elements.namedItem(name);
  if (slot) slot.textContent = text;
  if (
    input instanceof HTMLInputElement ||
    input instanceof HTMLTextAreaElement
  ) {
    // The error border is applied here rather than in the template because a
    // field is only in an error state after a failed submission.
    input.classList.toggle("border-error", text.length > 0);
    if (text.length > 0) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }
};

const clearErrors = (form: HTMLFormElement): void => {
  for (const slot of form.querySelectorAll<HTMLElement>("[data-error-for]")) {
    setFieldError(form, slot.dataset.errorFor ?? "", "");
  }
};

/**
 * Cloudflare injects this when the widget script loads. Declared rather than
 * cast at the call site so `?.` is the only guard needed — with Turnstile
 * unconfigured the script is never rendered and the global is simply absent.
 */
declare global {
  interface Window {
    turnstile?: { reset: (container?: string | HTMLElement) => void };
  }
}

export function initContactForm(root: ParentNode = document): void {
  const form = root.querySelector<HTMLFormElement>("#contact-form");
  if (!form) return;

  const status = form.querySelector<HTMLElement>("[data-form-status]");
  const button = form.querySelector<HTMLButtonElement>("button[type='submit']");

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearErrors(form);
    if (status) status.textContent = "";
    if (button) {
      button.disabled = true;
      button.textContent = LABELS.busy;
    }

    // FormData rather than JSON. The wire format is NOT identical to the no-JS
    // path — a native form POSTs `application/x-www-form-urlencoded` and fetch
    // with a FormData body POSTs `multipart/form-data` (both measured). What
    // matters is that a single `await request.formData()` in #22 parses both,
    // so the handler has one code path and the two cannot drift. Sending JSON
    // here would have given it two.
    const body = new FormData(form);

    void fetch(form.action, {
      method: "POST",
      body,
      headers: { Accept: "application/json" },
      // Same-origin only: the endpoint checks Origin and this never needs to
      // travel cross-site.
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (response.ok) {
          form.reset();
          if (button) button.textContent = LABELS.done;
          if (status) status.textContent = "Message sent. I'll reply soon.";
          return;
        }

        // Values are NOT reset here — that is the whole point of the upgrade.
        const payload = (await response
          .json()
          .catch(() => ({}))) as ErrorPayload;

        if (payload.errors) {
          /**
           * `turnstile` is not a field anyone filled in, so it has no
           * `[data-error-for]` target and no "field needs attention" to point
           * at. It goes straight to the live region instead, and the widget is
           * reset — a Turnstile token is single-use, so resubmitting with the
           * spent one would fail identically forever.
           */
          const { turnstile: turnstileError, ...fieldErrors } = payload.errors;

          if (turnstileError !== undefined) {
            window.turnstile?.reset();
            if (status) status.textContent = turnstileError;
          }

          for (const [name, text] of Object.entries(fieldErrors)) {
            setFieldError(form, name, text);
          }

          const count = Object.keys(fieldErrors).length;
          if (status && count > 0) {
            status.textContent =
              count === 1
                ? "One field needs attention."
                : `${String(count)} fields need attention.`;
          }
        } else if (status) {
          status.textContent = payload.message ?? GENERIC_ERROR;
        }

        if (button) {
          button.disabled = false;
          button.textContent = LABELS.idle;
        }
      })
      .catch(() => {
        if (status) status.textContent = GENERIC_ERROR;
        if (button) {
          button.disabled = false;
          button.textContent = LABELS.idle;
        }
      });
  });
}
