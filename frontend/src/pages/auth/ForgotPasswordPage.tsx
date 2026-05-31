import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Loader2, ArrowLeft } from 'lucide-react';
import api from '../../lib/api';
import toast from 'react-hot-toast';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [debugLink, setDebugLink] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      setSent(true);
      if (data._debug?.link) setDebugLink(data._debug.link);
    } catch { toast.error('Erro'); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--surface-2)' }}>
      <div className="card p-8 w-full max-w-md">
        <Link to="/login" className="text-xs flex items-center gap-1 mb-4 hover:underline" style={{ color: 'var(--primary)' }}>
          <ArrowLeft size={12} /> Voltar ao login
        </Link>
        <h1 className="text-xl font-bold mb-2" style={{ fontFamily: 'Manrope, sans-serif' }}>Recuperar password</h1>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          Indica o teu email. Vamos enviar um link para definires uma nova password.
        </p>
        {sent ? (
          <div>
            <div className="p-3 rounded mb-3" style={{ background: '#D1FAE5', color: '#065F46' }}>
              <p className="text-sm font-medium">Verifica o teu email</p>
              <p className="text-xs mt-1">Se a conta existir, receberas um link valido por 1 hora.</p>
            </div>
            {debugLink && (
              <div className="p-3 rounded mt-3" style={{ background: '#FEF3C7', color: '#92400E' }}>
                <p className="text-xs font-medium mb-1">SMTP não configurado - usa este link:</p>
                <a href={debugLink} className="text-xs break-all underline">{debugLink}</a>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input-base" style={{ paddingLeft: 32 }} required />
              </div>
            </div>
            <button type="submit" disabled={loading || !email} className="btn btn-primary w-full py-2">
              {loading ? <Loader2 size={16} className="animate-spin" /> : 'Enviar link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
