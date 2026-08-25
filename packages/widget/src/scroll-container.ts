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

export function centerElementWithinScrollContainer(
  target: HTMLElement,
  container: HTMLElement,
  behavior: ScrollBehaviorOption,
): void {
  const targetRect = target.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const targetCenter =
    targetRect.top -
    containerRect.top -
    container.clientTop +
    container.scrollTop +
    targetRect.height / 2;
  const top = Math.max(
    0,
    Math.min(
      container.scrollHeight - container.clientHeight,
      targetCenter - container.clientHeight / 2,
    ),
  );

  container.scrollTo({ behavior, top });
}
