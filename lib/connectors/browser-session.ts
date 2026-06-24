const unavailableReason = "browser_collection_unavailable";

export async function getPersistentBrowserContext(): Promise<never> {
  throw new Error(unavailableReason);
}

export async function closePersistentBrowserContexts() {
  return;
}

export async function closePersistentBrowserContext(_engineType: string) {
  return;
}
