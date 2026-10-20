/**
 * Content Security Policy for Hub pages. Scripts, connections, external resources and framing stay restricted to
 * this origin; inline styles are allowed because Radix and other UI components insert <style> for scroll locking.
 * `default-src 'none'` still blocks external images and fonts, so injected CSS cannot send data elsewhere.
 */
export const HUB_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";
