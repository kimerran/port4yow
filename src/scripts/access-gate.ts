/**
 * The viewing gate, and the resume-download report.
 *
 * Both live here because they share one thing: the visitor identity captured at
 * the gate, which the download report reuses so the owner learns *who*
 * downloaded rather than *that someone* did.
 *
 * ## Storage
 *
 * `localStorage`, wrapped in try/catch on every access. Private windows, cleared
 * site data and browsers configured to block storage all make these throw rather
 * than return null, and an exception here would leave the gate stuck open with
 * no way past it. Failing to read means "not unlocked" — asking twice is a far
 * better failure than locking someone out.
 */

const KEY = "mhn.access.v1";

interface Visitor {
  email: string;
  name?: string;
}

function readVisitor(): Visitor | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const email = (parsed as { email?: unknown }).email;
    if (typeof email !== "string" || email.length === 0) return null;
    const name = (parsed as { name?: unknown }).name;
    return { email, ...(typeof name === "string" ? { name } : {}) };
  } catch {
    return null;
  }
}

function writeVisitor(visitor: Visitor): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(visitor));
  } catch {
    /**
     * Storage refused. The gate still opens for this page view — the visitor
     * gave their email and holding them at the door because the browser will not
     * remember it would be punishing them for a setting. They will be asked
     * again on the next page.
     */
  }
}

/** What the browser can volunteer about the visit. Best-effort, never throws. */
function collectFacts(): Record<string, string> {
  const safe = (fn: () => string): string => {
    try {
      return fn();
    } catch {
      return "";
    }
  };

  return {
    path: safe(() => window.location.pathname + window.location.search),
    referrer: safe(() => document.referrer),
    userAgent: safe(() => navigator.userAgent),
    language: safe(() => navigator.language),
    timezone: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
    screen: safe(() => `${String(screen.width)}x${String(screen.height)}`),
    viewport: safe(
      () => `${String(window.innerWidth)}x${String(window.innerHeight)}`,
    ),
  };
}

/**
 * Confines Tab to the dialog while it is open.
 *
 * `aria-modal` tells assistive tech the rest of the page is inert; it does
 * nothing for the physical Tab key. Without this, tabbing from the last field
 * walks into the page behind the overlay — focus lands on links the visitor
 * cannot see, which is worse than no gate at all.
 *
 * Escape is deliberately NOT wired to close. This is a gate; an Escape key that
 * dismisses it is a bypass with a keyboard shortcut.
 */
function trapFocus(dialog: HTMLElement): () => void {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Tab") return;
    const items = [...dialog.querySelectorAll<HTMLElement>(selector)].filter(
      (el) => el.offsetParent !== null,
    );
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  document.addEventListener("keydown", onKeydown);
  return () => {
    document.removeEventListener("keydown", onKeydown);
  };
}

async function report(
  endpoint: string,
  visitor: Visitor,
  extra: Record<string, string> = {},
): Promise<Response | null> {
  try {
    return await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...visitor, ...collectFacts(), ...extra }),
    });
  } catch {
    return null;
  }
}

export function initAccessGate(): void {
  wireResumeLinks();

  const gate = document.querySelector<HTMLElement>("[data-access-gate]");
  if (!gate) return;

  if (readVisitor()) return;

  const form = gate.querySelector<HTMLFormElement>("[data-access-form]");
  const error = gate.querySelector<HTMLElement>("[data-access-error]");
  const email = gate.querySelector<HTMLInputElement>("#gate-email");
  const name = gate.querySelector<HTMLInputElement>("#gate-name");
  const company = gate.querySelector<HTMLInputElement>("#gate-company");
  const submit = gate.querySelector<HTMLButtonElement>("[data-access-submit]");
  const dialog = gate.querySelector<HTMLElement>('[role="dialog"]');
  if (!form || !email || !dialog) return;

  gate.hidden = false;
  // Stops the page behind from scrolling under the overlay on touch.
  document.body.style.overflow = "hidden";
  const release = trapFocus(dialog);
  email.focus();

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const value = email.value.trim();
    // The browser's own check, used rather than reimplemented — `novalidate` on
    // the form suppresses the native bubble, not the validity state.
    if (!value || !email.checkValidity()) {
      if (error) error.textContent = "That email address looks incomplete.";
      email.focus();
      return;
    }
    if (error) error.textContent = "";

    const visitor: Visitor = {
      email: value,
      ...(name?.value.trim() ? { name: name.value.trim() } : {}),
    };

    if (submit) {
      submit.disabled = true;
      submit.textContent = "Opening…";
    }

    /**
     * The gate opens without waiting for the request.
     *
     * The visitor has done their part; making them watch a spinner while an
     * email is dispatched to someone else would be charging them for our
     * bookkeeping. If the report fails, the route logs it — see `/api/access`
     * for why it answers 200 either way.
     */
    void report("/api/access", visitor, {
      company: company?.value ?? "",
    });

    writeVisitor(visitor);
    release();
    gate.hidden = true;
    document.body.style.overflow = "";
  });
}

/**
 * Reports a resume download, then lets the browser follow the link normally.
 *
 * The anchor points at the static PDF, so the download works with JavaScript
 * off — it just is not reported. See `/api/resume` for why the alert is not
 * simply hung off a GET.
 */
function wireResumeLinks(): void {
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    "[data-resume-link]",
  )) {
    link.addEventListener("click", () => {
      const visitor = readVisitor() ?? { email: "unknown@visitor" };
      void report("/api/resume", visitor);
      // No preventDefault: the download proceeds while the report is in flight.
    });
  }
}
