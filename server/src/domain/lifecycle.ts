export type SubStatus = 'draft' | 'quotation' | 'confirmed' | 'active' | 'paused' | 'closed';
export type SubAction = 'send' | 'confirm' | 'activate' | 'pause' | 'resume' | 'close';
export type InvStatus = 'draft' | 'confirmed' | 'paid' | 'cancelled';

export const SUB_STATUSES: SubStatus[] = ['draft', 'quotation', 'confirmed', 'active', 'paused', 'closed'];
export const SUB_ACTIONS: SubAction[] = ['send', 'confirm', 'activate', 'pause', 'resume', 'close'];

const MOVES: Record<SubAction, Partial<Record<SubStatus, SubStatus>>> = {
  send: { draft: 'quotation' },
  confirm: { draft: 'confirmed', quotation: 'confirmed' },
  activate: { confirmed: 'active' },
  pause: { active: 'paused' },
  resume: { paused: 'active' },
  close: { draft: 'closed', quotation: 'closed', confirmed: 'closed', active: 'closed', paused: 'closed' },
};

export function nextStatus(from: SubStatus, action: SubAction): SubStatus | null {
  return MOVES[action]?.[from] ?? null;
}
