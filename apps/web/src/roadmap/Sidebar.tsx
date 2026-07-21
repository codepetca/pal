import { Icon, type IconName } from "./icons";
import styles from "./Sidebar.module.css";

interface NavItem {
  icon: IconName;
  label: string;
  tag?: string;
}

const NAV: NavItem[] = [
  { icon: "route", label: "Roadmap" },
  { icon: "world", label: "My World" },
  { icon: "trophy", label: "Leaderboard" },
  { icon: "gift", label: "Rewards", tag: "3" },
  { icon: "chart", label: "Stats" },
  { icon: "gear", label: "Settings" },
];

interface SidebarProps {
  activeLabel?: string;
  learnerName: string;
  learnerRank: string;
}

/** Standard web-app rail: brand, nav, learner chip. Nav is data-driven. */
export function Sidebar({ activeLabel = "Roadmap", learnerName, learnerRank }: SidebarProps) {
  return (
    <nav className={styles.sidebar} aria-label="Primary">
      <div className={styles.brand}>
        <span className={styles.mark}>
          <Icon name="route" />
        </span>
        <span>
          <span className={styles.brandName}>Codepet Labs</span>
          <span className={styles.brandSub}>Pal Engine</span>
        </span>
      </div>

      <div className={styles.eyebrow}>Learn</div>
      {NAV.map((item) => (
        <button
          key={item.label}
          type="button"
          className={`${styles.item} ${item.label === activeLabel ? styles.active : ""}`}
          aria-current={item.label === activeLabel ? "page" : undefined}
        >
          <Icon name={item.icon} />
          <span>{item.label}</span>
          {item.tag && <span className={styles.tag}>{item.tag}</span>}
        </button>
      ))}

      <div className={styles.foot}>
        <span className={styles.avatar} />
        <span>
          <span className={styles.footName}>{learnerName}</span>
          <span className={styles.footSub}>{learnerRank}</span>
        </span>
      </div>
    </nav>
  );
}
