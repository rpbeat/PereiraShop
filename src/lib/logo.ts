/**
 * Logótipo Pé de Chumbo: uma chuteira presa por uma grilheta a uma bola de chumbo ("Pb").
 * As cores vêm de variáveis CSS (--lg-*), por isso o mesmo desenho serve em fundo claro e escuro.
 */
export const LOGO_ICON = `<svg class="logo-icon" viewBox="0 0 168 142" aria-hidden="true" focusable="false">
  <g class="lg-chain" fill="none" stroke-width="5">
    <ellipse cx="20" cy="83" rx="9" ry="6"/>
    <ellipse cx="23" cy="97" rx="6" ry="9"/>
    <ellipse cx="33" cy="111" rx="9" ry="6"/>
    <ellipse cx="49" cy="117" rx="8" ry="5.5"/>
  </g>
  <path class="lg-sole" d="M14 66 L146 66 Q160 66 160 73 L160 76 L14 76 Q8 76 8 71 Z"/>
  <g class="lg-sole">
    <rect x="24" y="75" width="8" height="10" rx="2"/><rect x="48" y="75" width="8" height="10" rx="2"/>
    <rect x="84" y="75" width="8" height="10" rx="2"/><rect x="110" y="75" width="8" height="10" rx="2"/><rect x="134" y="75" width="8" height="9" rx="2"/>
  </g>
  <path class="lg-boot" d="M10 22 Q10 6 26 6 L56 6 Q64 6 68 14 L79 34 L134 46 Q158 51 158 62 Q158 68 148 68 L14 68 Q10 68 10 62 Z"/>
  <path class="lg-heel" d="M10 26 L32 26 L32 68 L14 68 Q10 68 10 62 Z"/>
  <g class="lg-lace" fill="none" stroke-width="4" stroke-linecap="round">
    <path d="M66 19 L55 30"/><path d="M75 30 L62 41"/><path d="M86 39 L73 49"/><path d="M99 44 L88 53"/>
    <path d="M15 9 Q32 1 56 7"/>
  </g>
  <g transform="translate(80 112)">
    <circle class="lg-ball" r="24"/>
    <text class="lg-pb" x="0" y="9" text-anchor="middle">Pb</text>
    <path class="lg-shine" d="M-15 -10 Q-10 -18 -1 -19" fill="none" stroke-width="4" stroke-linecap="round"/>
  </g>
  <g class="lg-weight" fill="none" stroke-width="3.5" stroke-linecap="round">
    <path d="M60 140 L112 140"/><path d="M110 102 L118 98"/><path d="M112 114 L122 114"/>
  </g>
</svg>`;

/** Ícone + nome (o nome é texto HTML, para usar a letra do site e ser lido por leitores de ecrã). */
export function logoHtml(nome: string, sub = ''): string {
  const esc = (v: string): string => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
  return `${LOGO_ICON}<span class="logo-txt"><span class="logo-nome">${esc(nome)}</span>${sub ? `<span class="logo-sub">${esc(sub)}</span>` : ''}</span>`;
}
