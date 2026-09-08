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
}
