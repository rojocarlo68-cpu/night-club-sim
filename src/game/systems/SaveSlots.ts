/**
 * Manual save slots (pause menu). Reuses the existing autosave payload (ClubScene SavedLayout,
 * localStorage 'night-club-layout-v1') and adds a `live` section with the in-progress night
 * (clock, staff, customers, timers…). No parallel data model: both sections are produced by the
 * same serializers the game already uses.
 *
 * Loading = write the slot's layout as the current autosave + stash its live section for the
 * next boot, then reload the page. A full page reload is the teardown: every module singleton,
 * Phaser object, timer and event listener of the previous game is gone, so nothing can duplicate.
 */

export const LAYOUT_KEY = 'night-club-layout-v1';
export const SAVE_FORMAT_VERSION = 1;
export const SLOT_COUNT = 3;
const SLOT_PREFIX = 'night-club-save-slot-';
/** sessionStorage: live section waiting to be applied by the next ClubScene boot. */
export const PENDING_LIVE_KEY = 'night-club-pending-live';
/** sessionStorage: exact snapshot taken when going to the title screen (CONTINUAR). */

export interface SaveMeta {
  day: number;
  clock: string;
  money: number;
  phaseLabel: string;
}

export interface SaveSlotData {
  v: number;
  savedAt: number;
  meta: SaveMeta;
  layout: unknown;
  live: unknown;
}

export interface SlotSummary {
  id: string;
  label: string;
  empty: boolean;
  meta?: SaveMeta;
  savedAt?: number;
  autosave?: boolean;
}

function slotKey(n: number): string {
  return `${SLOT_PREFIX}${n}`;
}

export function readSlot(n: number): SaveSlotData | null {
  try {
    const raw = localStorage.getItem(slotKey(n));
    if (!raw) return null;
    const o = JSON.parse(raw) as SaveSlotData;
    if (!o || typeof o !== 'object' || typeof o.v !== 'number' || !o.layout) return null;
    if (o.v > SAVE_FORMAT_VERSION) return null; // from a newer build: never half-load it
    return o;
  } catch {
    return null;
  }
}

export function writeSlot(n: number, data: SaveSlotData): boolean {
  try {
    localStorage.setItem(slotKey(n), JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** Autosave (existing continuous save) summary: day / money; clock is always the next day start. */
export function readAutosaveSummary(): SlotSummary | null {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { money?: number; nightNumber?: number; shift?: { currentDay?: number } };
    const day = o?.shift?.currentDay ?? o?.nightNumber ?? 1;
    return {
      id: 'auto',
      label: 'Autoguardado',
      empty: false,
      autosave: true,
      meta: { day, clock: '17:00', money: typeof o?.money === 'number' ? o.money : 0, phaseLabel: 'inicio del día' },
    };
  } catch {
    return null;
  }
}

export function listSlots(): SlotSummary[] {
  const out: SlotSummary[] = [];
  for (let n = 1; n <= SLOT_COUNT; n++) {
    const d = readSlot(n);
    out.push(d ? { id: String(n), label: `Ranura ${n}`, empty: false, meta: d.meta, savedAt: d.savedAt } : { id: String(n), label: `Ranura ${n}`, empty: true });
  }
  return out;
}

export function hasAnySave(): boolean {
  return listSlots().some((s) => !s.empty) || !!readAutosaveSummary();
}

/** Make `data` the current game and reload (full teardown). */
export function bootIntoSave(data: { layout: unknown; live: unknown }): void {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(data.layout));
    if (data.live) sessionStorage.setItem(PENDING_LIVE_KEY, JSON.stringify(data.live));
    else sessionStorage.removeItem(PENDING_LIVE_KEY);
  } catch {
    /* quota / private mode: reload still restores whatever was written */
  }
  window.location.reload();
}

/** Reload into the autosave as-is (existing behaviour: next day start when saved mid-night). */
export function bootIntoAutosave(): void {
  try {
    sessionStorage.removeItem(PENDING_LIVE_KEY);
  } catch {
    /* ignore */
  }
  window.location.reload();
}

/** Existing new-game path (Bancarrota → Nueva partida): drop the autosave and reload. Slots stay. */
export function bootNewGame(): void {
  try {
    localStorage.removeItem(LAYOUT_KEY);
    sessionStorage.removeItem(PENDING_LIVE_KEY);
  } catch {
    /* ignore */
  }
  window.location.reload();
}

export function takePendingLive(): unknown {
  try {
    const raw = sessionStorage.getItem(PENDING_LIVE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_LIVE_KEY);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function formatSavedAt(ms?: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
