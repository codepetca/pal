type ScrollBehaviorOption = "auto" | "smooth";

export function findNearestVerticalScrollContainer(
  target: HTMLElement,
): HTMLElement | null {
  const document = target.ownerDocument;
  const view = document.defaultView;
  if (!view) return null;

  let candidate = target.parentElement;
  while (
    candidate &&
    candidate !== document.body &&
    candidate !== document.documentElement
  ) {
    const overflowY = view.getComputedStyle(candidate).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return candidate;
    candidate = candidate.parentElement;
  }

  return null;
}

export function scrollContainerToBottom(
  container: HTMLElement,
  behavior: ScrollBehaviorOption,
): void {
  container.scrollTo({
    behavior,
    top: Math.max(0, container.scrollHeight - container.clientHeight),
  });
}
