import type { CSSProperties } from "react";
import { Icon } from "./icons";
import { NODE_STYLE } from "./node-styles";
import type { RoadmapNode, Track } from "./types";
import styles from "./StatsRail.module.css";

const DAYS = ["M", "T", "W", "T", "F", "S", "S"];
const fmt = (n: number) => n.toLocaleString("en-US");

function currentNode(track: Track): { node: RoadmapNode; unitKind: string } | null {
  for (const unit of track.units) {
    for (const node of unit.nodes) {
      if (node.status === "current") return { node, unitKind: unit.kind };
    }
  }
  return null;
}

interface StatsRailProps {
  track: Track;
  onSelectNode: (node: RoadmapNode) => void;
}

/** Gamification rail: level, streak, next quest, cohort ranking. */
export function StatsRail({ track, onSelectNode }: StatsRailProps) {
  const { learner: L, leaderboard } = track;
  const pct = Math.min(100, Math.round((L.xp / L.xpToNext) * 100));
  const quest = currentNode(track);

  return (
    <aside className={styles.rail} aria-label="Progress">
      {/* level */}
      <section className={styles.card}>
        <div className={styles.eyebrow}>Level progress</div>
        <div className={styles.hero}>
          <div className={styles.ring} style={{ "--p": pct } as CSSProperties}>
            <div className={styles.ringCore}>
              <div>
                <div className={`${styles.ringLevel} ${styles.tnum}`}>{L.level}</div>
                <div className={styles.ringLabel}>Level</div>
              </div>
            </div>
          </div>
          <div>
            <div className={styles.rank}>{L.rank}</div>
            <div className={styles.rankPct}>
              {pct}% to Lv {L.level + 1}
            </div>
          </div>
        </div>
        <div className={styles.bar}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className={styles.xpLine}>
          <b className={styles.tnum}>{fmt(L.xp)}</b> / {fmt(L.xpToNext)} XP
        </div>
      </section>

      {/* streak */}
      <section className={styles.card}>
        <div className={styles.eyebrow}>Streak</div>
        <div className={styles.streakRow}>
          <div>
            <div className={styles.streakBig}>
              <Icon name="flame" />
              <span className={styles.tnum}>{L.streak}</span>
            </div>
            <div className={styles.streakSub}>day streak</div>
          </div>
          <div className={styles.week}>
            {L.week.map((hit, i) => (
              <i key={i} className={hit ? styles.hit : ""}>
                {DAYS[i]}
              </i>
            ))}
          </div>
        </div>
      </section>

      {/* continue quest */}
      {quest && (
        <section className={styles.card}>
          <div className={styles.eyebrow}>Continue quest</div>
          <div className={styles.quest}>
            <div
              className={styles.questIcon}
              style={{
                background: `radial-gradient(circle at 50% 30%, ${NODE_STYLE[quest.node.type].top}, ${NODE_STYLE[quest.node.type].edge})`,
              }}
            >
              <Icon name={quest.node.type} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className={styles.questName}>{quest.node.title}</div>
              <div className={styles.questSub}>
                {quest.unitKind} · {NODE_STYLE[quest.node.type].label}
              </div>
            </div>
            <div className={`${styles.questXp} ${styles.tnum}`}>+{quest.node.xp}</div>
          </div>
          <button type="button" className={styles.questBtn} onClick={() => onSelectNode(quest.node)}>
            {NODE_STYLE[quest.node.type].boss ? "Take on the boss" : "Continue"}
          </button>
        </section>
      )}

      {/* cohort ranking */}
      {leaderboard && leaderboard.length > 0 && (
        <section className={styles.card}>
          <div className={styles.eyebrow}>
            Cohort ranking <span className={styles.more}>This week</span>
          </div>
          <div className={styles.lb}>
            {leaderboard.map((row, i) => (
              <div
                key={row.alias}
                className={`${styles.lbRow} ${row.you ? styles.lbYou : ""} ${i < 3 ? styles.lbTop : ""}`}
              >
                <div className={styles.lbRank}>{i + 1}</div>
                <div
                  className={styles.lbAvatar}
                  style={{ background: `radial-gradient(circle at 50% 30%, ${row.color}, ${row.color})` }}
                >
                  {row.alias[0]}
                </div>
                <div className={styles.lbName}>
                  {row.alias} {row.you && <em>· you</em>}
                </div>
                <div className={`${styles.lbXp} ${styles.tnum}`}>{fmt(row.xp)}</div>
              </div>
            ))}
          </div>
          <p className={styles.lbNote}>
            ⚠ Anonymized aliases — no names or student IDs. Pal&rsquo;s privacy rules currently
            forbid rankings; ships only behind an opt-in product decision.
          </p>
        </section>
      )}
    </aside>
  );
}
