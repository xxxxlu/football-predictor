export type ServiceWorkerUpdateHandler = (worker: ServiceWorker) => void;

/** A controllerchange may mean two very different things: sw.js calls clients.claim()
 *  on activate, so the FIRST install claims pages that had no controller — the page is
 *  already the newest version and reloading would destroy in-progress user input (the
 *  auth form lost its earliest-typed field this way). Only a takeover of a page that
 *  already had a controller is a real version update worth reloading for. */
export function shouldReloadOnControllerChange(hadController: boolean, alreadyReloading: boolean): boolean {
  return hadController && !alreadyReloading;
}

export async function registerServiceWorker(onUpdate: ServiceWorkerUpdateHandler): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return null;
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  if (registration.waiting) onUpdate(registration.waiting);
  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed" && navigator.serviceWorker.controller) onUpdate(installing);
    });
  });
  return registration;
}

export async function unregisterServiceWorker(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("pulse-shell-") || key.startsWith("matchday-ledger-shell-")).map((key) => caches.delete(key)));
  }
}
