import styles from "./page.module.css";

function Pet() {
  return (
    <svg viewBox="0 0 120 125" xmlns="http://www.w3.org/2000/svg" width="90" height="94">
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
    </svg>
  );
}

export default function WorldView() {
  return (
    <div className={styles.world}>
      <svg
        className={styles.ground}
        viewBox="0 0 1440 200"
        preserveAspectRatio="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path d="M0,120 Q360,60 720,100 Q1080,140 1440,80 L1440,200 L0,200Z" fill="#4E8B3A" />
      </svg>

      <div className={styles.pet}>
        <Pet />
      </div>

      <div className={styles.hud}>
        <span className={styles.logo}>PAL</span>
        <div className={styles.hudRight}>
          <span className={styles.levelBadge}>Lv 3</span>
          <span className={styles.streak}>🔥 5</span>
          <a href="/sandbox" className={styles.sandboxLink}>sandbox →</a>
        </div>
      </div>
    </div>
  );
}
