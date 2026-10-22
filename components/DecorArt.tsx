import type { DecorKind } from '../lib/types';

/** Original, lightweight shelf ornaments. No external image service is needed. */
export default function DecorArt({kind,className}:{kind:DecorKind;className?:string}) {
  const common={viewBox:'0 0 120 150',className,'aria-hidden':true as const,focusable:false as const};
  if(kind==='plant')return <svg {...common}>
    <path d="M59 102C60 73 60 45 51 21M62 89C75 70 81 50 79 28M57 78C45 62 33 52 25 45" fill="none" stroke="#4e6849" strokeWidth="3" strokeLinecap="round"/>
    <path d="M53 47C29 45 24 27 31 13C51 17 59 30 53 47Z" fill="#66815c"/>
    <path d="M57 64C72 58 77 42 72 32C56 37 50 52 57 64Z" fill="#81976e"/>
    <path d="M80 52C96 45 101 28 94 17C80 21 73 36 80 52Z" fill="#536f49"/>
    <path d="M42 66C27 69 12 60 12 47C27 42 39 50 42 66Z" fill="#8a9e75"/>
    <path d="M63 82C83 85 96 77 99 63C82 58 67 64 63 82Z" fill="#6c875d"/>
    <ellipse cx="60" cy="109" rx="27" ry="7" fill="#704d37"/>
    <path d="M33 108H87L80 143Q60 151 40 143Z" fill="#bc8768"/>
    <path d="M38 113L44 141Q53 145 57 145L54 113Z" fill="#d3a184"/>
    <path d="M33 108Q60 117 87 108V115Q60 123 33 115Z" fill="#c89475"/>
  </svg>;
  if(kind==='bear')return <svg {...common}>
    <ellipse cx="60" cy="143" rx="42" ry="5" fill="#554233" opacity=".12"/>
    <ellipse cx="60" cy="105" rx="33" ry="34" fill="#b79370"/>
    <ellipse cx="60" cy="109" rx="21" ry="24" fill="#d8bea0"/>
    <ellipse cx="30" cy="100" rx="13" ry="23" fill="#ae8764" transform="rotate(20 30 100)"/>
    <ellipse cx="90" cy="100" rx="13" ry="23" fill="#b79370" transform="rotate(-20 90 100)"/>
    <ellipse cx="35" cy="131" rx="20" ry="16" fill="#b79370"/><ellipse cx="86" cy="131" rx="20" ry="16" fill="#b79370"/>
    <ellipse cx="35" cy="133" rx="11" ry="9" fill="#d8bea0"/><ellipse cx="86" cy="133" rx="11" ry="9" fill="#d8bea0"/>
    <circle cx="32" cy="43" r="17" fill="#b79370"/><circle cx="87" cy="43" r="17" fill="#b79370"/>
    <circle cx="32" cy="43" r="9" fill="#d8bea0"/><circle cx="87" cy="43" r="9" fill="#d8bea0"/>
    <ellipse cx="60" cy="63" rx="35" ry="31" fill="#c4a07a"/>
    <ellipse cx="60" cy="75" rx="16" ry="12" fill="#e0c9ad"/>
    <circle cx="46" cy="61" r="3" fill="#382d27"/><circle cx="75" cy="61" r="3" fill="#382d27"/>
    <path d="M55 71Q60 67 65 71Q64 77 60 77Q56 77 55 71Z" fill="#514035"/>
    <path d="M60 77V81M54 81Q60 86 66 81" fill="none" stroke="#71543e" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>;
  if(kind==='robot')return <svg {...common}>
    <ellipse cx="61" cy="144" rx="38" ry="4" fill="#303f36" opacity=".12"/>
    <path d="M60 33V20" stroke="#657469" strokeWidth="4"/><circle cx="60" cy="16" r="6" fill="#bc805c"/>
    <rect x="31" y="33" width="58" height="44" rx="9" fill="#93a195"/><path d="M36 35H84V42H36Z" fill="#b2bdb0"/>
    <rect x="39" y="45" width="42" height="21" rx="5" fill="#3f5145"/>
    <circle cx="50" cy="55" r="4" fill="#d5dfb1"/><circle cx="70" cy="55" r="4" fill="#d5dfb1"/>
    <path d="M52 64H68" stroke="#c4d09e" strokeWidth="2"/>
    <rect x="38" y="82" width="45" height="38" rx="6" fill="#8d9d8e"/><rect x="49" y="88" width="24" height="18" rx="2" fill="#c0cab5"/>
    <circle cx="55" cy="96" r="3" fill="#bf835d"/><path d="M61 95H68M61 99H68" stroke="#637561" strokeWidth="2"/>
    <path d="M40 91L23 103L21 119M81 91L96 102L101 115" stroke="#7b8b7e" strokeWidth="10" strokeLinecap="round"/>
    <path d="M49 121V137M72 121V137" stroke="#6d7e6f" strokeWidth="11"/>
    <rect x="36" y="136" width="24" height="9" rx="3" fill="#879787"/><rect x="66" y="136" width="24" height="9" rx="3" fill="#879787"/>
  </svg>;
  if(kind==='vase')return <svg {...common}>
    <path d="M60 93C55 64 59 38 70 16M61 78L39 39M60 63L86 38" fill="none" stroke="#8b7757" strokeWidth="2" strokeLinecap="round"/>
    <ellipse cx="69" cy="26" rx="6" ry="16" fill="#b8a384" transform="rotate(21 69 26)"/>
    <ellipse cx="39" cy="41" rx="6" ry="15" fill="#cab997" transform="rotate(-32 39 41)"/>
    <ellipse cx="84" cy="40" rx="5" ry="15" fill="#ab9777" transform="rotate(39 84 40)"/>
    <path d="M45 82H74L72 99C90 114 90 140 73 145H47C30 140 30 114 47 99Z" fill="#d5cdb9"/>
    <path d="M48 85H55L56 101C42 118 41 135 50 143H46C32 137 34 115 49 100Z" fill="#e9e2d0"/>
    <ellipse cx="60" cy="82" rx="15" ry="3" fill="#a99e87"/>
    <path d="M71 103Q87 126 74 141" fill="none" stroke="#c2b8a0" strokeWidth="3"/>
  </svg>;
  return <svg {...common}>
    <path d="M15 138H105" stroke="#9c6d4b" strokeWidth="8" strokeLinecap="round"/>
    <path d="M28 131L50 62M61 131L83 62" stroke="#bb895d" strokeWidth="13" strokeLinecap="square"/>
    <path d="M34 131L56 62M67 131L89 62" stroke="#d0a574" strokeWidth="4"/>
  </svg>;
}
