import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuthStore } from '../../store';
import { KlaruMark } from '../../components/KlaruLogo';
import api from '../../lib/api';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [needs2FA, setNeeds2FA] = useState(false);
  const [code, setCode] = useState('');
  const { login } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { email, password, code: needs2FA ? code : undefined });
      const data = res.data;
      // Resposta 206 indica que 2FA e necessario
      if (res.status === 206 || data.needs2FA) {
        setNeeds2FA(true);
        toast('Insere o código do teu autenticador', { icon: '🔐' });
        return;
      }
      login(data.token, data.user, data.workspace);
      toast.success(`Bem-vindo, ${data.user.name}!`);
      navigate('/');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Erro ao iniciar sessão');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--surface-2)' }}>
      {/* Left - Branding */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12" style={{ background: 'var(--sidebar-bg)' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'rgba(250,246,238,0.08)' }}>
            <KlaruMark size={26} ringColor="#FAF6EE" dotColor="#C8553D" />
          </div>
          <span className="text-white text-2xl" style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, letterSpacing: '-0.02em' }}>Klaru</span>
        </div>

        <div>
          <h2 className="text-4xl text-white mb-4" style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, lineHeight: 1.15 }}>
            Onde tudo<br />fica claro.
          </h2>
          <p className="text-gray-400 text-lg mb-8">CRM completo com pipeline de vendas, caixa de entrada unificada e automações inteligentes.</p>

          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Leads activos', value: '12.4k' },
              { label: 'Receita gerada', value: 'MZN 2.8M' },
              { label: 'Integracções', value: '20+' },
              { label: 'Uptime', value: '99.9%' },
            ].map((stat) => (
              <div key={stat.label} className="p-4 rounded-xl" style={{ background: 'rgba(255,255,255,0.05)' }}>
                <p className="text-2xl font-bold text-white" style={{ fontFamily: 'Manrope, sans-serif' }}>{stat.value}</p>
                <p className="text-sm text-gray-400">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-gray-600 text-sm">© 2026 Klaru. Todos os direitos reservados.</p>
      </div>

      {/* Right - Form */}
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <KlaruMark size={28} ringColor="#1A2E25" dotColor="#C8553D" />
            <span className="text-lg" style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>Klaru</span>
          </div>

          <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: 'Manrope, sans-serif', color: 'var(--text-primary)' }}>Iniciar sessão</h1>
          <p className="text-sm mb-8" style={{ color: 'var(--text-secondary)' }}>Entre na sua conta para continuar</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="o-seu@email.com"
                required
                className="input-base"
              />
            </div>

            <div>
              <div className="flex justify-between mb-1.5">
                <label className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Palavra-passe</label>
                <Link to="/forgot-password" className="text-sm" style={{ color: 'var(--primary)' }}>Esqueceu?</Link>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="input-base pr-10"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {needs2FA && (
              <div>
                <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>Código 2FA (6 digitos)</label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  required
                  autoFocus
                  className="input-base text-center"
                  style={{ letterSpacing: 4, fontSize: 18 }}
                />
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Abre a tua app autenticadora e copia o código.</p>
              </div>
            )}

            <button type="submit" disabled={loading} className="btn btn-primary w-full py-2.5" style={{ marginTop: 8 }}>
              {loading ? <Loader2 size={16} className="animate-spin" /> : null}
              {loading ? 'A entrar...' : 'Entrar'}
            </button>
          </form>

          <p className="text-sm text-center mt-6" style={{ color: 'var(--text-secondary)' }}>
            Não tem conta?{' '}
            <Link to="/register" style={{ color: 'var(--primary)', fontWeight: 500 }}>Criar conta</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
