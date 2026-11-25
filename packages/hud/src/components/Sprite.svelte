<script lang="ts">
  /** One animated glyph per resource kind. Every kind has a visible idle loop. Accent colour comes from `color`. */
  let { kind = 'other', size = 120, color = 'var(--fg-2)', state = 'idle' as 'idle' | 'active' | 'pending' | 'dim' } = $props();
  const uid = Math.random().toString(36).slice(2, 7);
</script>

<svg class="sprite {kind} {state}" width={size} height={size} viewBox="0 0 100 100" style="--c: {color}" aria-hidden="true">
  <defs>
    <radialGradient id="g-{uid}"><stop offset="0" stop-color="var(--c)" stop-opacity=".35" /><stop offset="1" stop-color="var(--c)" stop-opacity="0" /></radialGradient>
    <clipPath id="cp-{uid}"><rect x="15" y="31" width="70" height="48" rx="2" /></clipPath>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#g-{uid})" class="glow" />

  {#if kind === 'page'}
    <rect x="14" y="18" width="72" height="62" rx="6" class="fill-dark stroke" />
    <line x1="14" y1="30" x2="86" y2="30" class="stroke" />
    <circle cx="22" cy="24" r="2" class="fill" /><circle cx="29" cy="24" r="2" class="fill" /><circle cx="36" cy="24" r="2" class="fill" />
    <g clip-path="url(#cp-{uid})" class="scroll">
      {#each [0, 1, 2, 3, 4, 5] as i}
        <rect x="22" y={38 + i * 11} width={i % 3 === 0 ? 40 : i % 3 === 1 ? 56 : 30} height="4" rx="2" class="fill line" />
      {/each}
      <rect x="22" y={38 + 66} width="40" height="4" rx="2" class="fill line" />
      <rect x="22" y={38 + 77} width="56" height="4" rx="2" class="fill line" />
    </g>
    <rect x="22" y="73" width="3" height="5" class="fill cursor" />
  {:else if kind === 'component'}
    <rect x="18" y="40" width="34" height="34" rx="5" class="fill-dark stroke" />
    <rect x="40" y="26" width="34" height="34" rx="5" class="fill-dark stroke brick" />
    <rect x="30" y="56" width="26" height="22" rx="4" class="fill-dark stroke brick2" />
    <rect x="46" y="32" width="10" height="4" rx="2" class="fill glint" />
  {:else if kind === 'route'}
    <path d="M18 78 V46 A32 32 0 0 1 82 46 V78" class="stroke thick" fill="none" />
    <path d="M30 78 V48 A20 20 0 0 1 70 48 V78" class="stroke" fill="none" />
    <g class="chev">
      <path d="M36 60 l6 6 -6 6" class="stroke" fill="none" /><path d="M46 60 l6 6 -6 6" class="stroke" fill="none" /><path d="M56 60 l6 6 -6 6" class="stroke" fill="none" />
    </g>
  {:else if kind === 'middleware'}
    <path d="M50 14 L80 26 V50 C80 68 66 80 50 86 C34 80 20 68 20 50 V26 Z" class="fill-dark stroke" />
    <path d="M38 50 l9 9 16 -18" class="stroke thick draw" fill="none" />
    <circle cx="50" cy="50" r="42" class="stroke dash spin" fill="none" />
  {:else if kind === 'service'}
    <g class="spin-slow" style="transform-origin: 44px 54px">
      <circle cx="44" cy="54" r="22" class="stroke teeth" fill="none" />
      <circle cx="44" cy="54" r="13" class="fill-dark stroke" />
      <circle cx="44" cy="54" r="5" class="fill" />
    </g>
    <g class="spin-rev" style="transform-origin: 72px 32px">
      <circle cx="72" cy="32" r="11" class="stroke teeth-s" fill="none" />
      <circle cx="72" cy="32" r="5" class="fill-dark stroke" />
    </g>
  {:else if kind === 'function'}
    <path d="M50 14 L82 32 V68 L50 86 L18 68 V32 Z" class="fill-dark stroke" />
    <text x="50" y="62" text-anchor="middle" class="t pulse">ƒ</text>
    <circle cx="50" cy="50" r="40" class="orbit" fill="none" />
    <g class="orbiter" style="transform-origin: 50px 50px"><circle cx="90" cy="50" r="3" class="fill" /></g>
  {:else if kind === 'job'}
    <circle cx="50" cy="52" r="32" class="fill-dark stroke" />
    {#each [0, 45, 90, 135, 180, 225, 270, 315] as a}
      <line x1="50" y1="24" x2="50" y2="29" class="stroke" transform="rotate({a} 50 52)" />
    {/each}
    <line x1="50" y1="52" x2="50" y2="30" class="stroke thick hand" />
    <line x1="50" y1="52" x2="66" y2="52" class="stroke hand-s" />
    <circle cx="50" cy="52" r="3" class="fill" />
  {:else if kind === 'queue'}
    <rect x="12" y="62" width="76" height="6" rx="3" class="fill-dark stroke" />
    <g class="belt">
      <rect x="14" y="44" width="14" height="14" rx="3" class="fill-dark stroke" />
      <rect x="36" y="44" width="14" height="14" rx="3" class="fill-dark stroke" />
      <rect x="58" y="44" width="14" height="14" rx="3" class="fill-dark stroke" />
      <rect x="80" y="44" width="14" height="14" rx="3" class="fill-dark stroke" />
    </g>
  {:else if kind === 'event'}
    <!-- beacon: a mast that broadcasts, arcs ping outward -->
    <path d="M38 84 L50 48 L62 84 Z" class="fill-dark stroke" />
    <line x1="50" y1="48" x2="50" y2="36" class="stroke thick" />
    <circle cx="50" cy="32" r="4.5" class="fill ping-dot" />
    <path d="M38 22 A16 16 0 0 0 38 42" class="stroke thick ping a0" fill="none" />
    <path d="M62 22 A16 16 0 0 1 62 42" class="stroke thick ping a0" fill="none" />
    <path d="M30 14 A26 26 0 0 0 30 50" class="stroke ping a1" fill="none" />
    <path d="M70 14 A26 26 0 0 1 70 50" class="stroke ping a1" fill="none" />
  {:else if kind === 'table'}
    <ellipse cx="50" cy="28" rx="30" ry="10" class="fill-dark stroke" />
    <path d="M20 28 V72 A30 10 0 0 0 80 72 V28" class="fill-dark stroke" />
    <path d="M20 42 A30 10 0 0 0 80 42" class="stroke row" fill="none" />
    <path d="M20 56 A30 10 0 0 0 80 56" class="stroke row" fill="none" />
    <path d="M20 40 A30 10 0 0 0 80 40" class="stroke thick write" fill="none" />
    <ellipse cx="50" cy="28" rx="30" ry="10" class="stroke" fill="none" />
  {:else if kind === 'store'}
    <!-- datastore: a cabinet; the middle drawer slides out and back -->
    <rect x="24" y="14" width="52" height="72" rx="4" class="fill-dark stroke" />
    <rect x="30" y="20" width="40" height="17" rx="2" class="fill-dark stroke" />
    <rect x="44" y="27" width="12" height="3" rx="1.5" class="fill" />
    <g class="drawer">
      <rect x="30" y="42" width="40" height="17" rx="2" class="fill-dark stroke" />
      <rect x="44" y="49" width="12" height="3" rx="1.5" class="fill" />
    </g>
    <rect x="30" y="64" width="40" height="17" rx="2" class="fill-dark stroke" />
    <rect x="44" y="71" width="12" height="3" rx="1.5" class="fill" />
  {:else if kind === 'cache'}
    <!-- cache / KV: key : value rows; entries fade out as they expire and are written again -->
    {#each [30, 48, 66] as y, i}
      <g class="kv kv{i}">
        <rect x="18" y={y - 6} width="20" height="12" rx="6" class="fill-dark stroke" />
        <circle cx="26" cy={y} r="2.2" class="fill" />
        <circle cx="42" cy={y - 2.5} r="1.2" class="fill" /><circle cx="42" cy={y + 2.5} r="1.2" class="fill" />
        <rect x="47" y={y - 6} width="30" height="12" rx="3" class="fill-dark stroke" />
        <line x1="52" y1={y} x2={62 + i * 4} y2={y} class="stroke" />
      </g>
    {/each}
    <polygon points="84,10 74,28 81,28 76,42 88,22 81,22 86,10" class="fill bolt" />
  {:else if kind === 'external'}
    <!-- third party: our plug goes into their socket across the system boundary (dashed) -->
    <line x1="56" y1="12" x2="56" y2="88" class="stroke dash" />
    <rect x="60" y="32" width="26" height="36" rx="6" class="fill-dark stroke" />
    <rect x="67" y="42" width="4" height="7" rx="1" class="fill" /><rect x="75" y="42" width="4" height="7" rx="1" class="fill" />
    <rect x="70" y="55" width="6" height="4" rx="1" class="fill" />
    <g class="plug">
      <path d="M10 76 C 22 76, 20 50, 28 50" class="stroke" fill="none" />
      <rect x="26" y="40" width="22" height="20" rx="4" class="fill-dark stroke" />
      <line x1="48" y1="45.5" x2="60" y2="45.5" class="stroke thick" />
      <line x1="48" y1="54.5" x2="60" y2="54.5" class="stroke thick" />
    </g>
  {:else if kind === 'config'}
    <!-- configuration: sliders and a toggle on a panel; values change slowly -->
    <rect x="18" y="18" width="64" height="64" rx="6" class="fill-dark stroke" />
    <line x1="28" y1="34" x2="72" y2="34" class="stroke" />
    <circle cy="34" r="4.5" class="fill-dark stroke handle h0" />
    <line x1="28" y1="50" x2="72" y2="50" class="stroke" />
    <circle cy="50" r="4.5" class="fill-dark stroke handle h1" />
    <rect x="28" y="61" width="22" height="11" rx="5.5" class="fill-dark stroke" />
    <circle cy="66.5" r="3.5" class="fill toggle" />
    <line x1="58" y1="66.5" x2="72" y2="66.5" class="stroke" style="opacity: .4" />
  {:else if kind === 'test'}
    <!-- tests: a checklist on a clipboard; ticks land one by one, then the run restarts -->
    <rect x="26" y="20" width="48" height="66" rx="4" class="fill-dark stroke" />
    <rect x="41" y="14" width="18" height="10" rx="3" class="fill-dark stroke" />
    {#each [38, 54, 70] as y, i}
      <rect x="33" y={y - 5} width="10" height="10" rx="2" class="stroke" fill="none" />
      <line x1="49" y1={y} x2={66 - i * 3} y2={y} class="stroke" style="opacity: .45" />
      <path d="M{35} {y} l3 3 5 -6" class="stroke thick tick t{i}" fill="none" />
    {/each}
  {:else if kind === 'app'}
    <rect x="14" y="20" width="72" height="48" rx="5" class="fill-dark stroke" />
    <rect x="20" y="26" width="60" height="36" rx="2" class="fill screen" />
    <rect x="20" y="26" width="60" height="3" class="fill scan" />
    <rect x="40" y="70" width="20" height="4" class="fill" /><rect x="32" y="76" width="36" height="4" rx="2" class="fill" />
  {:else}
    <polygon points="50,16 84,50 50,84 16,50" class="fill-dark stroke spin-slow" style="transform-origin: 50px 50px" />
    <circle cx="50" cy="50" r="6" class="fill pulse" />
  {/if}
</svg>

<style>
  .sprite { overflow: visible; display: block; }
  .stroke { stroke: var(--c); stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
  .thick { stroke-width: 3.5; }
  .fill { fill: var(--c); }
  .fill-dark { fill: color-mix(in srgb, var(--c) 14%, var(--bg)); }
  .t { font: 700 34px var(--mono); fill: var(--c); }
  .dash { stroke-dasharray: 4 7; opacity: .5; }
  .teeth { stroke-width: 9; stroke-dasharray: 7 6; }
  .teeth-s { stroke-width: 6; stroke-dasharray: 5 4.3; }
  .orbit { stroke: var(--c); stroke-width: 1; opacity: .25; stroke-dasharray: 2 5; }
  .glow { opacity: 0; transition: opacity .3s; }
  .active .glow, .pending .glow { opacity: 1; }
  .dim { opacity: .4; }

  .spin { animation: spin 14s linear infinite; transform-origin: 50px 50px; }
  .spin-slow { animation: spin 18s linear infinite; }
  .spin-rev { animation: spin 11s linear infinite reverse; }
  .hand { animation: spin 12s linear infinite; transform-origin: 50px 52px; }
  .hand-s { animation: spin 60s linear infinite; transform-origin: 50px 52px; }
  .orbiter { animation: spin 9s linear infinite; }
  .chev { animation: slide 2.6s ease-in-out infinite; }
  .belt { animation: belt 3s linear infinite; }
  .ripple { opacity: 0; animation: ripple 3.6s ease-out infinite; transform-origin: 50px 50px; }
  .ripple.r2 { animation-delay: 1.8s; }
  .flash { animation: flash 3.6s ease-out infinite; }
  .scroll { animation: scroll 6s linear infinite; }
  .line { opacity: .6; }
  .cursor { animation: blink 1.2s steps(2) infinite; }
  .row { opacity: .3; }
  .write { opacity: 0; animation: write 3.2s ease-in-out infinite; }
  .glint { opacity: .3; animation: breathe 3s ease-in-out infinite; }
  .brick { animation: hover 4s ease-in-out infinite; }
  .brick2 { animation: hover 4s ease-in-out infinite reverse; }
  .bit { opacity: .3; animation: breathe 1.8s ease-in-out infinite; }
  .b1 { animation-delay: .4s; } .b2 { animation-delay: .9s; } .b3 { animation-delay: 1.3s; }
  .wave { opacity: 0; animation: ripple 3s ease-out infinite; transform-origin: 50px 52px; } .w2 { animation-delay: 1.5s; }
  .knob { animation: knob 7s ease-in-out infinite; } .k0 { animation-delay: 0s; } .k1 { animation-delay: 2s; } .k2 { animation-delay: 4s; }
  .draw { stroke-dasharray: 50; animation: draw 5s ease-in-out infinite; }
  .screen { opacity: .25; }
  .scan { opacity: .7; animation: scan 3s linear infinite; }
  .pulse { animation: breathe 2.6s ease-in-out infinite; }
  .ping { opacity: 0; animation: ping 3.2s ease-out infinite; } .a1 { animation-delay: .35s; }
  .ping-dot { animation: breathe 3.2s ease-out infinite; }
  .drawer { animation: drawer 6s ease-in-out infinite; }
  .kv { animation: ttl 7.5s ease-in-out infinite; } .kv1 { animation-delay: 2.5s; } .kv2 { animation-delay: 5s; }
  .bolt { opacity: .7; }
  .plug { animation: plug 5s ease-in-out infinite; }
  .handle { animation: handle 9s ease-in-out infinite; } .h0 { --from: 36px; --to: 62px; } .h1 { --from: 58px; --to: 42px; animation-delay: 3s; }
  .toggle { animation: toggle 6s ease-in-out infinite; }
  .tick { stroke-dasharray: 14; stroke-dashoffset: 14; animation: tick 6s ease-out infinite; } .t1 { animation-delay: .5s; } .t2 { animation-delay: 1s; }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes slide { 0% { transform: translateX(-6px); opacity: .3; } 50% { transform: translateX(6px); opacity: 1; } 100% { transform: translateX(-6px); opacity: .3; } }
  @keyframes belt { from { transform: translateX(-22px); } to { transform: translateX(0); } }
  @keyframes ripple { 0% { transform: scale(.5); opacity: .8; } 100% { transform: scale(2.3); opacity: 0; } }
  @keyframes flash { 0%, 100% { opacity: .75; } 6% { opacity: 1; filter: drop-shadow(0 0 6px var(--c)); } 14% { opacity: .75; } }
  @keyframes scroll { from { transform: translateY(0); } to { transform: translateY(-33px); } }
  @keyframes blink { to { opacity: 0; } }
  @keyframes write { 0% { transform: translateY(0); opacity: 0; } 15% { opacity: .9; } 85% { opacity: .9; } 100% { transform: translateY(30px); opacity: 0; } }
  @keyframes breathe { 0%, 100% { opacity: .3; } 50% { opacity: .95; } }
  @keyframes knob { 0%, 100% { transform: translateX(32px); } 50% { transform: translateX(64px); } }
  @keyframes draw { 0% { stroke-dashoffset: 50; } 40%, 70% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: -50; } }
  @keyframes hover { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
  @keyframes scan { from { transform: translateY(0); } to { transform: translateY(33px); } }
  @keyframes ping { 0% { opacity: 0; } 10% { opacity: .9; } 55%, 100% { opacity: 0; } }
  @keyframes drawer { 0%, 30% { transform: translateX(0); } 50%, 70% { transform: translateX(9px); } 90%, 100% { transform: translateX(0); } }
  @keyframes ttl { 0%, 60% { opacity: 1; transform: translateY(0); } 75% { opacity: 0; transform: translateY(-3px); } 85% { opacity: 0; transform: translateY(3px); } 100% { opacity: 1; transform: translateY(0); } }
  @keyframes plug { 0%, 20% { transform: translateX(-9px); } 45%, 75% { transform: translateX(0); } 100% { transform: translateX(-9px); } }
  @keyframes handle { 0%, 35% { transform: translateX(var(--from)); } 50%, 85% { transform: translateX(var(--to)); } 100% { transform: translateX(var(--from)); } }
  @keyframes toggle { 0%, 40% { transform: translateX(33.5px); opacity: .45; } 50%, 90% { transform: translateX(44.5px); opacity: 1; } 100% { transform: translateX(33.5px); opacity: .45; } }
  @keyframes tick { 0% { stroke-dashoffset: 14; } 20%, 80% { stroke-dashoffset: 0; } 90%, 100% { stroke-dashoffset: 14; } }
</style>
