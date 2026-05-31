import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, Check, UserCheck } from 'lucide-react';
import api from '../../lib/api';
import toast from 'react-hot-toast';

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<{ name: string; email: string } | null>(null);
  const [error, setError] = useState('');
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.get(`/auth/invite/${token}`)
      .then(({ data }) => setInfo(data))
      .catch((err) => setError(err.response?.data?.message || 'Convite invalido'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwd !== confirm) { toast.error('Passwords não coincidem'); return; }
    if (pwd.length < 6) { toast.error('Mínimo 6 caracteres'); return; }
    setSubmitting(true);
    try {
      await api.post(`/auth/invite/${token}/accept`, { password: pwd });
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
    finally { setSubmitting(false); }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--surface-2)' }}>
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--primary)' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--surface-2)' }}>
        <div className="card p-8 max-w-md text-center">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{error}</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--surface-2)' }}>
        <div className="card p-8 max-w-md text-center">
          <div className="w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ background: '#D1FAE5' }}>
            <Check size={28} style={{ color: '#10B981' }} />
          </div>
          <h2 className="text-lg font-bold">Conta activada!</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Vais ser redirigido para o login...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--surface-2)' }}>
      <div className="card p-8 w-full max-w-md">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'var(--primary-light)' }}>
            <UserCheck size={20} style={{ color: 'var(--primary)' }} />
          </div>
          <div>
            <h1 className="text-lg font-bold">Bem-vindo, {info?.name}</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{info?.email}</p>
          </div>
        </div>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          Foste convidado para o Sawa. Define a tua password para acederes a conta.
        </p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <input type="password" placeholder="Nova password" value={pwd} onChange={(e) => setPwd(e.target.value)} className="input-base" required minLength={6} />
          <input type="password" placeholder="Confirmar password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="input-base" required />
          <button type="submit" disabled={submitting} className="btn btn-primary w-full py-2">
            {submitting ? <Loader2 size={16} className="animate-spin" /> : 'Activar conta'}
          </button>
        </form>
      </div>
    </div>
  );
}
