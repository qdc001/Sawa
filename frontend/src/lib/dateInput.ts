// Helpers de data para inputs e grelhas de calendário.
//
// NUNCA usar `toISOString()` para preencher um <input type="datetime-local">
// nem para construir chaves de dia. `toISOString()` converte para UTC e, num
// fuso como o de Maputo (UTC+2), isso desloca a hora em 2h e a data em 1 dia:
//   - o input mostrava 07:00 para uma tarefa marcada às 09:00;
//   - ao gravar, a hora era reinterpretada como local e a tarefa recuava 2h
//     em cada edição;
//   - a célula do dia 8 ficava com a chave "…-07" e apanhava as tarefas do 9.
// Estas funções trabalham sempre com os componentes locais da data.

const pad = (n: number) => String(n).padStart(2, '0');

const asDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Data -> "YYYY-MM-DDTHH:MM" em hora local, para <input type="datetime-local">. */
export function toDateTimeLocal(value: Date | string | null | undefined): string {
  const d = asDate(value);
  if (!d) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Data -> "YYYY-MM-DD" em hora local. Chave de dia para grelhas de calendário. */
export function toDateKey(value: Date | string | null | undefined): string {
  const d = asDate(value);
  if (!d) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Valor de <input type="datetime-local"> -> ISO (UTC) para enviar ao backend. */
export function fromDateTimeLocal(value: string | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value); // sem offset, o JS interpreta como hora local
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
