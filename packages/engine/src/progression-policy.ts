export const PROGRESSION_POLICY = {
  learningItemXp: 75,
  learningItemOnTimeBonusXp: 25,
  dailyLogXp: 10,
  weeklyRhythmXp: 75,
  levelUpCostXp: 500,
  collectionMilestones: [
    {
      weeklyRhythms: 1,
      assetRefId: "world-study-bird-v1",
      label: "Study Bird",
      description: "Earned by completing your first Weekly Rhythm.",
      icon: "🐦",
    },
    {
      weeklyRhythms: 4,
      assetRefId: "world-study-lamp-v1",
      label: "Study Lamp",
      description: "Earned after four completed Weekly Rhythms.",
      icon: "💡",
    },
    {
      weeklyRhythms: 8,
      assetRefId: "world-reading-nook-v1",
      label: "Reading Nook",
      description: "Earned after eight completed Weekly Rhythms.",
      icon: "📚",
    },
    {
      weeklyRhythms: 12,
      assetRefId: "world-star-projector-v1",
      label: "Star Projector",
      description: "Earned after twelve completed Weekly Rhythms.",
      icon: "🌟",
    },
    {
      weeklyRhythms: 16,
      assetRefId: "world-semester-banner-v1",
      label: "Semester Banner",
      description: "Earned by completing all sixteen Weekly Rhythms.",
      icon: "🏆",
    },
  ],
} as const;
