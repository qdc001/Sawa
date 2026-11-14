export type DefenseSession = {
  id: string; day: string; hour: number; room: number; number: number | null; title: string; notes: string | null; studentId: string | null; contactId: string | null;
  student: { id: string; code: string; name: string; project: string | null; whatsapp: string | null } | null;
  participants: { userId: string; name: string }[];
  associateId: string | null; associate: { id: string; name: string; userId: string | null } | null;
  slidesUrl: string | null; slidesName: string | null; slidesAt: string | null;
};
export type DefensePending = {
  required: number; day: string; sessions: DefenseSession[]; mine: string[]; maxPerSession: number; mode: 'block' | 'remind'; gateTime: string; roomNames: string[];
  // Sessoes de amanha em que esta pessoa e a responsavel pelo estudante e ainda faltam os slides.
  slides: DefenseSession[]; fillMin: number;
};
// Dia da semana 0 = domingo ... 6 = sabado; end = hora em que termina a ultima sessao.
export type DaySchedule = { on: boolean; start: number; end: number };
export type DefenseConfig = {
  rooms: number; maxPerSession: number; participants: string[]; users: { id: string; name: string; role: string }[];
  canManage: boolean; isParticipant: boolean; minChoices: number; gateTime: string; gateEnabled: boolean; gateMode: 'block' | 'remind';
  schedule: DaySchedule[]; roomNames: string[];
  associates: { id: string; name: string; userId: string | null }[]; canCreate: boolean; fillMin: number;
  // Por dia da semana das sessoes (0 = domingo): escolher N dias antes, a partir de uma hora (null = hora do aviso).
  gateRules: { daysBefore: number; time: string | null }[];
};

// Igual ao servidor: enquanto houver sessoes do dia com menos de fillMin associados, so se entra nas que tem menos gente;
// e ninguem fica em duas sessoes a mesma hora. Devolve o motivo do bloqueio (ou null). "picked" = escolhidas mas ainda nao gravadas.
export function balanceBlock(
  s: DefenseSession, daySessions: DefenseSession[], userId: string | undefined, picked: Set<string>, fillMin: number, max: number,
): string | null {
  const count = (x: DefenseSession) => x.participants.length + (picked.has(x.id) ? 1 : 0);
  const isMine = (x: DefenseSession) => x.participants.some((p) => p.userId === userId) || picked.has(x.id);
  if (isMine(s)) return null;
  const myHours = new Set(daySessions.filter(isMine).map((x) => x.hour));
  if (myHours.has(s.hour)) return `Já tens uma sessão às ${s.hour}h`;
  if (fillMin <= 0) return null;
  const cands = daySessions.filter((x) => !isMine(x) && !myHours.has(x.hour) && (!max || count(x) < max));
  const min = Math.min(...cands.map(count));
  if (min < fillMin && count(s) > min) return `Primeiro as sessões com ${min} ${min === 1 ? 'associado' : 'associados'} (todas têm de chegar a ${fillMin})`;
  return null;
}

// "S2 · Nome do estudante"
export const sessionTitle = (s: { number: number | null; title: string }) => `${s.number ? `S${s.number} · ` : ''}${s.title}`;
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
