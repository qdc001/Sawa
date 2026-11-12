export type DefenseSession = {
  id: string; day: string; hour: number; room: number; title: string; notes: string | null; studentId: string | null; contactId: string | null;
  student: { id: string; code: string; name: string; project: string | null; whatsapp: string | null } | null;
  participants: { userId: string; name: string }[];
};
export type DefensePending = { required: number; day: string; sessions: DefenseSession[]; mine: string[]; maxPerSession: number };
export type DefenseConfig = {
  rooms: number; maxPerSession: number; participants: string[]; users: { id: string; name: string; role: string }[];
  canManage: boolean; isParticipant: boolean; minChoices: number; gateTime: string;
};

export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00`;
export const isWeekendDay = (day: string) => [0, 6].includes(new Date(`${day}T00:00:00.000Z`).getUTCDay());
export const hoursFor = (day: string) => (isWeekendDay(day) ? [8, 9, 10, 11] : [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
export const weekdayName = (day: string) => WEEKDAYS[new Date(`${day}T00:00:00.000Z`).getUTCDay()];
export const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
