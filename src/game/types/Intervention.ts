/** Payloads shared by ClubScene ↔ UIScene for the direct-intervention layer. */

export type CtxTarget =
  | { kind: 'furniture'; id: string }
  /** Floor zone; col/row = the clicked tile (enables "Caminar aquí"). */
  | { kind: 'floor'; id: string; col?: number; row?: number }
  /** A package (crate / bottle / sack) waiting at the entrance. */
  | { kind: 'goods'; id: string }
  /** One piece of trash on the floor. */
  | { kind: 'trash'; id: string }
  /** The full trash bag lying in the club. */
  | { kind: 'trash_bag'; id: string };

export interface CtxAction {
  id: string;
  label: string;
  enabled: boolean;
  /** Why it is disabled (e.g. 'Sin dinero', 'Técnico en camino'). */
  hint?: string;
}

export interface ContextMenuPayload {
  staffId: string;
  staffName: string;
  staffOptions: Array<{ id: string; name: string }>;
  target: CtxTarget;
  title: string;
  subtitle: string;
  actions: CtxAction[];
  /** Screen position of the click. */
  x: number;
  y: number;
}

export interface TechListPayload {
  furnitureId: string;
  furnitureName: string;
  staffName: string;
  money: number;
  techs: Array<{ id: string; name: string; stars: number; fee: number; canAfford: boolean }>;
}

export interface RepairVerdictPayload {
  jobId: string;
  techName: string;
  furnitureName: string;
  diagnosis: string;
  /** Repair quote. The verdict deliberately carries NO new-item price: the player compares on their own. */
  cost: number;
  /** Only used to enable/disable REPARAR (never shown as a comparison). */
  money: number;
  canAfford: boolean;
}
