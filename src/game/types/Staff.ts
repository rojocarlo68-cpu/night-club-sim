/** Hireable candidate from staff_pool.json */
export interface StaffCandidate {
  id: string;
  name: string;
  roleLabel: string;
  role: string;
  cost: number;
  sprite: string;
  portrait: string;
  energy: number;
  mood: number;
  skill: number;
  energyDrainPerServe: number;
  energyRegenOnRest: number;
  restDurationMs: number;
  serveDurationMs: number;
  moveSpeed: number;
  blurb?: string;
}

export interface StaffPoolFile {
  candidates: StaffCandidate[];
}

/** Row shown in the Staff HUD panel. */
export interface StaffRosterEntry {
  id: string;
  name: string;
  roleLabel: string;
  portrait: string;
  energy: number;
  mood: number;
  skill: number;
  state: string;
  /** Already on payroll (starter or hired). */
  hired: boolean;
  /** Starter Luna — always present. */
  starter?: boolean;
  cost?: number;
  blurb?: string;
  canRest?: boolean;
  canHire?: boolean;
}

export interface StaffRosterPayload {
  money: number;
  current: StaffRosterEntry[];
  hireable: StaffRosterEntry[];
}
