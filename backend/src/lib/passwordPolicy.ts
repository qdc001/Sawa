// Politica minima de passwords para o Klaru.
//
// Aplica-se em /auth/register, /auth/change-password, /auth/reset-password
// e em qualquer sitio onde um humano defina uma password.
//
// Objectivo: bloquear passwords obviamente fracas ("123456", "password",
// "abc123", nome do proprio utilizador) sem tornar a UX insuportavel.
// Regras adaptadas para PT-MZ (top comuns em portugues incluidas).

// Top passwords fracas mais comuns em PT-MZ (curta lista, expandivel).
const COMMON_WEAK = new Set([
  '123456', '1234567', '12345678', '123456789', '1234567890',
  'password', 'passw0rd', 'senha', 'qwerty', 'abc123', '111111', '000000',
  'admin', 'admin123', 'letmein', 'welcome', 'monkey', 'dragon',
  'iloveyou', 'mocambique', 'mozambique', 'maputo', 'benfica', 'porto',
  'sporting', 'clinica', 'clinic', 'consulta', 'medico', 'saude',
  'test', 'teste', 'demo', 'user', 'utilizador', 'password1',
]);

export class WeakPasswordError extends Error {
  status = 400;
  constructor(message: string) { super(message); }
}

/**
 * Valida uma password. Lanca WeakPasswordError com mensagem clara se
 * nao passar. Passa em silencio se ok.
 *
 * Regras:
 *  - Minimo 10 caracteres (compromiso entre seguranca e usabilidade)
 *  - Nao pode ser uma das do top comum
 *  - Nao pode conter o email ou parte antes do @ (evita "joao@x.com" + "joao123")
 *  - Precisa de pelo menos 2 tipos de caracteres (letras, digitos, simbolos)
 */
export function validatePassword(password: string, opts: { email?: string; name?: string } = {}): void {
  if (typeof password !== 'string') throw new WeakPasswordError('Password invalida');
  const p = password;

  if (p.length < 10) {
    throw new WeakPasswordError('A password precisa de pelo menos 10 caracteres.');
  }
  if (p.length > 200) {
    throw new WeakPasswordError('A password nao pode exceder 200 caracteres.');
  }

  const lower = p.toLowerCase();
  if (COMMON_WEAK.has(lower)) {
    throw new WeakPasswordError('Esta password e demasiado comum. Escolhe algo mais dificil de adivinhar.');
  }

  // Nao pode conter o email inteiro ou a parte antes do @
  if (opts.email) {
    const emailLocal = opts.email.split('@')[0]?.toLowerCase();
    if (emailLocal && emailLocal.length >= 4 && lower.includes(emailLocal)) {
      throw new WeakPasswordError('A password nao pode conter o teu email.');
    }
  }

  // Nao pode ser o proprio nome
  if (opts.name) {
    const nameLower = opts.name.trim().toLowerCase();
    if (nameLower.length >= 4 && lower.includes(nameLower)) {
      throw new WeakPasswordError('A password nao pode conter o teu nome.');
    }
  }

  // Diversidade minima: pelo menos 2 de (minuscula, maiuscula, digito, simbolo).
  const hasLower = /[a-z]/.test(p);
  const hasUpper = /[A-Z]/.test(p);
  const hasDigit = /\d/.test(p);
  const hasSymbol = /[^a-zA-Z0-9]/.test(p);
  const kinds = [hasLower, hasUpper, hasDigit, hasSymbol].filter(Boolean).length;
  if (kinds < 2) {
    throw new WeakPasswordError('A password deve combinar pelo menos 2 tipos: letras minusculas, maiusculas, numeros ou simbolos.');
  }

  // Detectar sequencias obvias tipo "aaaaaaaaaa" ou "1111111111".
  if (/^(.)\1{9,}$/.test(p)) {
    throw new WeakPasswordError('A password nao pode ser um so caracter repetido.');
  }
}
