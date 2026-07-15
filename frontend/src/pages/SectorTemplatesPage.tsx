import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, Check, Layers, Tag as TagIcon, ListChecks, ChevronRight,
  Building2, HeartPulse, GraduationCap, Briefcase, LayoutTemplate,
} from 'lucide-react';
import api from '../lib/api';
import toast from 'react-hot-toast';

interface SectorTemplate {
  key: string;
  label: string;
  description: string;
  pipeline: string;
  stages: string[];
  fields: string[];
  tags: string[];
}

const ICONS: Record<string, any> = {
  imobiliaria: Building2,
  clinica: HeartPulse,
  escola: GraduationCap,
  consultoria: Briefcase,
};

export default function SectorTemplatesPage() {
  const [items, setItems] = useState<SectorTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/sector-templates')
      .then(({ data }) => {
        // Klaru posiciona-se como plataforma para clinicas. Filtramos os
        // outros sectores para nao poluir a UI. Se um dia voltarmos a
        // multi-vertical, remove-se este filtro.
        const clinicOnly = (data as SectorTemplate[]).filter((t) => t.key === 'clinica');
        setItems(clinicOnly);
      })
      .catch(() => toast.error('Erro ao carregar modelos'))
      .finally(() => setLoading(false));
  }, []);

  const apply = async (t: SectorTemplate) => {
    if (!confirm(`Aplicar o modelo "${t.label}"?\n\nVai criar o pipeline "${t.pipeline}", ${t.fields.length} campos personalizados e ${t.tags.length} etiquetas. Os que já existirem são ignorados.`)) return;
    setApplying(t.key);
    try {
      const { data } = await api.post(`/sector-templates/${t.key}/apply`);
      toast.success(data.message || 'Modelo aplicado');
      setTimeout(() => navigate('/pipeline'), 900);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Erro ao aplicar o modelo');
    } finally {
      setApplying(null);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'Fraunces, serif' }}>Modelos de sector</h1>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Escolhe o teu sector e o Klaru configura num clique o pipeline, os campos e as etiquetas certas para começares já.
        </p>
      </div>

      {loading ? (
        <div className="p-10 flex justify-center"><Loader2 className="animate-spin" style={{ color: 'var(--text-muted)' }} /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((t) => {
            const Icon = ICONS[t.key] || LayoutTemplate;
            return (
              <div key={t.key} className="card p-5 flex flex-col transition-shadow hover:shadow-lg">
                <div className="flex items-start gap-3.5 mb-4">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'var(--primary-light)' }}>
                    <Icon size={22} style={{ color: 'var(--primary)' }} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold leading-tight" style={{ color: 'var(--text-primary)', fontFamily: 'Fraunces, serif' }}>{t.label}</h3>
                    <p className="text-xs mt-1 leading-snug" style={{ color: 'var(--text-muted)' }}>{t.description}</p>
                  </div>
                </div>

                <div className="space-y-3.5 mb-5 flex-1">
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Layers size={13} style={{ color: 'var(--primary)' }} />
                      <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Pipeline {t.pipeline}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-y-1">
                      {t.stages.map((s, i) => (
                        <span key={i} className="inline-flex items-center">
                          <span className="px-2 py-0.5 rounded-md text-[11px] font-medium" style={{ background: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>{s}</span>
                          {i < t.stages.length - 1 && <ChevronRight size={12} className="mx-0.5 flex-shrink-0" style={{ color: 'var(--text-muted)', opacity: 0.5 }} />}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <ListChecks size={13} style={{ color: 'var(--primary)' }} />
                      <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Campos</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {t.fields.map((f, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-md text-[11px]" style={{ background: 'var(--surface-3)', color: 'var(--text-secondary)' }}>{f}</span>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <TagIcon size={13} style={{ color: 'var(--primary)' }} />
                      <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Etiquetas</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {t.tags.map((tg, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>{tg}</span>
                      ))}
                    </div>
                  </div>
                </div>

                <button className="btn btn-primary mt-auto w-full flex items-center justify-center gap-2" onClick={() => apply(t)} disabled={applying === t.key}>
                  {applying === t.key ? <Loader2 size={16} className="animate-spin" /> : <><Check size={16} /> Aplicar modelo</>}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
