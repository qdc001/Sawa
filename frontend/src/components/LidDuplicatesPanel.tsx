// Contactos duplicados por LID (Integracoes > WhatsApp).
//
// A mesma pessoa pode ficar em dois contactos: o do numero (onde enviamos) e
// um "so LID" criado quando ela respondeu sem o WhatsApp revelar o numero. A
// procura junta sozinha os que a Evolution confirma e sugere os restantes
// para a equipa confirmar, um a um.
import { useState } from 'react';
import { Loader2, Users as UsersIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../lib/api';

type Option = { id: string; name: string; phone4: string; minutesBefore: number; nameMatch: boolean };
type Candidate = { id: string; name: string; firstMessage: string; firstAt: string; options: Option[] };

function ago(min: number): string {
  if (min < 60) return `${min} min antes`;
  if (min < 1440) return `${Math.round(min / 60)} h antes`;
  return `${Math.round(min / 1440)} dias antes`;
}

export default function LidDuplicatesPanel() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ lidOnly: number; autoLinked: string[]; candidates: Candidate[] } | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [merging, setMerging] = useState<string | null>(null);

  const scan = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/integrations/evolution/lid-duplicates', { params: { apply: 1 } });
      setResult(data);
      const pre: Record<string, string> = {};
      for (const c of data.candidates as Candidate[]) if (c.options[0]?.nameMatch) pre[c.id] = c.options[0].id;
      setChoice(pre);
      toast.success(data.autoLinked.length ? `${data.autoLinked.length} juntados automaticamente` : 'Procura concluída');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro a procurar duplicados');
    } finally {
      setLoading(false);
    }
  };

  const merge = async (c: Candidate) => {
    const toId = choice[c.id];
    if (!toId) return;
    const to = c.options.find((o) => o.id === toId);
    if (!window.confirm(`Juntar "${c.name}" em "${to?.name}" (…${to?.phone4})? As mensagens passam para esse contacto e o duplicado é apagado. Não se pode desfazer.`)) return;
    setMerging(c.id);
    try {
      const { data } = await api.post('/integrations/evolution/lid-merge', { pairs: [{ fromId: c.id, toId }] });
      if (data.errors?.length) throw new Error(data.errors[0]);
      toast.success(`"${c.name}" juntado`);
      setResult((r) => (r ? { ...r, candidates: r.candidates.filter((x) => x.id !== c.id) } : r));
    } catch (e: any) {
      toast.error(e.response?.data?.message || e.message || 'Erro a juntar');
    } finally {
      setMerging(null);
    }
  };

  return (
    <div className="space-y-2">
      <button onClick={scan} disabled={loading} className="btn text-xs py-1.5 w-full"
        style={{ background: 'var(--surface-3)', color: 'var(--text-primary)' }}
        title="Mesma pessoa em dois contactos (número e LID): junta os confirmados e sugere os restantes">
        {loading ? <Loader2 size={12} className="animate-spin" /> : <UsersIcon size={12} />}
        Procurar contactos duplicados
      </button>
      {result && (
        <div className="text-xs space-y-2" style={{ color: 'var(--text-secondary)' }}>
          <div>
            {result.autoLinked.length} juntados automaticamente
            {result.candidates.length ? ` · ${result.candidates.length} por confirmar` : ' · nada por confirmar'}.
          </div>
          {result.autoLinked.map((a) => <div key={a}>✓ {a}</div>)}
          {result.candidates.map((c) => (
            <div key={c.id} className="p-2 rounded-lg" style={{ border: '1px solid var(--border)' }}>
              <div className="font-medium" style={{ color: 'var(--text-primary)' }}>{c.name}</div>
              <div className="mb-1">1.ª mensagem: “{c.firstMessage}” · {new Date(c.firstAt).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
              {c.options.length === 0 && <div>Sem candidatos (deve ser um contacto novo).</div>}
              {c.options.map((o) => (
                <label key={o.id} className="flex items-center gap-1.5">
                  <input type="radio" name={`dup-${c.id}`} checked={choice[c.id] === o.id}
                    onChange={() => setChoice((s) => ({ ...s, [c.id]: o.id }))} />
                  <span>{o.name} (…{o.phone4}) · escrevemos-lhe {ago(o.minutesBefore)}{o.nameMatch ? ' · nome igual' : ''}</span>
                </label>
              ))}
              {c.options.length > 0 && (
                <button onClick={() => merge(c)} disabled={!choice[c.id] || merging === c.id}
                  className="btn btn-primary text-xs py-1 mt-1">
                  {merging === c.id ? <Loader2 size={12} className="animate-spin" /> : 'Juntar'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
