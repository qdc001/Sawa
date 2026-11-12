import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Banknote, History, Link2, Loader2, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { StudentHistoryModal } from './FinanceHistory';
import api from '../../lib/api';
import { Associate, Badge, dateLabel, defensePart, errMsg, Field, Modal, monthLabel, mzn, num, PACKAGE_TIERS, phaseLabel, studentShare, Td, Th, today, usePhases, WALLETS, inputSm } from './shared';

export const PHASE_STATES = ['Entregue', 'Em curso', 'Pendente', 'Atrasado', 'Bloqueado'];
const PROJECTS = ['Mestrado', 'Licenciatura', 'Simulacao', 'Revisao', 'Projeto', 'Analise estatistica'];
const ORIGINS = ['Whatsap', 'Tiktok', 'Instagram', 'Recomendacao', 'Facebook'];
const PAGE = 50;

export type Student = {
  id: string; code: string; name: string; gender: string | null; whatsapp: string | null; faculty: string | null; course: string | null;
  theme: string | null; entryDate: string | null; sellerCredit: boolean | null; currentPhase: number | null; lastActivityAt: string | null;
  phases: Record<string, { status?: string; date?: string }>; notes: string | null; project: string | null; origin: string | null;
  totalValue: number; installments: number | null; paidAmount: number; installmentsPaid: number; nextDueDate: string | null;
  status: string; balance: number; associate: { id: string; code: string; name: string } | null; contactId: string | null;
  completedAt: string | null;
  packageTier: string | null; ledgerBalance: boolean; defenseAssociate: { id: string; code: string; name: string } | null;
  openingPaid: number; openingInstallments: number; ledgerSince: string | null;
};

export function StudentModal({ student, associates, creditName, creditValue, shares, onClose, onSaved, initialName }: {
  student: Student | null; associates: Associate[]; creditName: string; creditValue: number; shares: Record<string, number>;
  onClose: () => void; onSaved: (created?: Student) => void; initialName?: string;
}) {
  const s = student;
  const [f, setF] = useState({
    name: s?.name || initialName || '', gender: s?.gender || '', whatsapp: s?.whatsapp || '', associateId: s?.associate?.id || '',
    faculty: s?.faculty || '', course: s?.course || '', theme: s?.theme || '', entryDate: s ? s.entryDate?.slice(0, 10) || '' : today(),
    currentPhase: s?.currentPhase ? String(s.currentPhase) : '', lastActivityAt: s?.lastActivityAt?.slice(0, 10) || '', notes: s?.notes || '',
    project: s?.project || '', origin: s?.origin || '', totalValue: s ? String(s.totalValue) : '', installments: s?.installments ? String(s.installments) : '',
    nextDueDate: s?.nextDueDate?.slice(0, 10) || '', completedAt: s?.completedAt?.slice(0, 10) || '',
    packageTier: s?.packageTier || '', defenseAssociateId: s?.defenseAssociate?.id || '',
  });
  const [ledger, setLedger] = useState(s ? s.ledgerBalance : true);
  const [openingPaid, setOpening] = useState(s ? String(s.openingPaid || 0) : '0');
  const [sellerCredit, setCredit] = useState(s ? (s.sellerCredit ?? !!s.entryDate) : false);
  const phaseList = usePhases() || [];
  const orphan = !!s?.currentPhase && !phaseList.some((p) => p.id === s.currentPhase);
  const [phases, setPhases] = useState<Student['phases']>(s?.phases || {});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const setPhase = (n: number, k: 'status' | 'date', v: string) => setPhases((p) => {
    const cur = { ...(p[n] || {}) };
    if (v) cur[k] = v; else delete cur[k];
    const next = { ...p };
    if (Object.keys(cur).length) next[n] = cur; else delete next[n];
    return next;
  });
  const input = (k: keyof typeof f, type = 'text') => <input className="input-base" type={type} value={f[k]} onChange={(e) => set(k, e.target.value)} />;
  const save = async () => {
    if (!f.name.trim()) { toast.error('Indica o nome'); return; }
    setBusy(true);
    try {
      // A fase so vai se mudou aqui, com a de origem: assim nao apaga uma mudanca feita no quadro.
      const { currentPhase, completedAt, ...rest } = f;
      const origPhase = s?.currentPhase ? String(s.currentPhase) : '';
      const phaseBody = !s ? { currentPhase } : currentPhase !== origPhase ? { currentPhase, currentPhaseFrom: origPhase } : {};
      // A data de conclusao so vai se mudou: vazia, o CRM preenche quando a ultima fase fica "Entregue".
      const doneBody = completedAt !== (s?.completedAt?.slice(0, 10) || '') ? { completedAt: completedAt || null } : {};
      if (s && ledger && !s.ledgerBalance && !window.confirm(`O valor pago de ${s.name} fica igual (${mzn(s.paidAmount)}): o que não está nos lançamentos fica como "pago antes". Daqui para a frente o saldo actualiza sozinho e a parte da defesa conta só para pagamentos a partir de hoje. Continuar?`)) { setBusy(false); return; }
      const openingBody = s && s.ledgerBalance && ledger && Number(openingPaid) !== s.openingPaid ? { openingPaid: Number(openingPaid) || 0 } : {};
      const body = { ...openingBody, ...rest, ...phaseBody, ...doneBody, associateId: f.associateId || null, defenseAssociateId: f.defenseAssociateId || null, packageTier: f.packageTier || null, ledgerBalance: ledger, phases, sellerCredit };
      let created: Student | undefined;
      if (s) await api.patch(`/finance/students/${s.id}`, body);
      else created = (await api.post('/finance/students', body)).data;
      toast.success('Guardado');
      onSaved(created);
      onClose();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={s ? `Estudante ${s.code}` : 'Novo estudante'} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div className="sm:col-span-2"><Field label="Nome">{input('name')}</Field></div>
          <Field label="Género">{input('gender')}</Field>
          <Field label="WhatsApp">{input('whatsapp')}</Field>
          <Field label="Associado">
            <select className="input-base" value={f.associateId} onChange={(e) => set('associateId', e.target.value)}>
              <option value="">Sem associado</option>{associates.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </Field>
          <Field label="Data de entrada">{input('entryDate', 'date')}</Field>
          <Field label="Faculdade">{input('faculty')}</Field>
          <Field label="Curso">{input('course')}</Field>
          <Field label="Última actividade">{input('lastActivityAt', 'date')}</Field>
          <div className="sm:col-span-3"><Field label="Tema do TCC">{input('theme')}</Field></div>
          <label className="sm:col-span-3 flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={sellerCredit} onChange={(e) => setCredit(e.target.checked)} />
            Venda de {creditName} (recebe {mzn(creditValue)} no mês de entrada)
          </label>
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-2">Parcelamento</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Field label="Projecto">
              <select className="input-base" value={f.project} onChange={(e) => set('project', e.target.value)}>
                <option value="">Escolher</option>{[...new Set([...PROJECTS, ...(f.project ? [f.project] : [])])].map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Origem">
              <select className="input-base" value={f.origin} onChange={(e) => set('origin', e.target.value)}>
                <option value="">Escolher</option>{[...new Set([...ORIGINS, ...(f.origin ? [f.origin] : [])])].map((p) => <option key={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="Valor total">{input('totalValue', 'number')}</Field>
            <Field label="Nº de parcelas">{input('installments', 'number')}</Field>
            <Field label="Próxima parcela">{input('nextDueDate', 'date')}</Field>
            <Field label="Pacote">
              <select className="input-base" value={f.packageTier} onChange={(e) => set('packageTier', e.target.value)}>
                <option value="">Sem pacote</option>{PACKAGE_TIERS.map((t) => <option key={t}>{t}</option>)}
              </select>
            </Field>
            <div className="col-span-2">
              <Field label="Associado de defesa">
                <select className="input-base" value={f.defenseAssociateId} onChange={(e) => set('defenseAssociateId', e.target.value)}>
                  <option value="">Sem associado de defesa</option>{associates.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                </select>
              </Field>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer mt-2">
            <input type="checkbox" checked={ledger} onChange={(e) => setLedger(e.target.checked)} />
            Saldo pelos lançamentos (o valor pago e as parcelas vêm dos pagamentos ligados a este estudante)
          </label>
          {s?.ledgerBalance && ledger && (s.openingPaid > 0 || s.ledgerSince) && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 items-end">
              <Field label="Pago antes dos lançamentos"><input className="input-base" type="number" min={0} value={openingPaid} onChange={(e) => setOpening(e.target.value)} /></Field>
              <p className="sm:col-span-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                Veio da planilha e não está nos lançamentos ligados. Valor pago = este valor + os lançamentos.
                {s.ledgerSince && ` A parte da defesa conta para pagamentos desde ${dateLabel(s.ledgerSince)}.`}
              </p>
            </div>
          )}
          {(() => {
            const total = Number(f.totalValue) || 0;
            const share = ledger && f.packageTier && f.defenseAssociateId ? Math.min(shares[f.packageTier] || 0, total) : 0;
            const who = associates.find((a) => a.id === f.defenseAssociateId)?.name;
            if (share > 0) return <p className="text-xs mt-1 p-2 rounded" style={{ background: 'var(--surface-2)' }}>Depois de pagos <b>{mzn(total - share)}</b>, os últimos <b>{mzn(share)}</b> contam para a defesa: a comissão dessa parte vai para <b>{who}</b>.</p>;
            if (f.packageTier && f.defenseAssociateId && !ledger) return <p className="text-xs mt-1" style={{ color: '#F59E0B' }}>A parte da defesa só é calculada com "Saldo pelos lançamentos" ligado.</p>;
            return null;
          })()}
        </div>
        <div>
          <h4 className="text-sm font-semibold mb-2">Fases do Método M.E.T.A.</h4>
          <div className="mb-2 grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg">
            <Field label="Fase actual">
              <select className="input-base" value={f.currentPhase} onChange={(e) => set('currentPhase', e.target.value)}>
                <option value="">Sem fase</option>
                {orphan && <option value={String(s!.currentPhase)}>Fase removida</option>}
                {phaseList.map((p, i) => <option key={p.id} value={String(p.id)}>F{i + 1} · {p.name}</option>)}
              </select>
            </Field>
            <Field label="Trabalho concluído em">{input('completedAt', 'date')}</Field>
          </div>
          <p className="text-[11px] mb-2" style={{ color: 'var(--text-muted)' }}>Fica preenchido sozinho quando a última fase passa a "Entregue". Pode ser posto à mão (ex.: Simulação, Revisão).</p>
          <div className="space-y-1.5">
            {phaseList.map((p, i) => (
              <div key={p.id} className="grid grid-cols-[1fr_130px_140px] gap-2 items-center">
                <span className="text-xs truncate">F{i + 1} · {p.name}</span>
                <select className="input-base" style={inputSm} value={phases[p.id]?.status || ''} onChange={(e) => setPhase(p.id, 'status', e.target.value)}>
                  <option value="">—</option>{PHASE_STATES.map((st) => <option key={st}>{st}</option>)}
                </select>
                <input className="input-base" style={inputSm} type="date" value={phases[p.id]?.date || ''} onChange={(e) => setPhase(p.id, 'date', e.target.value)} />
              </div>
            ))}
          </div>
        </div>
        <Field label="Notas"><textarea className="input-base" rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
        <button className="btn btn-primary w-full justify-center" disabled={busy} onClick={save}>Guardar</button>
      </div>
    </Modal>
  );
}

function PaymentModal({ student, associates, rate, shares, onClose, onSaved }: { student: Student; associates: Associate[]; rate: number; shares: Record<string, number>; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState('');
  const [paymentMethod, setMethod] = useState('');
  const [associateId, setAssociate] = useState(student.associate?.id || '');
  const [nextDueDate, setNext] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const value = Number(amount) || 0;
  const save = async () => {
    if (!value) { toast.error('Indica o valor'); return; }
    if (!paymentMethod) { toast.error('Escolhe a forma de pagamento'); return; }
    setBusy(true);
    try {
      await api.post(`/finance/students/${student.id}/payments`, { date, amount, paymentMethod, associateId: associateId || null, nextDueDate: nextDueDate || null, notes });
      toast.success('Pagamento registado');
      onSaved();
      onClose();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Pagamento de ${student.name}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Saldo: <b>{mzn(student.balance)}</b> · Parcelas pagas: {student.installmentsPaid}/{student.installments ?? '—'}</p>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Data do pagamento"><input className="input-base" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Valor (MZN)"><input className="input-base" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Forma de pagamento">
            <select className="input-base" value={paymentMethod} onChange={(e) => setMethod(e.target.value)}>
              <option value="">Escolher</option>{WALLETS.map((w) => <option key={w} value={w}>{w === 'Fisico' ? 'Físico' : w}</option>)}
            </select>
          </Field>
          <Field label="Comissionista">
            <select className="input-base" value={associateId} onChange={(e) => setAssociate(e.target.value)}>
              <option value="">Sem comissão</option>{associates.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Próxima parcela"><input className="input-base" type="date" value={nextDueDate} onChange={(e) => setNext(e.target.value)} /></Field>
          <Field label="Observação"><input className="input-base" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Automática" /></Field>
        </div>
        {value > 0 && date.length === 10 && <SplitPreview student={student} value={value} rate={rate} shares={shares} associateName={associates.find((a) => a.id === associateId)?.name || null} period={date.slice(0, 7)} />}
        <button className="btn btn-primary w-full justify-center" disabled={busy} onClick={save}>Registar pagamento</button>
      </div>
    </Modal>
  );
}

// Mostra para quem vai a comissao deste pagamento (normal e, na parte final do pacote, defesa).
export function SplitPreview({ student, value, rate, shares, associateName, period }: {
  student: Pick<Student, 'packageTier' | 'ledgerBalance' | 'defenseAssociate' | 'totalValue' | 'paidAmount'>; value: number; rate: number;
  shares: Record<string, number>; associateName: string | null; period: string;
}) {
  const d = defensePart(student.totalValue, studentShare(student, shares), student.paidAmount, value);
  const main = value - d;
  if (!associateName && !d) return null;
  return (
    <p className="text-xs p-2 rounded" style={{ background: 'var(--surface-2)' }}>
      {associateName && main > 0 && <>A comissão de <b>{mzn(main * rate)}</b> ({Math.round(rate * 100)}%) vai para <b>{associateName}</b>. </>}
      {d > 0 && <><b>{mzn(d)}</b> deste pagamento já é da parte da defesa: <b>{mzn(d * rate)}</b> vão para <b>{student.defenseAssociate?.name}</b>. </>}
      Entra no salário de <b>{monthLabel(period)}</b>.
    </p>
  );
}

type ConvertRow = { id: string; code: string; name: string; paidAmount: number; linked: number; openingPaid: number; packageTier: string | null };

// Passa os estudantes antigos para o saldo pelos lancamentos sem mudar o valor pago.
function ConvertModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [since, setSince] = useState(today());
  const [r, setR] = useState<{ ready: ConvertRow[]; review: ConvertRow[] } | null>(null);
  const [busy, setBusy] = useState(false);
  // "linked": o valor pago passa a ser o que esta nos lancamentos. "sheet": fica o da ficha (diferenca = "pago antes").
  const [mode, setMode] = useState<'linked' | 'sheet'>('linked');
  // Grupo a ver e a passar no modo "Nos lancamentos".
  const [group, setGroup] = useState<'same' | 'more' | 'less'>('same');
  // Modo "ficha": "a rever" marcados passam a usar os lancamentos.
  const [useLinked, setUseLinked] = useState<Set<string>>(new Set());
  const toggle = (id: string, on: boolean) => setUseLinked((p) => { const n = new Set(p); if (on) n.add(id); else n.delete(id); return n; });
  useEffect(() => {
    api.post('/finance/students/ledger-convert', { apply: false }, { timeout: 120000 }).then(({ data }) => setR(data))
      .catch((e) => { toast.error(errMsg(e)); onClose(); });
  }, [onClose]);
  const all = useMemo(() => (r ? [...r.ready, ...r.review].sort((x, y) => y.code.localeCompare(x.code, undefined, { numeric: true })) : []), [r]);
  const diff = (x: ConvertRow) => Math.round((x.linked - x.paidAmount) * 100) / 100;
  const less = all.filter((x) => diff(x) < 0);
  const more = all.filter((x) => diff(x) > 0);
  const same = all.filter((x) => diff(x) === 0);
  const groupRows = group === 'same' ? same : group === 'more' ? more : less;
  const groupName = group === 'same' ? 'iguais à ficha' : group === 'more' ? 'que ficam com mais' : 'que ficam com menos';
  const total = !r ? 0 : mode === 'linked' ? groupRows.length : r.ready.length + useLinked.size;
  const apply = async () => {
    const msg = mode === 'linked'
      ? `Passar os ${total} estudantes ${groupName}? O valor pago de cada um passa a ser o que está nos lançamentos.${group === 'less' ? '\n\nATENÇÃO: estes ficam com menos pago do que na ficha.' : ''}`
      : `Passar ${total} estudantes? O valor pago de cada um fica igual ao da ficha${useLinked.size ? ` (e ${useLinked.size} dos "a rever" passam a usar os lançamentos)` : ''}.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      const body = mode === 'linked' ? { apply: true, since, mode: 'linked', ids: groupRows.map((x) => x.id) } : { apply: true, since, useLinked: [...useLinked] };
      const { data } = await api.post('/finance/students/ledger-convert', body, { timeout: 600000 });
      toast.success(`${mode === 'linked' ? data.fromLinked : data.ready.length + data.fromLinked} estudantes passaram para o saldo pelos lançamentos`);
      onSaved();
      if (mode === 'sheet') { onClose(); return; }
      // Fica aberta para passar o grupo seguinte.
      const { data: fresh } = await api.post('/finance/students/ledger-convert', { apply: false }, { timeout: 120000 });
      setR(fresh);
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const sheetTable = (rows: ConvertRow[], pick = false) => (
    <table className="w-full">
      <thead><tr>{pick && <Th />}<Th>ID</Th><Th>Estudante</Th><Th>Pacote</Th><Th right>Valor pago</Th><Th right>Nos lançamentos</Th><Th right>Pago antes</Th></tr></thead>
      <tbody>{rows.map((x) => (
        <tr key={x.id}>
          {pick && <Td><input type="checkbox" aria-label={`Usar os lançamentos de ${x.name}`} checked={useLinked.has(x.id)} onChange={(e) => toggle(x.id, e.target.checked)} /></Td>}
          <Td>{x.code}</Td><Td bold>{x.name}</Td><Td>{x.packageTier || '—'}</Td><Td right>{num(x.paidAmount)}</Td><Td right>{num(x.linked)}</Td><Td right>{num(x.openingPaid)}</Td></tr>
      ))}</tbody>
    </table>
  );
  return (
    <Modal title="Estudantes antigos: saldo pelos lançamentos" onClose={onClose} wide>
      {!r ? <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" /></div> : (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Depois disto, cada pagamento novo actualiza o saldo sozinho. Convém carregar primeiro em "Ligar aos lançamentos".
          </p>
          <div className="space-y-1">
            <span className="text-xs font-semibold">Valor pago de cada estudante</span>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="radio" name="convert-mode" checked={mode === 'linked'} onChange={() => setMode('linked')} className="mt-1" />
              <span><b>Nos lançamentos</b>: o valor pago passa a ser a soma dos pagamentos ligados ao estudante.</span>
            </label>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="radio" name="convert-mode" checked={mode === 'sheet'} onChange={() => setMode('sheet')} className="mt-1" />
              <span><b>O da ficha</b>: fica o valor da planilha; o que não está nos lançamentos fica como "pago antes".</span>
            </label>
          </div>
          <div className="max-w-xs">
            <Field label="A parte da defesa conta para pagamentos desde">
              <input className="input-base" type="date" value={since} onChange={(e) => setSince(e.target.value)} />
            </Field>
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>Os pagamentos anteriores ficam com a comissão que já tinham (salários já pagos não mudam).</p>
          </div>
          {mode === 'linked' ? (
            <>
              <p className="text-sm">
                <b>{all.length}</b> estudantes · <b>{all.length - less.length - more.length}</b> iguais à ficha · <b>{more.length}</b> ficam com mais ·{' '}
                <b style={{ color: less.length ? '#EF4444' : undefined }}>{less.length}</b> ficam com menos
              </p>
              {less.length > 0 && (
                <p className="text-xs" style={{ color: '#F59E0B' }}>
                  Os que ficam com menos têm na ficha pagamentos que não estão ligados nos lançamentos. Se forem pagamentos reais, liga-os primeiro (ou lança-os); senão o saldo deles sobe.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {([['same', 'Iguais', same.length], ['more', 'Ficam com mais', more.length], ['less', 'Ficam com menos', less.length]] as const).map(([k, label, n]) => (
                  <button key={k} className={`btn ${group === k ? 'btn-primary' : 'btn-outline'}`} style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setGroup(k)}>{label} ({n})</button>
                ))}
              </div>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table className="w-full">
                  <thead><tr><Th>ID</Th><Th>Estudante</Th><Th>Pacote</Th><Th right>Na ficha</Th><Th right>Nos lançamentos (fica)</Th><Th right>Diferença</Th></tr></thead>
                  <tbody>{groupRows.map((x) => {
                    const d = diff(x);
                    return (
                      <tr key={x.id}>
                        <Td>{x.code}</Td><Td bold>{x.name}</Td><Td>{x.packageTier || '—'}</Td><Td right>{num(x.paidAmount)}</Td>
                        <Td right bold>{num(x.linked)}</Td><Td right color={d < 0 ? '#EF4444' : d > 0 ? '#10B981' : undefined}>{d > 0 ? '+' : ''}{num(d)}</Td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm"><b>{r.ready.length}</b> prontos · <b style={{ color: r.review.length ? '#F59E0B' : undefined }}>{r.review.length}</b> a rever</p>
              {r.ready.length > 0 && <div style={{ maxHeight: 260, overflowY: 'auto' }}>{sheetTable(r.ready)}</div>}
              {r.review.length > 0 && (
                <>
                  <h4 className="text-sm font-semibold">A rever: os lançamentos ligados somam mais do que o valor pago da ficha</h4>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Os que marcares passam a ter o valor pago igual à soma dos lançamentos. Os não marcados ficam como estão.{' '}
                    <button className="underline" onClick={() => setUseLinked(new Set(r.review.filter((x) => !x.paidAmount).map((x) => x.id)))}>
                      Marcar os que têm valor pago 0 ({r.review.filter((x) => !x.paidAmount).length})
                    </button>
                    {useLinked.size > 0 && <> · <button className="underline" onClick={() => setUseLinked(new Set())}>desmarcar todos</button></>}
                  </p>
                  <div style={{ maxHeight: 160, overflowY: 'auto' }}>{sheetTable(r.review, true)}</div>
                </>
              )}
            </>
          )}
          <button className="btn btn-primary w-full justify-center" disabled={busy || !total || since.length !== 10} onClick={apply}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Passar {total} estudantes{mode === 'linked' ? ` ${groupName}` : ''}
          </button>
        </div>
      )}
    </Modal>
  );
}

type LinkResult = {
  applied: boolean; payments: number; alreadyLinked: number; newLinks: number;
  associateChanges: { code: string; name: string; from: string | null; to: string | null }[];
  unmatched: { id: string; period: string; description: string | null; revenue: number; commissionist: string | null }[];
  ambiguous: { id: string; period: string; description: string | null; revenue: number; commissionist: string | null; candidates: string[] }[];
};

function LinkModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [r, setR] = useState<LinkResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'changes' | 'unmatched' | 'ambiguous'>('changes');
  useEffect(() => {
    api.post('/finance/students/link', { apply: false }).then(({ data }) => setR(data))
      .catch((e) => { toast.error(errMsg(e)); onClose(); });
  }, [onClose]);
  const apply = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/finance/students/link', { apply: true });
      toast.success(`${data.newLinks} pagamentos ligados · ${data.associateChanges.length} associados acertados`);
      onSaved();
      onClose();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const tabs: [typeof tab, string, number][] = r ? [
    ['changes', 'Associados que mudam', r.associateChanges.length],
    ['unmatched', 'Pagamentos sem estudante', r.unmatched.length],
    ['ambiguous', 'Nomes repetidos', r.ambiguous.length],
  ] : [];
  return (
    <Modal title="Ligar estudantes aos lançamentos" onClose={onClose} wide>
      {!r ? <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" /></div> : (
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Procura o nome do estudante em cada pagamento ("Pagamento - Nome") e liga-o à ficha. O associado do estudante passa a ser o comissionista do pagamento mais recente.
          </p>
          <p className="text-sm">
            {r.payments} pagamentos · {r.alreadyLinked} já ligados · <b>{r.newLinks} novas ligações</b> · <b>{r.associateChanges.length} associados a acertar</b>
          </p>
          <div className="flex flex-wrap gap-2">
            {tabs.map(([k, label, n]) => (
              <button key={k} className={`btn ${tab === k ? 'btn-primary' : 'btn-outline'}`} style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => setTab(k)}>{label} ({n})</button>
            ))}
          </div>
          <div style={{ maxHeight: 340, overflowY: 'auto' }}>
            {tab === 'changes' ? (
              <table className="w-full">
                <thead><tr>{['ID', 'Estudante', 'Antes', 'Depois'].map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
                <tbody>{r.associateChanges.map((c) => <tr key={c.code}><Td>{c.code}</Td><Td bold>{c.name}</Td><Td>{c.from || '—'}</Td><Td>{c.to || '—'}</Td></tr>)}</tbody>
              </table>
            ) : (
              <table className="w-full">
                <thead><tr>{['Mês', 'Descrição', 'Valor', 'Comissionista', ...(tab === 'ambiguous' ? ['Possíveis'] : [])].map((h, i) => <Th key={h} right={i === 2}>{h}</Th>)}</tr></thead>
                <tbody>{(tab === 'unmatched' ? r.unmatched : r.ambiguous).map((e) => (
                  <tr key={e.id}>
                    <Td>{monthLabel(e.period)}</Td><Td>{e.description || '—'}</Td><Td right>{num(e.revenue)}</Td><Td>{e.commissionist || '—'}</Td>
                    {'candidates' in e && <Td>{(e as LinkResult['ambiguous'][number]).candidates.join(', ')}</Td>}
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
          {tab !== 'changes' && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Estes ficam por ligar. Normalmente o estudante não está registado ou o nome está escrito de outra forma. Corrija o nome na ficha do estudante ou na descrição do lançamento e volte a carregar em "Ligar aos lançamentos".
            </p>
          )}
          <button className="btn btn-primary w-full justify-center" disabled={busy || (!r.newLinks && !r.associateChanges.length)} onClick={apply}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Aplicar
          </button>
        </div>
      )}
    </Modal>
  );
}

function statusBadge(s: Student) {
  return s.status === 'Pago' ? <Badge text="Pago" tone="green" /> : <Badge text="Em aberto" tone="amber" />;
}

export default function FinanceStudents({ mode, associates, rate, canEdit, onChanged, creditName, creditValue, shares }: {
  mode: 'students' | 'installments'; associates: Associate[]; rate: number; canEdit: boolean; onChanged: () => void; creditName: string; creditValue: number;
  shares: Record<string, number>;
}) {
  const [rows, setRows] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [assoc, setAssoc] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<{ student: Student | null } | null>(null);
  const [pay, setPay] = useState<Student | null>(null);
  const [linking, setLinking] = useState(false);
  const [converting, setConverting] = useState(false);
  const closeConvert = useCallback(() => setConverting(false), []);
  const [history, setHistory] = useState<Student | null>(null);
  const phaseList = usePhases();
  const closeLink = useCallback(() => setLinking(false), []);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/finance/students').then(({ data }) => setRows(data))
      .catch((e) => toast.error(errMsg(e, 'Erro a carregar estudantes')))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);
  useEffect(() => setPage(1), [q, assoc, status, mode]);

  const nowIso = today();
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (s && !`${r.code} ${r.name} ${r.project} ${r.theme}`.toLowerCase().includes(s)) return false;
      if (assoc === '__none__' ? r.associate : assoc && r.associate?.id !== assoc) return false;
      if (status === 'overdue') return r.status !== 'Pago' && !!r.nextDueDate && r.nextDueDate.slice(0, 10) < nowIso;
      if (status && r.status !== status) return false;
      return true;
    });
  }, [rows, q, assoc, status, nowIso]);
  const totals = useMemo(() => filtered.reduce((a, r) => ({ total: a.total + r.totalValue, paid: a.paid + r.paidAmount, balance: a.balance + (r.status === 'Pago' ? 0 : r.balance) }), { total: 0, paid: 0, balance: 0 }), [filtered]);
  const shown = filtered.slice((page - 1) * PAGE, page * PAGE);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));

  const changed = () => { load(); onChanged(); };
  // Associado de defesa e quanto da parte final ja entrou.
  const defenseCell = (r: Student) => {
    const share = studentShare(r, shares);
    if (!share) return r.defenseAssociate ? <span style={{ color: 'var(--text-muted)' }}>{r.defenseAssociate.name}</span> : '—';
    const inPart = Math.max(0, Math.min(r.paidAmount, r.totalValue) - (r.totalValue - share));
    return <span title={`A parte da defesa começa depois de ${mzn(r.totalValue - share)} pagos`}>{r.defenseAssociate!.name} · {num(inPart)}/{num(share)}</span>;
  };
  const remove = async (r: Student) => {
    if (!window.confirm(`Eliminar o estudante ${r.code} (${r.name})? Os lançamentos ficam, mas deixam de estar ligados a ele.`)) return;
    try {
      await api.delete(`/finance/students/${r.id}`);
      toast.success('Eliminado');
      changed();
    } catch (e) { toast.error(errMsg(e)); }
  };

  const actions = (r: Student) => (
    <span className="flex gap-2">
      <button onClick={() => setHistory(r)} title="Histórico: revisões, questões, correcções, defesas" aria-label="Histórico"><History size={14} style={{ color: 'var(--primary)' }} /></button>
      {canEdit && (
        <>
          <button onClick={() => setPay(r)} title="Registar pagamento" aria-label="Registar pagamento"><Banknote size={14} style={{ color: '#10B981' }} /></button>
          <button onClick={() => setEdit({ student: r })} aria-label="Editar"><Pencil size={13} /></button>
          <button onClick={() => remove(r)} aria-label="Eliminar"><Trash2 size={13} style={{ color: '#EF4444' }} /></button>
        </>
      )}
    </span>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-2" style={{ color: 'var(--text-muted)' }} />
          <input className="input-base" style={{ ...inputSm, paddingLeft: 26, width: 220 }} placeholder="Nome, ID, projecto..." value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input-base" style={{ ...inputSm, width: 'auto' }} value={assoc} onChange={(e) => setAssoc(e.target.value)}>
          <option value="">Todos os associados</option><option value="__none__">Sem associado</option>
          {associates.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
        </select>
        <select className="input-base" style={{ ...inputSm, width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Todos os estados</option><option>Em aberto</option><option>Pago</option><option value="overdue">Parcela em atraso</option>
        </select>
        {canEdit && mode === 'students' && <button className="btn btn-outline ml-auto" onClick={() => setLinking(true)}><Link2 size={14} /> Ligar aos lançamentos</button>}
        {canEdit && mode === 'students' && rows.some((x) => !x.ledgerBalance) && (
          <button className="btn btn-outline" onClick={() => setConverting(true)} title="Passar os estudantes antigos para o saldo pelos lançamentos"><RefreshCw size={14} /> Saldo automático nos antigos</button>
        )}
        {canEdit && <button className={`btn btn-primary ${mode === 'students' ? '' : 'ml-auto'}`} onClick={() => setEdit({ student: null })}><Plus size={14} /> Novo estudante</button>}
      </div>
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
        {filtered.length} estudantes · Contratado {mzn(totals.total)} · Pago {mzn(totals.paid)} · <b>Por receber {mzn(totals.balance)}</b>
      </p>
      <div className="card p-4 overflow-x-auto">
        {loading ? <div className="flex justify-center py-8"><Loader2 size={18} className="animate-spin" /></div> : mode === 'students' ? (
          <table className="w-full">
            <thead><tr>{['ID', 'Nome', 'Associado', 'Projecto', 'Entrada', 'Fase', 'Valor total', 'Pago', 'Saldo', 'Estado', ''].map((h, i) => <Th key={i} right={[6, 7, 8].includes(i)}>{h}</Th>)}</tr></thead>
            <tbody>{shown.map((r) => (
              <tr key={r.id}>
                <Td>{r.code}</Td><Td bold>{r.name}</Td><Td>{r.associate?.name || '—'}</Td><Td>{r.project || '—'}</Td><Td>{dateLabel(r.entryDate)}</Td>
                <Td>{phaseLabel(phaseList, r.currentPhase, true)}</Td><Td right>{num(r.totalValue)}</Td><Td right>{num(r.paidAmount)}</Td><Td right>{num(r.balance)}</Td>
                <Td>{statusBadge(r)}</Td><Td>{actions(r)}</Td>
              </tr>
            ))}</tbody>
          </table>
        ) : (
          <table className="w-full">
            <thead><tr>{['ID', 'Cliente', 'Projecto', 'Pacote', 'Valor total', 'Parcelas', 'Pagas', 'Valor pago', 'Saldo', 'Defesa', 'Entrada', 'Próxima parcela', 'Estado', ''].map((h, i) => <Th key={i} right={[4, 5, 6, 7, 8].includes(i)}>{h}</Th>)}</tr></thead>
            <tbody>{shown.map((r) => {
              const late = r.status !== 'Pago' && !!r.nextDueDate && r.nextDueDate.slice(0, 10) < nowIso;
              return (
                <tr key={r.id}>
                  <Td>{r.code}</Td><Td bold>{r.name}</Td><Td>{r.project || '—'}</Td><Td>{r.packageTier || '—'}</Td><Td right>{num(r.totalValue)}</Td>
                  <Td right>{r.installments ?? '—'}</Td><Td right>{r.installmentsPaid}</Td><Td right>{num(r.paidAmount)}</Td><Td right>{num(r.balance)}</Td>
                  <Td>{defenseCell(r)}</Td>
                  <Td>{dateLabel(r.entryDate)}</Td><Td color={late ? '#EF4444' : undefined}>{dateLabel(r.nextDueDate)}</Td><Td>{statusBadge(r)}</Td><Td>{actions(r)}</Td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
        {!loading && filtered.length === 0 && <p className="text-center text-sm py-6" style={{ color: 'var(--text-muted)' }}>Sem estudantes</p>}
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button className="btn" disabled={page === 1} onClick={() => setPage(page - 1)}>Anterior</button>
          <span>Página {page} de {pages}</span>
          <button className="btn" disabled={page === pages} onClick={() => setPage(page + 1)}>Seguinte</button>
        </div>
      )}
      {edit && <StudentModal student={edit.student} associates={associates} creditName={creditName} creditValue={creditValue} shares={shares} onClose={() => setEdit(null)} onSaved={changed} />}
      {linking && <LinkModal onClose={closeLink} onSaved={changed} />}
      {converting && <ConvertModal onClose={closeConvert} onSaved={changed} />}
      {history && <StudentHistoryModal student={history} onClose={() => setHistory(null)} />}
      {pay && <PaymentModal student={pay} associates={associates} rate={rate} shares={shares} onClose={() => setPay(null)} onSaved={changed} />}
    </div>
  );
}
