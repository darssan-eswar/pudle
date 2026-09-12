export interface LocalSessionResources {
  stopMedia: () => void | Promise<void>;
  revokeUrls: () => void;
  closeStorage: () => void;
  clearUi: () => void;
}

export async function disposeLocalSession(
  resources: LocalSessionResources,
): Promise<void> {
  await resources.stopMedia();
  resources.revokeUrls();
  resources.closeStorage();
  resources.clearUi();
}
