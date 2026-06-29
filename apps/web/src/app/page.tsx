import styles from "./page.module.css";

function Tree({ flipped = false }: { flipped?: boolean }) {
  return (
    <svg viewBox="0 0 80 120" xmlns="http://www.w3.org/2000/svg" style={flipped ? { transform: "scaleX(-1)" } : {}}>
      <rect x="33" y="82" width="14" height="38" fill="#6B4226" />
      <polygon points="40,12 14,56 66,56" fill="#4A8A32" />
      <polygon points="40,32 11,72 69,72" fill="#3D7525" />
      <polygon points="40,50 9,90 71,90" fill="#336220" />
    </svg>
  );
}

function PetCharacter() {
  return (
    <svg viewBox="0 0 120 125" xmlns="http://www.w3.org/2000/svg">
      <path d="M 88 100 Q 108 76 100 58" stroke="#E76F51" strokeWidth="10" fill="none" strokeLinecap="round" />
      <ellipse cx="60" cy="96" rx="36" ry="30" fill="#F4A261" />
      <ellipse cx="60" cy="96" rx="22" ry="18" fill="#FBBF8A" />
      <circle cx="60" cy="56" r="34" fill="#F4A261" />
      <polygon points="38,30 31,4 56,22" fill="#E76F51" />
      <polygon points="82,30 89,4 64,22" fill="#E76F51" />
      <polygon points="40,28 35,11 54,23" fill="#FFBBA0" />
      <polygon points="80,28 85,11 66,23" fill="#FFBBA0" />
      <circle cx="47" cy="51" r="6" fill="#2D1B0E" />
      <circle cx="73" cy="51" r="6" fill="#2D1B0E" />
      <circle cx="50" cy="48" r="2.5" fill="white" />
      <circle cx="76" cy="48" r="2.5" fill="white" />
      <ellipse cx="60" cy="62" rx="3.5" ry="3" fill="#E76F51" />
      <path d="M 52 67 Q 60 74 68 67" stroke="#2D1B0E" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <circle cx="39" cy="59" r="8" fill="#F08060" opacity="0.32" />
      <circle cx="81" cy="59" r="8" fill="#F08060" opacity="0.32" />
    </svg>
  );
}

function Flowers() {
  return (
    <svg viewBox="0 0 90 44" xmlns="http://www.w3.org/2000/svg">
      <line x1="12" y1="28" x2="12" y2="44" stroke="#4A8A32" strokeWidth="2" />
      <line x1="32" y1="22" x2="32" y2="44" stroke="#4A8A32" strokeWidth="2" />
      <line x1="55" y1="26" x2="55" y2="44" stroke="#4A8A32" strokeWidth="2" />
      <line x1="75" y1="30" x2="75" y2="44" stroke="#4A8A32" strokeWidth="2" />
      <circle cx="12" cy="22" r="7" fill="#FF8FAB" />
      <circle cx="12" cy="22" r="3" fill="#FFD166" />
      <circle cx="32" cy="15" r="8" fill="#C77DFF" />
      <circle cx="32" cy="15" r="3.5" fill="#FFD166" />
      <circle cx="55" cy="20" r="6" fill="#FF8FAB" />
      <circle cx="55" cy="20" r="2.5" fill="#FFD166" />
      <circle cx="75" cy="24" r="7" fill="#FF6B9D" />
      <circle cx="75" cy="24" r="3" fill="#FFD166" />
    </svg>
  );
}

function BirdSilhouette() {
  return (
    <svg viewBox="0 0 60 36" xmlns="http://www.w3.org/2000/svg" width="50" height="30">
      <path d="M 5,22 Q 15,8 30,18 Q 45,8 55,22 Q 42,16 30,22 Q 18,16 5,22 Z" fill="#7A8A78" />
      <circle cx="44" cy="18" r="3" fill="#7A8A78" />
      <path d="M 47,18 L 52,16" stroke="#7A8A78" strokeWidth="1.5" />
      <line x1="30" y1="22" x2="30" y2="36" stroke="#7A8A78" strokeWidth="2" />
      <line x1="24" y1="36" x2="36" y2="36" stroke="#7A8A78" strokeWidth="2" />
    </svg>
  );
}

export default function WorldView() {
  return (
    <div className={styles.world}>
      <svg
        className={styles.landscape}
        viewBox="0 0 1440 380"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path d="M0,240 Q240,120 480,190 Q720,260 960,150 Q1140,80 1440,170 L1440,380 L0,380Z" fill="#8CC46B" />
        <path d="M0,300 Q200,180 420,250 Q640,310 860,220 Q1060,155 1290,240 Q1380,270 1440,245 L1440,380 L0,380Z" fill="#4E8B3A" />
        <rect x="0" y="355" width="1440" height="25" fill="#2D5A1B" />
      </svg>

      <div className={styles.treeLeft}><Tree /></div>
      <div className={styles.treeRight}><Tree flipped /></div>
      <div className={styles.flowers}><Flowers /></div>

      <div className={styles.lockedSun}>
        <div className={styles.lockedSunDisc} />
        <span className={styles.lockHint}>unlocks at 2 months</span>
      </div>
      <div className={styles.lockedBird}>
        <span className={styles.lockHint}>7-day streak</span>
        <BirdSilhouette />
      </div>

      <div className={styles.pet}>
        <div className={styles.moodBubble}>happy ✨</div>
        <div className={styles.petSvg}><PetCharacter /></div>
      </div>

      <div className={styles.hudTop}>
        <span className={styles.logo}>PAL</span>
        <div className={styles.hudTopRight}>
          <span className={styles.levelBadge}>Lv 3</span>
          <a href="/sandbox" className={styles.sandboxLink}>Dev sandbox →</a>
        </div>
      </div>

      <div className={styles.hudBottom}>
        <div className={styles.xpSection}>
          <span className={styles.xpLevelLabel}>XP</span>
          <div className={styles.xpTrack}>
            <div className={styles.xpFill} />
          </div>
          <span className={styles.xpNumbers}>750 / 1000</span>
        </div>
        <div className={styles.streakBadge}>🔥 5 days</div>
      </div>
    </div>
  );
}
