// Helper para "Chamar via WhatsApp": abre WhatsApp Web ou app com o contacto
// pronto para receber uma chamada. Nao ha URL scheme oficial para iniciar
// directamente a chamada (WhatsApp Web usa WebRTC client-side), portanto
// o utilizador ainda tem de carregar no icone de telefone ou camera no
// topo do WhatsApp depois de a conversa abrir. E um clique extra face ao
// ideal, mas evita depender de APIs experimentais.
//
// O Klaru continua a receber os eventos de chamada via webhook da Evolution
// (call:offer, call:end) e regista-os automaticamente no timeline.

import toast from 'react-hot-toast';

export function cleanPhoneDigits(raw: string | null | undefined): string {
  return (raw || '').replace(/\D/g, '');
}

// Abre WhatsApp na conversa do numero indicado, para o utilizador iniciar
// chamada de voz ou video pelo icone no topo.
export function openWhatsAppForCall(rawPhone: string | null | undefined): void {
  const phone = cleanPhoneDigits(rawPhone);
  if (!phone) {
    toast.error('Contacto sem numero de telefone');
    return;
  }
  const url = `https://wa.me/${phone}`;
  window.open(url, '_blank', 'noopener,noreferrer');
  toast(
    'Abri o WhatsApp. Carrega no icone de chamada (📞 ou 📹) no topo da conversa.',
    { duration: 4500, icon: '📞' },
  );
}
