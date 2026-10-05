/** Normalized payload for the unified NPC info panel. */
export interface NpcInfo {
  id: string;
  name: string;
  /** Display role: Barman | Cliente */
  role: 'staff' | 'patron';
  energy?: number;
  mood?: number;
  skill?: number;
  /** Remaining patience (seconds) for patrons. */
  patience?: number;
  patienceMax?: number;
  /** Display name of preferred drink. */
  preferredDrink?: string;
  /** Internal state key (idle, walking, busy, resting, waiting, drinking, leaving, relaxing). */
  state: string;
  /** Texture key for small panel portrait (staff / patrons). */
  portrait?: string;
  /** Per-staff tip counters (Phase 1). */
  tipsNight?: number;
  tipsDay?: number;
  tipsTotal?: number;
  /** Personality summary for selection panel (Phase 2). */
  personality?: { label: string; level: string }[];
  /** Active tip-action label (Phase 3), e.g. 'Bailando'. */
  tipActionLabel?: string | null;
  /** True while serving and seeking a tip (Phase 1/3). */
  seekingTip?: boolean;
  /** Phase 4: compact performance from energy/mood bands. */
  performance?: 'alto' | 'medio' | 'bajo';
  /** Phase 6: Spanish competitiveness label when above threshold (e.g. 'un poco'). */
  competitivenessLabel?: string | null;
}
