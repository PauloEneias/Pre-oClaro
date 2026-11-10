/**
 * Ilustração SVG incorporada: não usa arquivo externo e não desaparece se
 * a pasta public/visuals for movida. Os outros elementos da hero são HTML.
 */
export default function OliveArtwork() {
  return (
    <svg className="olive-artwork" viewBox="0 0 740 600" fill="none" role="presentation" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="pcBase" x1="80" y1="20" x2="650" y2="532" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1a2b15"/>
          <stop offset=".25" stopColor="#435a27"/>
          <stop offset=".49" stopColor="#9fae77"/>
          <stop offset=".68" stopColor="#546d39"/>
          <stop offset="1" stopColor="#263a1d"/>
        </linearGradient>
        <linearGradient id="pcFoldOne" x1="580" y1="77" x2="162" y2="354" gradientUnits="userSpaceOnUse">
          <stop stopColor="#d1d7b0"/>
          <stop offset=".32" stopColor="#aab892"/>
          <stop offset=".62" stopColor="#5f784b"/>
          <stop offset="1" stopColor="#223a1b"/>
        </linearGradient>
        <linearGradient id="pcFoldTwo" x1="110" y1="287" x2="550" y2="501" gradientUnits="userSpaceOnUse">
          <stop stopColor="#263c1d"/>
          <stop offset=".29" stopColor="#718954"/>
          <stop offset=".63" stopColor="#c7d0a9"/>
          <stop offset="1" stopColor="#778f57"/>
        </linearGradient>
        <linearGradient id="pcBottom" x1="580" y1="250" x2="287" y2="568" gradientUnits="userSpaceOnUse">
          <stop stopColor="#d5dcb6"/>
          <stop offset=".48" stopColor="#9eb27a"/>
          <stop offset="1" stopColor="#4e6634"/>
        </linearGradient>
        <filter id="pcGrain" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency=".08" numOctaves="2" seed="7" result="grain"/>
          <feColorMatrix in="grain" type="saturate" values="0"/>
          <feComponentTransfer><feFuncA type="linear" slope=".075"/></feComponentTransfer>
        </filter>
        <clipPath id="pcLeafClip"><path d="M159 115C275 36 417 26 558 58C671 83 666 167 629 255C588 354 528 447 419 523C320 586 258 561 191 489C100 385 75 230 159 115Z"/></clipPath>
      </defs>
      <path d="M159 115C275 36 417 26 558 58C671 83 666 167 629 255C588 354 528 447 419 523C320 586 258 561 191 489C100 385 75 230 159 115Z" fill="url(#pcBase)"/>
      <path d="M151 158C297 35 490 23 631 117C582 146 549 195 496 252C434 317 330 353 205 366C154 328 104 229 151 158Z" fill="url(#pcFoldOne)"/>
      <path d="M119 307C181 240 276 220 390 256C477 283 543 339 578 392C535 470 442 545 343 553C239 561 167 479 119 307Z" fill="url(#pcFoldTwo)"/>
      <path d="M206 370C315 352 413 317 489 262C550 217 591 180 621 120C664 194 632 281 593 369C549 463 482 524 373 558C296 559 224 493 206 370Z" fill="url(#pcBottom)" opacity=".96"/>
      <path d="M151 158C275 111 435 106 550 144C447 168 349 229 275 286C221 331 172 369 140 399" stroke="#f4f6e8" strokeOpacity=".26" strokeWidth="3"/>
      <path d="M171 322C326 285 442 344 550 421" stroke="#e9f0d1" strokeOpacity=".22" strokeWidth="3"/>
      <path d="M251 518C374 466 490 413 584 334" stroke="#f5f6e1" strokeOpacity=".24" strokeWidth="2.5"/>
      <g clipPath="url(#pcLeafClip)"><rect width="740" height="600" filter="url(#pcGrain)" opacity=".4"/></g>
    </svg>
  );
}
