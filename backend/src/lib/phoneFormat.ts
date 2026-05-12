// Utilitários de normalização e formatação de números do WhatsApp.
//
// Problema: a Evolution/Baileys, na versão mais recente, entrega frequentemente
// um "LID" em vez do número real (ex: "147570999427159") quando o remetente
// usa privacidade reforçada. Estes não são números de telefone reais e ficam
// horríveis na lista de contactos.

const COUNTRY_CODES_KNOWN = ['258', '244', '351', '55', '1', '34', '33', '49', '44', '27', '254', '212', '263'];

export interface PhoneInfo {
  rawDigits: string;         // só dígitos
  isLid: boolean;            // true se parece um LID (sem código país, demasiado longo)
  countryCode: string | null;
  national: string;          // parte após código país (ou rawDigits se desconhecido)
  display: string;           // versão formatada para mostrar (ex: "+258 84 123 4567")
  fallbackName: string;      // nome a usar quando pushName está vazio
}

export function analysePhone(rawJidOrPhone: string): PhoneInfo {
  const digits = String(rawJidOrPhone || '').replace(/\D/g, '');

  // LID: tipicamente 15 dígitos, sem código país reconhecível no início,
  // ou números absurdamente longos. Os JIDs normais têm 10-13 dígitos.
  const isLid =
    !digits ||
    digits.length > 14 ||
    (digits.length >= 14 && !COUNTRY_CODES_KNOWN.some((cc) => digits.startsWith(cc)));

  if (isLid) {
    return {
      rawDigits: digits,
      isLid: true,
      countryCode: null,
      national: digits,
      display: 'Contacto WhatsApp',
      fallbackName: 'Contacto WhatsApp',
    };
  }

  // Detectar código país
  let countryCode: string | null = null;
  let national = digits;
  for (const cc of COUNTRY_CODES_KNOWN) {
    if (digits.startsWith(cc)) {
      countryCode = cc;
      national = digits.slice(cc.length);
      break;
    }
  }

  let display = digits;
  if (countryCode === '258' && national.length === 9) {
    // Moçambique: 8X XXX XXXX  (9 dígitos a seguir ao 258)
    display = `+258 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
  } else if (countryCode === '351' && national.length === 9) {
    // Portugal: 9X XXX XX XX
    display = `+351 ${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
  } else if (countryCode) {
    display = `+${countryCode} ${national}`;
  } else {
    display = `+${digits}`;
  }

  return {
    rawDigits: digits,
    isLid: false,
    countryCode,
    national,
    display,
    fallbackName: display,
  };
}

// Decide o nome a guardar no firstName de um contacto que vem do WhatsApp.
// Se há um pushName "real" (não é só o número), prefere isso. Senão usa o display formatado.
export function nameFromPushOrPhone(pushName: string | undefined | null, rawPhone: string): string {
  const info = analysePhone(rawPhone);
  const push = (pushName || '').trim();
  // Se pushName está vazio, é igual ao número ou parece um LID, usa o fallback
  if (!push) return info.fallbackName;
  const pushDigits = push.replace(/\D/g, '');
  if (pushDigits && pushDigits === info.rawDigits) return info.fallbackName;
  return push;
}
