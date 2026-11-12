import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import api from '../../lib/api';
import { addDays, Associate, dateLabel, downloadFile, errMsg, inputSm, maputoToday, mondayOf, monthLabel, Th } from './shared';

export type ReportCell = string | number | null;
export type ReportTable = { title?: string; columns: string[]; rows: ReportCell[][]; numeric?: number[]; empty?: string };
export type ReportDoc = { title: string; subtitle: string; generatedAt: string; sections: { heading: string; intro?: string; bullets?: string[]; tables?: ReportTable[] }[] };

const show = (v: ReportCell) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString('pt-PT') : v);

// Mostra no ecra o mesmo conteudo que vai para o Word, PDF e Excel.
export function ReportView({ doc }: { doc: ReportDoc }) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">{doc.title}</h2>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{doc.subtitle}</p>
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Gerado em {doc.generatedAt}</p>
      </div>
      {doc.sections.map((s) => (
        <div key={s.heading} className="card p-4 space-y-2">
          <h3 className="font-semibold text-sm">{s.heading}</h3>
          {s.intro && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.intro}</p>}
          {!!s.bullets?.length && <ul className="text-sm list-disc pl-5 space-y-0.5">{s.bullets.map((b) => <li key={b}>{b}</li>)}</ul>}
          {(s.tables || []).map((t, ti) => (
            <div key={ti} className="space-y-1">
              {t.title && <p className="text-xs font-semibold mt-2">{t.title}</p>}
              {t.rows.length === 0 ? <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>{t.empty || 'Nada a registar.'}</p> : (
                <div className="overflow-x-auto" style={{ maxHeight: 420, overflowY: 'auto' }}>
                  <table className="w-full">
                    <thead><tr>{t.columns.map((c, i) => <Th key={i} right={t.numeric?.includes(i)}>{c}</Th>)}</tr></thead>
                    <tbody>{t.rows.map((r, ri) => (
                      <tr key={ri}>{r.map((v, i) => (
                        <td key={i} className={`py-1.5 px-2 text-sm align-top ${t.numeric?.includes(i) ? 'text-right whitespace-nowrap' : ''}`}
                          style={{ borderBottom: '1px solid var(--border)', fontWeight: r[0] === 'Total' ? 600 : undefined, maxWidth: 380, whiteSpace: typeof v === 'string' && v.length > 40 ? 'normal' : 'nowrap' }}>{show(v)}</td>
                      ))}</tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function DownloadButtons({ url, params, base, formats = ['docx', 'pdf', 'xlsx'] }: { url: string; params: Record<string, string>; base: string; formats?: ('docx' | 'pdf' | 'xlsx')[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const get = async (format: string) => {
    setBusy(format);
    try { await downloadFile(url, { ...params, format }, `${base}.${format}`); } catch (e: any) { toast.error(e.message); } finally { setBusy(null); }
  };
  const label: Record<string, [string, any]> = { docx: ['Word', FileText], pdf: ['PDF', FileDown], xlsx: ['Excel', FileSpreadsheet] };
  return (
    <span className="flex gap-1.5 flex-wrap">
      {formats.map((f) => {
        const [l, Icon] = label[f];
        return <button key={f} className="btn btn-outline" style={{ fontSize: 12, padding: '4px 10px' }} disabled={!!busy} onClick={() => get(f)}>{busy === f ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />} {l}</button>;
      })}
    </span>
  );
}

function TrainingNotes({ month, doc, training, associates, onSaved }: { month: string; doc: ReportDoc; training: Record<string, string>; associates: Associate[]; onSaved: () => void }) {
  const table = doc.sections.flatMap((s) => s.tables || []).find((t) => t.title === 'Necessidades de formação');
  const names = new Set((table?.rows || []).map((r) => r[0]));
  const list = associates.filter((a) => names.has(a.name));
  const [txt, setTxt] = useState<Record<string, string>>(training);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setTxt(training), [training]);
  if (!list.length) return null;
  const save = async (id: string) => {
    setBusy(id);
    try { await api.put('/finance/work/reports/training', { month, associateId: id, text: txt[id] || '' }); toast.success('Avaliação guardada'); onSaved(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(null); }
  };
  return (
    <div className="card p-4 space-y-2">
      <h3 className="font-semibold text-sm">A tua avaliação · necessidades de formação ({monthLabel(month)})</h3>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>O que escreves aqui fica neste mês e entra no relatório (coluna "Avaliação da direcção").</p>
      {list.map((a) => (
        <div key={a.id} className="grid grid-cols-1 sm:grid-cols-[160px_1fr_auto] gap-2 items-start">
          <span className="text-sm font-medium pt-1.5">{a.name}</span>
          <textarea className="input-base" rows={2} value={txt[a.id] || ''} onChange={(e) => setTxt((p) => ({ ...p, [a.id]: e.target.value }))} placeholder="Ex.: formação em análise estatística; acompanhar a revisão de literatura" />
          <button className="btn btn-outline" disabled={busy === a.id || (txt[a.id] || '') === (training[a.id] || '')} onClick={() => save(a.id)}>{busy === a.id ? <Loader2 size={13} className="animate-spin" /> : null} Guardar</button>
        </div>
      ))}
    </div>
  );
}

export default function FinanceReports({ associates }: { associates: Associate[] }) {
  const [kind, setKind] = useState<'weekly' | 'monthly'>('weekly');
  const [week, setWeek] = useState(() => mondayOf(maputoToday()));
  const [month, setMonth] = useState(() => maputoToday().slice(0, 7));
  const [doc, setDoc] = useState<(ReportDoc & { training?: Record<string, string> }) | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const req = kind === 'weekly' ? api.get('/finance/work/reports/weekly', { params: { week } }) : api.get('/finance/work/reports/monthly', { params: { month } });
    req.then(({ data }) => setDoc(data)).catch((e) => toast.error(errMsg(e, 'Erro a gerar o relatório'))).finally(() => setLoading(false));
  }, [kind, week, month]);
  useEffect(load, [load]);

  const shiftMonth = (n: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };

  return (
    <div className="space-y-4">
      <div className="card p-3 flex items-center gap-2 flex-wrap">
        <div className="flex gap-1">
          {(['weekly', 'monthly'] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} className="text-xs px-3 py-1.5 rounded font-medium"
              style={{ background: kind === k ? 'var(--primary)' : 'var(--surface-3)', color: kind === k ? '#fff' : 'var(--text-secondary)' }}>{k === 'weekly' ? 'Semanal' : 'Mensal'}</button>
          ))}
        </div>
        <span className="flex items-center gap-1">
          <button className="btn btn-outline" style={{ padding: '4px 6px' }} aria-label="Anterior" onClick={() => (kind === 'weekly' ? setWeek(addDays(week, -7)) : shiftMonth(-1))}><ChevronLeft size={14} /></button>
          {kind === 'weekly'
            ? <input className="input-base" style={{ ...inputSm, width: 150 }} type="date" value={week} onChange={(e) => e.target.value && setWeek(mondayOf(e.target.value))} />
            : <input className="input-base" style={{ ...inputSm, width: 150 }} type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />}
          <button className="btn btn-outline" style={{ padding: '4px 6px' }} aria-label="Seguinte" onClick={() => (kind === 'weekly' ? setWeek(addDays(week, 7)) : shiftMonth(1))}><ChevronRight size={14} /></button>
        </span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {kind === 'weekly' ? `${dateLabel(week)} a ${dateLabel(addDays(week, 6))} (segunda a domingo)` : monthLabel(month)}
        </span>
        <span className="ml-auto">
          <DownloadButtons
            url={`/finance/work/reports/${kind}`}
            params={kind === 'weekly' ? { week } : { month }}
            base={kind === 'weekly' ? `relatorio-semanal-${week}` : `relatorio-mensal-${month}`}
          />
        </span>
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Os relatórios saem do histórico de cada estudante (botão <b>Histórico</b> na lista de Estudantes ou no Quadro de fases): revisões técnicas, questões, correcções pedidas e defesas, mais as mudanças de fase, que ficam registadas sozinhas.
      </p>
      {loading || !doc ? <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin" /></div> : (
        <>
          <ReportView doc={doc} />
          {kind === 'monthly' && <TrainingNotes month={month} doc={doc} training={doc.training || {}} associates={associates} onSaved={load} />}
        </>
      )}
    </div>
  );
}
