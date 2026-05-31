import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Lock, Loader2, ArrowLeft, Check } from 'lucide-react';
import api from '../../lib/api';
import toast from 'react-hot-toast';

export default function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwd !== confirm) { toast.error('Passwords não coincidem'); return; }
    if (pwd.length < 6) { toast.error('Mínimo 6 caracteres'); return; }
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword: pwd });
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err: any) { toast.error(err.response?.data?.message || 'Erro'); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--surface-2)' }}>
      <div className="card p-8 w-full max-w-md">
        <Link to="/login" className="text-xs flex items-center gap-1 mb-4 hover:underline" style={{ color: 'var(--primary)' }}>
          <ArrowLeft size={12} /> Voltar ao login
        </Link>
        {done ? (
          <div className="text-center py-4">
            <div className="w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ background: '#D1FAE5' }}>
              <Check size={28} style={{ color: '#10B981' }} />
            </div>
            <h2 className="text-lg font-bold">Password redefinida!</h2>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Vais ser redirigido para o login...</p>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-bold mb-2" style={{ fontFamily: 'Manrope, sans-serif' }}>Definir nova password</h1>
            <form onSubmit={handleSubmit} className="space-y-3 mt-4">
              <div>
                <label className="block text-sm font-medium mb-1">Nova password</label>
                <input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} className="input-base" required minLength={6} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Confirmar password</label>
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="input-base" required />
              </div>
              <button type="submit" disabled={loading} className="btn btn-primary w-full py-2">
                {loading ? <Loader2 size={16} className="animate-spin" /> : <><Lock size={14} /> Redefinir</>}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
