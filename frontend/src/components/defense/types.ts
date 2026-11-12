export type DefenseSession = {
  id: string; day: string; hour: number; room: number; title: string; notes: string | null; studentId: string | null; contactId: string | null;
  student: { id: string; code: string; name: string; project: string | null; whatsapp: string | null } | null;
  participants: { userId: string; name: string }[];
};
export type DefensePending = {
  required: number; day: string; sessions: DefenseSession[]; mine: string[]; maxPerSession: number; mode: 'block' | 'remind'; gateTime: string; roomNames: string[];
};
// Dia da semana 0 = domingo ... 6 = sabado; end = hora em que termina a ultima sessao.
export type DaySchedule = { on: boolean; start: number; end: number };
export type DefenseConfig = {
  rooms: number; maxPerSession: number; participants: string[]; users: { id: string; name: string; role: string }[];
  canManage: boolean; isParticipant: boolean; minChoices: number; gateTime: string; gateEnabled: boolean; gateMode: 'block' | 'remind';
  schedule: DaySchedule[]; roomNames: string[];
};

export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00`;
export const dayOfWeek = (day: string) => new Date(`${day}T00:00:00.000Z`).getUTCDay();
export function hoursFor(day: string, schedule: DaySchedule[]): number[] {
  const d = schedule[dayOfWeek(day)];
  return d?.on ? Array.from({ length: Math.max(0, d.end - d.start) }, (_, i) => d.start + i) : [];
}
export const roomLabel = (cfg: { roomNames: string[] }, n: number) => cfg.roomNames[n - 1]?.trim() || `Sala ${n}`;
export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const weekdayName = (day: string) => WEEKDAYS[new Date(`${day}T00:00:00.000Z`).getUTCDay()];
export const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
