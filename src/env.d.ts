/// <reference types="astro/client" />

/**
 * `App.Locals` used to carry the session-resolved admin user, hydrated by
 * middleware on every request. There are no sessions and no admin, so there is
 * nothing request-scoped left to declare — the middleware sets security headers
 * and nothing else.
 *
 * The file stays for the Astro client types reference above, which is what gives
 * `import.meta.env` and the `astro:*` modules their types.
 */
export {};
