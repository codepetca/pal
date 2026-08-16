import type { PalCollectionItem } from "@codepet/pal-widget";
import { PROGRESSION_POLICY } from "@pal/engine";

const COLLECTION_ITEMS = new Map<string, PalCollectionItem>(
  PROGRESSION_POLICY.collectionMilestones.map((milestone) => [
    milestone.assetRefId,
    {
      id: milestone.assetRefId,
      label: milestone.label,
      description: milestone.description,
      icon: milestone.icon,
    },
  ]),
);

export function collectionItemsForUnlocks(unlockedObjectIds: readonly string[]) {
  return unlockedObjectIds.flatMap((id) => {
    const item = COLLECTION_ITEMS.get(id);
    return item ? [{ ...item }] : [];
  });
}
