import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuthStore } from '../../store';
import { SawaMark } from '../../components/SawaLogo';
import api from '../../lib/api';
import toast from 'react-hot-toast';

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '', workspaceName: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password.length < 8) { toast.error('A palavra-passe deve ter pelo menos 8 caracteres'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/register', form);
      login(data.token, data.user, data.workspace);
      toast.success('Conta criada com sucesso!');
      navigate('/');
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Erro ao criar conta');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: 'var(--surface-2)' }}>
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-8">
          <SawaMark size={30} ringColor="#1A2E25" dotColor="#C8553D" />
          <span className="text-lg" style={{ fontFamily: 'Fraunces, serif', fontWeight: 500, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>Sawa</span>
        </div>

        <h1 className="text-2xl font-bold mb-1" style={{ fontFamily: 'Manrope, sans-serif' }}>Criar conta gratuita</h1>
        <p className="text-sm mb-8" style={{ color: 'var(--text-secondary)' }}>Configure o seu workspace em menos de 2 minutos</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {[
            { key: 'workspaceName', label: 'Nome da empresa / Workspace', placeholder: 'Ex: Minha Empresa Lda' },
            { key: 'name', label: 'O seu nome completo', placeholder: 'Ex: João Silva' },
            { key: 'email', label: 'Email profissional', placeholder: 'o-seu@email.com', type: 'email' },
          ].map(({ key, label, placeholder, type }) => (
            <div key={key}>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>{label}</label>
              <input
                type={type || 'text'}
                value={(form as any)[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                placeholder={placeholder}
                required
                className="input-base"
              />
            </div>
          ))}

          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-primary)' }}>Palavra-passe</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Mínimo 8 caracteres"
                required
                className="input-base pr-10"
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading} className="btn btn-primary w-full py-2.5" style={{ marginTop: 8 }}>
            {loading ? <Loader2 size={16} className="animate-spin" /> : null}
            {loading ? 'A criar...' : 'Criar conta'}
          </button>
        </form>

        <p className="text-xs text-center mt-4" style={{ color: 'var(--text-muted)' }}>
          Ao criar conta, aceita os nossos Termos de Serviço e Política de Privacidade.
        </p>
        <p className="text-sm text-center mt-4" style={{ color: 'var(--text-secondary)' }}>
          Já tem conta? <Link to="/login" style={{ color: 'var(--primary)', fontWeight: 500 }}>Iniciar sessão</Link>
        </p>
      </div>
    </div>
  );
}
