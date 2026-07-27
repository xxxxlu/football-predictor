/**
 * Navigation loading is intentionally silent. Session confirmation stays in the
 * persistent header, so a second full-screen loader would duplicate feedback.
 */
export default function Loading() {
  return null;
}
