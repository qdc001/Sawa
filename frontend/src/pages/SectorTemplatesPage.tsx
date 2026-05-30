import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2, Check, Layers, Tag as TagIcon, ListChecks,
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
      .then(({ data }) => setItems(data))
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
          Escolhe o teu sector e o Sawa configura num clique o pipeline, os campos e as etiquetas certas para começares já.
        </p>
      </div>

      {loading ? (
        <div className="p-10 flex justify-center"><Loader2 className="animate-spin" style={{ color: 'var(--text-muted)' }} /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {items.map((t) => {
            const Icon = ICONS[t.key] || LayoutTemplate;
            return (
              <div key={t.key} className="card p-5 flex flex-col">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(200,85,61,0.12)' }}>
                    <Icon size={20} style={{ color: 'var(--primary)' }} />
                  </div>
                  <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{t.label}</h3>
                </div>
                <p className="text-sm mb-3" style={{ color: 'var(--text-muted)' }}>{t.description}</p>
                <div className="space-y-2 text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
                  <div className="flex items-start gap-2">
                    <Layers size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                    <span><b>Pipeline {t.pipeline}:</b> {t.stages.join(' → ')}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <ListChecks size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                    <span><b>Campos:</b> {t.fields.join(', ')}</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <TagIcon size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
                    <span><b>Etiquetas:</b> {t.tags.join(', ')}</span>
                  </div>
                </div>
                <button className="btn btn-primary mt-auto flex items-center justify-center gap-2" onClick={() => apply(t)} disabled={applying === t.key}>
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
