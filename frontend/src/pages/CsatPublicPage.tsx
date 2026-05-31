import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Star, Check, Loader2 } from 'lucide-react';

const API_BASE = (import.meta.env as any).VITE_API_URL || '';

export default function CsatPublicPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [request, setRequest] = useState<{ id: string; question: string; score: number | null; respondedAt: string | null } | null>(null);
  const [score, setScore] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/api/csat-public/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.message) setError(d.message);
        else { setRequest(d); if (d.respondedAt) setSubmitted(true); }
      })
      .catch(() => setError('Erro a carregar'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async () => {
    if (!score) return;
    setSubmitting(true);
    try {
      const r = await fetch(`${API_BASE}/api/csat-public/${token}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, comment }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.message || 'Erro'); return; }
      setSubmitted(true);
    } catch {
      setError('Erro a submeter');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--primary)' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4" style={{ background: 'var(--surface-2)' }}>
        <div className="card p-8 max-w-md text-center">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4" style={{ background: 'var(--surface-2)' }}>
        <div className="card p-8 max-w-md text-center">
          <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: '#D1FAE5' }}>
            <Check size={28} style={{ color: '#10B981' }} />
          </div>
          <h2 className="text-xl font-bold mb-2" style={{ fontFamily: 'Manrope, sans-serif' }}>Obrigado!</h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>A tua avaliação foi recebida.</p>
        </div>
      </div>
    );
  }

  if (!request) return null;

  return (
    <div className="flex items-center justify-center min-h-screen p-4" style={{ background: 'var(--surface-2)' }}>
      <div className="card p-8 max-w-md w-full">
        <h1 className="text-xl font-bold mb-4 text-center" style={{ fontFamily: 'Manrope, sans-serif' }}>
          {request.question}
        </h1>
        <div className="flex justify-center gap-2 mb-6">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              onClick={() => setScore(n)}
              className="p-1 transition-transform hover:scale-110"
            >
              <Star
                size={36}
                fill={(hover || score) >= n ? '#F59E0B' : 'none'}
                style={{ color: (hover || score) >= n ? '#F59E0B' : '#E2E8F0' }}
              />
            </button>
          ))}
        </div>
        {score > 0 && (
          <p className="text-center text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
            {score === 1 && 'Muito mau'}
            {score === 2 && 'Mau'}
            {score === 3 && 'Razoavel'}
            {score === 4 && 'Bom'}
            {score === 5 && 'Excelente'}
          </p>
        )}
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Comentario (opcional)"
          className="input-base"
          rows={3}
        />
        <button
          onClick={handleSubmit}
          disabled={!score || submitting}
          className="btn btn-primary w-full mt-4 py-3"
          style={{ opacity: !score ? 0.5 : 1 }}
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : 'Submeter avaliação'}
        </button>
      </div>
    </div>
  );
}
