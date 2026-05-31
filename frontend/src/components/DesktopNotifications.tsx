import { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { useAuthStore } from '../store';
import { getSocket } from '../lib/socket';
import toast from 'react-hot-toast';

const PREF_KEY = 'kommo:desktop-notifications';

function loadPref(): boolean {
  try { return localStorage.getItem(PREF_KEY) === 'true'; } catch { return false; }
}

export default function DesktopNotifications() {
  const { user, workspace } = useAuthStore();
  const [enabled, setEnabled] = useState<boolean>(loadPref);
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );

  useEffect(() => {
    localStorage.setItem(PREF_KEY, String(enabled));
  }, [enabled]);

  // Conectar socket e ouvir mensagens novas
  useEffect(() => {
    if (!user || !workspace) return;
    const socket = getSocket();
    if (!socket) return;

    const onConnect = () => {
      socket.emit('join:workspace', workspace.id);
    };
    socket.on('connect', onConnect);
    if (socket.connected) onConnect();

    const onNewMessage = (msg: any) => {
      if (!enabled || permission !== 'granted') return;
      if (msg.isInternal) return;
      if (msg.direction !== 'INBOUND') return;
      if (msg.sentById === user.id) return;
      if (document.hasFocus()) return;

      const name = msg.contact ? `${msg.contact.firstName || ''} ${msg.contact.lastName || ''}`.trim() : 'Nova mensagem';
      try {
        const n = new Notification(name, {
          body: (msg.content || '').slice(0, 100),
          icon: '/favicon.svg',
          tag: `msg-${msg.contactId || msg.leadId || msg.id}`,
        });
        n.onclick = () => {
          window.focus();
          if (msg.contactId) {
            window.location.href = `/inbox`;
          }
          n.close();
        };
      } catch {}
    };

    socket.on('message:new', onNewMessage);
    return () => {
      socket.off('connect', onConnect);
      socket.off('message:new', onNewMessage);
    };
  }, [user, workspace, enabled, permission]);

  const handleToggle = async () => {
    if (typeof Notification === 'undefined') {
      toast.error('Browser não suporta notificações');
      return;
    }
    if (!enabled) {
      // Pedir permissão
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm === 'granted') {
        setEnabled(true);
        toast.success('Notificações activadas');
        // notificação de teste
        new Notification('Sawa', { body: 'Notificações activadas. Vais receber alertas de mensagens novas.' });
      } else {
        toast.error('Permissão negada. Activa nas definições do browser.');
      }
    } else {
      setEnabled(false);
      toast.success('Notificações desactivadas');
    }
  };

  const isActive = enabled && permission === 'granted';

  return (
    <button
      onClick={handleToggle}
      className="relative p-2 rounded-lg transition-colors hover:bg-gray-100"
      title={isActive ? 'Notificações activas (clica para desactivar)' : 'Activar notificações desktop'}
    >
      {isActive ? (
        <Bell size={18} style={{ color: 'var(--primary)' }} />
      ) : (
        <BellOff size={18} style={{ color: 'var(--text-secondary)' }} />
      )}
      {isActive && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full" style={{ background: '#10B981' }} />}
    </button>
  );
}
