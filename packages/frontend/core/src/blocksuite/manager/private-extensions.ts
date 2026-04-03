type ExtensionCtor = unknown;

const privateViewExtensions: ExtensionCtor[] = [];
const privateStoreExtensions: ExtensionCtor[] = [];

export function registerPrivateViewExtensions(...extensions: ExtensionCtor[]) {
  privateViewExtensions.push(...extensions);
}

export function registerPrivateStoreExtensions(...extensions: ExtensionCtor[]) {
  privateStoreExtensions.push(...extensions);
}

export function getPrivateViewExtensions() {
  return [...privateViewExtensions];
}

export function getPrivateStoreExtensions() {
  return [...privateStoreExtensions];
}

export function clearPrivateExtensions() {
  privateViewExtensions.length = 0;
  privateStoreExtensions.length = 0;
}
