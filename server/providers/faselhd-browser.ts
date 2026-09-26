let browserBinding: unknown = null;

export function setFaselHdBrowserBinding(binding: unknown) {
  browserBinding = binding || null;
}

export function getFaselHdBrowserBinding() {
  return browserBinding;
}
