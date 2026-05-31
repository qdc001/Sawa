import { useEffect, useState } from 'react';
import { Loader2, Check, Crown } from 'lucide-react';
import api from '../lib/api';
import toast from 'react-hot-toast';

interface Limits { users: number; whatsapp: number; contacts: number; automations: number; aiMessages: number }
interface Billing {
  plan: string; planLabel: string; priceUsd: number | null;
  limits: Limits; features: string[];
  trialEndsAt: string | null; trialActive: boolean;
  isPlatformAdmin?: boolean;
  usage: { users: number; contacts: number; automations: number; whatsapp: number };
}
interface PlanDef { key: string; label: string; priceUsd: number | null; limits: Limits; features: string[] }

const fmtLimit = (n: number) => (n === -1 ? 'Ilimitado' : n.toLocaleString('pt-PT'));

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const unlimited = limit === -1;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  const over = !unlimited && used > limit;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span style={{ color: over ? '#EF4444' : 'var(--text-muted)' }}>{used.toLocaleString('pt-PT')} / {fmtLimit(limit)}</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface-3)' }}>
        <div className="h-2 rounded-full" style={{ width: unlimited ? '100%' : `${pct}%`, background: over ? '#EF4444' : unlimited ? 'var(--musgo, #2D4A3E)' : pct > 80 ? '#F59E0B' : 'var(--primary)' }} />
      </div>
    </div>
  );
}

export default function BillingPage() {
  const [data, setData] = useState<Billing | null>(null);
  const [catalog, setCatalog] = useState<PlanDef[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get('/billing/me'), api.get('/billing/catalog')])
      .then(([m, c]) => { setData(m.data); setCatalog(c.data); })
      .catch(() => toast.error('Erro ao carregar o plano'))
      .finally(() => setLoading(false));
  }, []);

  const upgrade = async (p: PlanDef) => {
    if (data?.isPlatformAdmin) {
      try {
        await api.post('/billing/set-plan', { plan: p.key });
        toast.success(`Plano definido: ${p.label}`);
        const { data: fresh } = await api.get('/billing/me');
        setData(fresh);
      } catch (e: any) {
        toast.error(e.response?.data?.message || 'Erro ao definir o plano');
      }
      return;
    }
    toast('Para mudar de plano, fala connosco. Pagamento por M-Pesa e cartão chega em breve.', { icon: 'ℹ️' });
  };

  if (loading || !data) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin" style={{ color: 'var(--text-muted)' }} /></div>;
  }

  const trialDays = data.trialEndsAt ? Math.max(0, Math.ceil((new Date(data.trialEndsAt).getTime() - Date.now()) / 86400000)) : 0;

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'Fraunces, serif' }}>Plano e uso</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>O teu plano actual, o consumo em tempo real e os pacotes disponíveis.</p>
      </div>

      {/* Plano actual + uso */}
      <div className="card p-5 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Plano actual</p>
            <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {data.planLabel}{data.priceUsd != null && <span className="text-base font-normal" style={{ color: 'var(--text-muted)' }}> · {data.priceUsd} USD/mês</span>}
            </h2>
            {data.trialActive && (
              <span className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full" style={{ background: 'rgba(229,143,101,0.2)', color: '#B45309' }}>
                Período de avaliação · termina em {trialDays} dia(s)
              </span>
            )}
          </div>
          <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'rgba(200,85,61,0.12)' }}>
            <Crown size={20} style={{ color: 'var(--primary)' }} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <UsageBar label="Utilizadores" used={data.usage.users} limit={data.limits.users} />
          <UsageBar label="Contactos" used={data.usage.contacts} limit={data.limits.contacts} />
          <UsageBar label="Automações activas" used={data.usage.automations} limit={data.limits.automations} />
          <UsageBar label="Ligações WhatsApp" used={data.usage.whatsapp} limit={data.limits.whatsapp} />
        </div>
      </div>

      {/* Pacotes */}
      <h3 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>Pacotes</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {catalog.map((p) => {
          const current = p.key === data.plan;
          return (
            <div key={p.key} className="card p-4 flex flex-col" style={{ border: current ? '2px solid var(--primary)' : undefined }}>
              <h4 className="font-bold text-lg" style={{ color: 'var(--text-primary)' }}>{p.label}</h4>
              <p className="mb-3" style={{ color: 'var(--text-primary)' }}>
                <span className="text-2xl font-bold">{p.priceUsd != null ? `${p.priceUsd}` : 'Sob'}</span>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{p.priceUsd != null ? ' USD/mês' : ' consulta'}</span>
              </p>
              <ul className="space-y-1 mb-3 text-xs flex-1" style={{ color: 'var(--text-secondary)' }}>
                {p.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5"><Check size={13} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--primary)' }} /> {f}</li>
                ))}
              </ul>
              <div className="text-[11px] mb-3 space-y-0.5" style={{ color: 'var(--text-muted)' }}>
                <div>{fmtLimit(p.limits.users)} utilizadores</div>
                <div>{fmtLimit(p.limits.contacts)} contactos</div>
                <div>{fmtLimit(p.limits.whatsapp)} ligações WhatsApp</div>
              </div>
              <button
                className={current ? 'btn' : 'btn btn-primary'}
                style={current ? { background: 'var(--surface-3)', color: 'var(--text-muted)' } : undefined}
                disabled={current}
                onClick={() => upgrade(p)}
              >
                {current ? 'Plano actual' : data.isPlatformAdmin ? 'Definir este plano' : 'Fazer upgrade'}
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-xs mt-4" style={{ color: 'var(--text-muted)' }}>
        A cobrança automática (M-Pesa, cartão) e a aplicação rígida dos limites chegam num próximo passo. Por agora os planos são geridos pela equipa Klaru.
      </p>
    </div>
  );
}
