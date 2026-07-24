"use client";

import { useState, useCallback, useRef, useEffect, DragEvent } from "react";
import { Glyph, Icon, type IconName } from "./icons";
import { NODE_STYLE } from "./node-styles";
import type { RoadmapData, Track, Unit, RoadmapNode, NodeType, NodeStatus } from "./types";
import styles from "./UnitEditor.module.css";

const DEFAULT_COLORS = [
  "#58CC02", "#1CB0F6", "#CE82FF", "#FF4B4B", "#FFC800",
  "#FB923D", "#5ED5FF", "#A855F7", "#34D399", "#F43F5E",
];

const TYPE_OPTIONS: { type: NodeType; icon: IconName; label: string; color: string }[] = [
  { type: "assignment", icon: "assignment", label: "Assignment", color: "#58CC02" },
  { type: "log", icon: "log", label: "Daily Log", color: "#1CB0F6" },
  { type: "chest", icon: "chest", label: "Reward", color: "#FFC800" },
  { type: "project", icon: "project", label: "Project", color: "#CE82FF" },
  { type: "test", icon: "test", label: "Test", color: "#FF4B4B" },
];

const STATUS_OPTIONS: NodeStatus[] = ["done", "current", "locked"];

interface UnitEditorProps {
  data: RoadmapData;
  onSave: (data: RoadmapData) => void;
  onClose: () => void;
  activeTrackIndex: number;
}

function genId(prefix = "n") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export function UnitEditor({ data, onSave, onClose, activeTrackIndex }: UnitEditorProps) {
  const [tracks, setTracks] = useState(data.tracks);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [modal, setModal] = useState<{
    type: "unit" | "assignment";
    mode: "add" | "edit";
    unitId?: string;
    assignmentId?: string;
  } | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [draggedUnit, setDraggedUnit] = useState<string | null>(null);
  const [draggedAssignment, setDraggedAssignment] = useState<{ unitId: string; assignmentId: string } | null>(null);
  const [tab, setTab] = useState<"units" | "collectables">("units");

  const currentTrack = tracks[activeTrackIndex];
  const selectedUnit = currentTrack?.units.find((u) => u.id === selectedUnitId);

  useEffect(() => {
    setTracks(data.tracks);
  }, [data]);

  const saveTracks = useCallback(() => {
    onSave({ ...data, tracks });
  }, [data, tracks, onSave]);

  // --- Unit actions ---
  const addUnit = () => {
    const newUnit: Unit = {
      id: genId("u"),
      kind: `Unit ${currentTrack.units.length + 1}`,
      title: "New Unit",
      subtitle: "",
      color: DEFAULT_COLORS[currentTrack.units.length % DEFAULT_COLORS.length],
      icon: "assignment",
      nodes: [],
    };
    setTracks((t) => {
      const next = deepClone(t);
      next[activeTrackIndex].units.push(newUnit);
      return next;
    });
    setSelectedUnitId(newUnit.id);
  };

  const deleteUnit = (unitId: string) => {
    setTracks((t) => {
      const next = deepClone(t);
      next[activeTrackIndex].units = next[activeTrackIndex].units.filter((u) => u.id !== unitId);
      return next;
    });
    if (selectedUnitId === unitId) setSelectedUnitId(null);
  };

  const openUnitModal = (mode: "add" | "edit", unit?: Unit) => {
    setForm({
      kind: unit?.kind || `Unit ${currentTrack.units.length + 1}`,
      title: unit?.title || "New Unit",
      subtitle: unit?.subtitle || "",
      color: unit?.color || DEFAULT_COLORS[currentTrack.units.length % DEFAULT_COLORS.length],
      icon: unit?.icon || "assignment",
    });
    setModal({ type: "unit", mode, unitId: unit?.id });
  };

  const saveUnit = () => {
    if (!modal || modal.type !== "unit") return;
    setTracks((t) => {
      const next = deepClone(t);
      const track = next[activeTrackIndex];
      if (modal.mode === "add") {
        track.units.push({
          id: genId("u"),
          kind: form.kind,
          title: form.title,
          subtitle: form.subtitle,
          color: form.color,
          icon: form.icon,
          nodes: [],
        });
      } else {
        const idx = track.units.findIndex((u) => u.id === modal.unitId);
        if (idx >= 0) {
          track.units[idx] = { ...track.units[idx], kind: form.kind, title: form.title, subtitle: form.subtitle, color: form.color, icon: form.icon };
        }
      }
      return next;
    });
    setModal(null);
  };

  // --- Assignment actions ---
  const openAssignmentModal = (mode: "add" | "edit", unitId: string, assignment?: RoadmapNode) => {
    const isBoss = assignment?.type === "project" || assignment?.type === "test";
    setForm({
      type: assignment?.type || "assignment",
      title: assignment?.title || "New Assignment",
      xp: assignment?.xp || (isBoss ? 500 : 100),
      status: assignment?.status || "locked",
      crown: assignment?.crown || 0,
      description: assignment?.description || "",
      link: assignment?.href || "",
      icon: assignment?.icon || "",
    });
    setModal({ type: "assignment", mode, unitId, assignmentId: assignment?.id });
  };

  const saveAssignment = () => {
    if (!modal || modal.type !== "assignment") return;
    setTracks((t) => {
      const next = deepClone(t);
      const track = next[activeTrackIndex];
      const unit = track.units.find((u) => u.id === modal.unitId);
      if (!unit) return next;

      const fields = {
        type: form.type,
        title: form.title,
        xp: form.xp,
        status: form.status,
        crown: form.crown,
        description: form.description || undefined,
        href: form.link || undefined,
        icon: form.icon || undefined,
      };
      if (modal.mode === "add") {
        unit.nodes.push({ id: genId("n"), ...fields });
      } else {
        const idx = unit.nodes.findIndex((n) => n.id === modal.assignmentId);
        if (idx >= 0) {
          unit.nodes[idx] = { ...unit.nodes[idx], ...fields };
        }
      }
      return next;
    });
    setModal(null);
  };

  const deleteAssignment = (unitId: string, assignmentId: string) => {
    setTracks((t) => {
      const next = deepClone(t);
      const unit = next[activeTrackIndex].units.find((u) => u.id === unitId);
      if (unit) {
        unit.nodes = unit.nodes.filter((n) => n.id !== assignmentId);
      }
      return next;
    });
  };

  // --- Chests (added without a naming step) ---
  const addChest = (unitId: string) => {
    setTracks((t) => {
      const next = deepClone(t);
      const u = next[activeTrackIndex].units.find((x) => x.id === unitId);
      if (u) u.nodes.push({ id: genId("n"), type: "chest", title: "Chest", xp: 60, status: "locked" });
      return next;
    });
  };
  const randomAddChests = (unitId: string) => {
    setTracks((t) => {
      const next = deepClone(t);
      const u = next[activeTrackIndex].units.find((x) => x.id === unitId);
      if (!u) return next;
      const count = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) {
        const pos = Math.floor(Math.random() * (u.nodes.length + 1));
        u.nodes.splice(pos, 0, {
          id: genId("n"),
          type: "chest",
          title: "Chest",
          xp: 40 + Math.floor(Math.random() * 8) * 10,
          status: "locked",
        });
      }
      return next;
    });
  };

  // --- Drag & drop for units ---
  const onUnitDragStart = (e: DragEvent, unitId: string) => {
    setDraggedUnit(unitId);
    e.dataTransfer.effectAllowed = "move";
  };

  const onUnitDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const onUnitDrop = (e: DragEvent, targetUnitId: string) => {
    e.preventDefault();
    if (!draggedUnit || draggedUnit === targetUnitId) return;

    setTracks((t) => {
      const next = deepClone(t);
      const units = next[activeTrackIndex].units;
      const fromIdx = units.findIndex((u) => u.id === draggedUnit);
      const toIdx = units.findIndex((u) => u.id === targetUnitId);
      if (fromIdx >= 0 && toIdx >= 0) {
        const [moved] = units.splice(fromIdx, 1);
        units.splice(toIdx, 0, moved);
      }
      return next;
    });
    setDraggedUnit(null);
  };

  const onUnitDragEnd = () => setDraggedUnit(null);

  // --- Drag & drop for assignments ---
  const onAssignmentDragStart = (e: DragEvent, unitId: string, assignmentId: string) => {
    setDraggedAssignment({ unitId, assignmentId });
    e.dataTransfer.effectAllowed = "move";
  };

  const onAssignmentDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const onAssignmentDrop = (e: DragEvent, targetUnitId: string, targetAssignmentId: string) => {
    e.preventDefault();
    if (!draggedAssignment) return;

    setTracks((t) => {
      const next = deepClone(t);
      const fromUnit = next[activeTrackIndex].units.find((u) => u.id === draggedAssignment.unitId);
      const toUnit = next[activeTrackIndex].units.find((u) => u.id === targetUnitId);
      if (!fromUnit || !toUnit) return next;

      const fromIdx = fromUnit.nodes.findIndex((n) => n.id === draggedAssignment.assignmentId);
      const toIdx = toUnit.nodes.findIndex((n) => n.id === targetAssignmentId);
      if (fromIdx < 0 || toIdx < 0) return next;

      const [moved] = fromUnit.nodes.splice(fromIdx, 1);
      if (fromUnit === toUnit) {
        toUnit.nodes.splice(toIdx, 0, moved);
      } else {
        toUnit.nodes.splice(toIdx, 0, moved);
      }
      return next;
    });
    setDraggedAssignment(null);
  };

  const onAssignmentDragEnd = () => setDraggedAssignment(null);

  // --- Collectables (chest reward pool) ---
  const addCollectable = () => {
    setTracks((t) => {
      const next = deepClone(t);
      const tr = next[activeTrackIndex];
      (tr.collectables ||= []).push({ id: genId("c"), name: "New collectable", icon: "⭐" });
      return next;
    });
  };
  const updateCollectable = (id: string, field: "name" | "icon", value: string) => {
    setTracks((t) => {
      const next = deepClone(t);
      const c = (next[activeTrackIndex].collectables || []).find((x) => x.id === id);
      if (c) c[field] = value;
      return next;
    });
  };
  const deleteCollectable = (id: string) => {
    setTracks((t) => {
      const next = deepClone(t);
      const tr = next[activeTrackIndex];
      tr.collectables = (tr.collectables || []).filter((x) => x.id !== id);
      return next;
    });
  };
  // Store an uploaded image file as a data URL in the collectable's icon.
  const uploadCollectableImage = (id: string, file: File) => {
    const reader = new FileReader();
    reader.onload = () => updateCollectable(id, "icon", String(reader.result));
    reader.readAsDataURL(file);
  };

  if (!currentTrack) return null;
  const collectables = currentTrack.collectables || [];

  return (
    <div className={styles.editor}>
      <header className={styles.editorHeader}>
        <h1 className={styles.editorTitle}>Roadmap Editor</h1>
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === "units" ? styles.tabActive : ""}`}
            onClick={() => setTab("units")}
          >
            Units
          </button>
          <button
            className={`${styles.tab} ${tab === "collectables" ? styles.tabActive : ""}`}
            onClick={() => setTab("collectables")}
          >
            Collectables
          </button>
        </div>
        <div className={styles.editorActions}>
          <button className={`${styles.btn} ${styles.btnGhost}`} onClick={onClose}>
            <Icon name="chevron" /> Back
          </button>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => { saveTracks(); onClose(); }}>
            <Icon name="check" /> Save & Close
          </button>
        </div>
      </header>

      <div className={styles.editorBody}>
        {tab === "units" ? (
          <>
        {/* Unit List */}
        <aside className={styles.unitList}>
          {currentTrack.units.map((unit) => (
            <div
              key={unit.id}
              className={`${styles.unitItem} ${selectedUnitId === unit.id ? styles.active : ""}`}
              onClick={() => setSelectedUnitId(unit.id)}
              draggable
              onDragStart={(e) => onUnitDragStart(e, unit.id)}
              onDragOver={onUnitDragOver}
              onDrop={(e) => onUnitDrop(e, unit.id)}
              onDragEnd={onUnitDragEnd}
            >
              <Icon name="arrowUp" className={styles.unitDrag} />
              <div className={styles.unitColor} style={{ background: unit.color }} />
              <div className={styles.unitInfo}>
                <div className={styles.unitKind}>{unit.kind}</div>
                <div className={styles.unitName}>{unit.title}</div>
              </div>
              <div className={styles.unitActions}>
                <button className={styles.iconBtn} onClick={(e) => { e.stopPropagation(); openUnitModal("edit", unit); }} aria-label="Edit unit">
                  <Icon name="pencil" />
                </button>
                <button className={`${styles.iconBtn} ${styles.delete}`} onClick={(e) => { e.stopPropagation(); deleteUnit(unit.id); }} aria-label="Delete unit">
                  <Icon name="trash" />
                </button>
              </div>
            </div>
          ))}
          <button className={`${styles.btn} ${styles.btnPrimary}`} style={{ marginTop: "8px", width: "100%", justifyContent: "center" }} onClick={addUnit}>
            <Icon name="plus" /> Add Unit
          </button>
        </aside>

        {/* Assignment Pane */}
        <div className={styles.assignmentPane}>
          <div className={styles.paneHeader}>
            <h2 className={styles.paneTitle}>
              {selectedUnit ? `${selectedUnit.kind}: ${selectedUnit.title}` : "Assignments"}
            </h2>
            {selectedUnit && (
              <div className={styles.paneActions}>
                <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => openAssignmentModal("add", selectedUnit.id)}>
                  <Icon name="plus" /> Add Assignment
                </button>
                <button className={styles.btn} onClick={() => addChest(selectedUnit.id)} title="Add one chest">
                  <Icon name="chest" /> Add Chest
                </button>
                <button className={styles.btn} onClick={() => randomAddChests(selectedUnit.id)} title="Scatter 1–3 chests at random positions">
                  <Icon name="gift" /> Random Chests
                </button>
              </div>
            )}
          </div>

          <div className={styles.paneBody}>
            {selectedUnit ? (
              selectedUnit.nodes.length > 0 ? (
                <div className={styles.assignmentList}>
                  {selectedUnit.nodes.map((node) => {
                    const style = NODE_STYLE[node.type];
                    const isBoss = style.boss;
                    return (
                      <div
                        key={node.id}
                        className={styles.assignmentItem}
                        draggable
                        onDragStart={(e) => onAssignmentDragStart(e, selectedUnit.id, node.id)}
                        onDragOver={onAssignmentDragOver}
                        onDrop={(e) => onAssignmentDrop(e, selectedUnit.id, node.id)}
                        onDragEnd={onAssignmentDragEnd}
                      >
                        <Icon name="arrowUp" className={styles.assignmentDrag} />
                        <div className={styles.assignmentType} style={{ background: style.top }}>
                          <Icon name={node.type} style={{ width: 22, height: 22 }} />
                        </div>
                        <div className={styles.assignmentInfo}>
                          <div className={styles.assignmentName}>{node.title}</div>
                          <div className={styles.assignmentMeta}>
                            <span className={styles.assignmentXP}><Icon name="gem" style={{ width: 12, height: 12 }} /> {node.xp} XP</span>
                            <span className={styles.assignmentStatus}>{node.status}</span>
                            {isBoss && <span className={`${styles.badge} ${styles.badgeBoss}`}>Boss</span>}
                            {!isBoss && <span className={`${styles.badge} ${styles.badgeNormal}`}>Normal</span>}
                          </div>
                        </div>
                        <div className={styles.assignmentActions}>
                          <button className={styles.iconBtn} onClick={() => openAssignmentModal("edit", selectedUnit.id, node)} aria-label="Edit assignment">
                            <Icon name="pencil" />
                          </button>
                          <button className={`${styles.iconBtn} ${styles.delete}`} onClick={() => deleteAssignment(selectedUnit.id, node.id)} aria-label="Delete assignment">
                            <Icon name="trash" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.paneEmpty}>
                  <Icon name="log" />
                  <span>No assignments yet. Click "Add Assignment" to create one.</span>
                </div>
              )
            ) : (
              <div className={styles.paneEmpty}>
                <Icon name="route" />
                <span>Select a unit on the left to manage its assignments.</span>
              </div>
            )}
          </div>
        </div>
          </>
        ) : (
          <div className={styles.assignmentPane}>
            <div className={styles.paneHeader}>
              <h2 className={styles.paneTitle}>Collectables ({collectables.length})</h2>
              <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={addCollectable}>
                <Icon name="plus" /> Add Collectable
              </button>
            </div>
            <div className={styles.paneBody}>
              {collectables.length > 0 ? (
                <div className={styles.collectableGrid}>
                  {collectables.map((c) => (
                    <div key={c.id} className={styles.collectableItem}>
                      <div className={styles.collectablePreview}>
                        <Glyph icon={c.icon || "⭐"} className={styles.collectableGlyph} />
                      </div>
                      <div className={styles.collectableFields}>
                        <input
                          className={styles.formInput}
                          value={c.icon.startsWith("data:") ? "(uploaded image)" : c.icon}
                          readOnly={c.icon.startsWith("data:")}
                          onChange={(e) => updateCollectable(c.id, "icon", e.target.value)}
                          placeholder="emoji or /image.png"
                        />
                        <div className={styles.collectableRow}>
                          <input
                            className={styles.formInput}
                            value={c.name}
                            onChange={(e) => updateCollectable(c.id, "name", e.target.value)}
                            placeholder="Name"
                          />
                          <label className={styles.upload} title="Upload an image file">
                            <input
                              type="file"
                              accept="image/*"
                              hidden
                              onChange={(e) => e.target.files?.[0] && uploadCollectableImage(c.id, e.target.files[0])}
                            />
                            <Icon name="plus" /> Image
                          </label>
                        </div>
                      </div>
                      <button
                        className={`${styles.iconBtn} ${styles.delete}`}
                        onClick={() => deleteCollectable(c.id)}
                        aria-label="Delete collectable"
                      >
                        <Icon name="trash" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.paneEmpty}>
                  <Icon name="gift" />
                  <span>No collectables yet. These are the rewards chests hand out.</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {modal && (
        <div className={styles.modalOverlay} onClick={() => setModal(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <header className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>
                {modal.type === "unit"
                  ? modal.mode === "add"
                    ? "Add Unit"
                    : "Edit Unit"
                  : modal.mode === "add"
                    ? "Add Assignment"
                    : "Edit Assignment"}
              </h3>
              <button className={styles.modalClose} onClick={() => setModal(null)}>
                <Icon name="chevron" style={{ width: 18, height: 18 }} />
              </button>
            </header>

            {modal.type === "unit" && (
              <>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Unit Label (eyebrow)</label>
                  <input
                    className={styles.formInput}
                    value={form.kind}
                    onChange={(e) => setForm({ ...form, kind: e.target.value })}
                    placeholder="Unit 1"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Title</label>
                  <input
                    className={styles.formInput}
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Foundations"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Subtitle (optional)</label>
                  <input
                    className={styles.formInput}
                    value={form.subtitle}
                    onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
                    placeholder="Variables, loops & logic"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Accent Color</label>
                  <div className={styles.colorGrid}>
                    {DEFAULT_COLORS.map((c) => (
                      <button
                        key={c}
                        className={`${styles.colorSwatch} ${form.color === c ? styles.selected : ""}`}
                        style={{ background: c }}
                        onClick={() => setForm({ ...form, color: c })}
                        aria-label={c}
                      />
                    ))}
                  </div>
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Banner Icon</label>
                  <div className={styles.typeGrid}>
                    {TYPE_OPTIONS.filter((t) => !t.type.includes("project") && !t.type.includes("test")).map((opt) => (
                      <button
                        key={opt.type}
                        className={`${styles.typeOption} ${form.icon === opt.type ? styles.selected : ""}`}
                        onClick={() => setForm({ ...form, icon: opt.type })}
                      >
                        <Icon name={opt.icon} style={{ color: opt.color }} />
                        <span className={styles.typeOptionLabel}>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.formActions}>
                  <button className={styles.btn} onClick={() => setModal(null)}>Cancel</button>
                  <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={saveUnit}>
                    {modal.mode === "add" ? "Add Unit" : "Save Changes"}
                  </button>
                </div>
              </>
            )}

            {modal.type === "assignment" && (
              <>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Type</label>
                  <div className={styles.typeGrid}>
                    {TYPE_OPTIONS.map((opt) => (
                      <button
                        key={opt.type}
                        className={`${styles.typeOption} ${form.type === opt.type ? styles.selected : ""}`}
                        onClick={() => setForm({ ...form, type: opt.type })}
                      >
                        <Icon name={opt.icon} style={{ color: opt.color }} />
                        <span className={styles.typeOptionLabel}>{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Title</label>
                  <input
                    className={styles.formInput}
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="Loops Practice"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Description</label>
                  <textarea
                    className={styles.formInput}
                    rows={3}
                    style={{ resize: "vertical", fontFamily: "inherit" }}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="What the student does in this assignment."
                  />
                </div>
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Link (optional)</label>
                    <input
                      className={styles.formInput}
                      value={form.link}
                      onChange={(e) => setForm({ ...form, link: e.target.value })}
                      placeholder="https://… — leave blank for no link"
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Custom Icon</label>
                    <input
                      className={styles.formInput}
                      value={form.icon}
                      onChange={(e) => setForm({ ...form, icon: e.target.value })}
                      placeholder="emoji, /image.png, or blank"
                    />
                  </div>
                </div>
                <div className={styles.formRow}>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>XP</label>
                    <input
                      className={styles.formInput}
                      type="number"
                      min="0"
                      value={form.xp}
                      onChange={(e) => setForm({ ...form, xp: Number(e.target.value) })}
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label className={styles.formLabel}>Status</label>
                    <select className={styles.formSelect} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as NodeStatus })}>
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Crown (mastery 0–3)</label>
                  <input
                    className={styles.formInput}
                    type="number"
                    min="0"
                    max="3"
                    value={form.crown}
                    onChange={(e) => setForm({ ...form, crown: Number(e.target.value) })}
                  />
                </div>
                <div className={styles.formActions}>
                  <button className={styles.btn} onClick={() => setModal(null)}>Cancel</button>
                  <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={saveAssignment}>
                    {modal.mode === "add" ? "Add Assignment" : "Save Changes"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}