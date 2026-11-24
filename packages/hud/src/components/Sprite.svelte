<script lang="ts">
  /** One animated glyph per resource kind. Accent colour comes from `color` (any CSS colour). */
  let { kind = 'other', size = 120, color = 'var(--fg-2)', state = 'idle' as 'idle' | 'active' | 'pending' | 'dim' } = $props();
</script>

<svg class="sprite {kind} {state}" width={size} height={size} viewBox="0 0 100 100" style="--c: {color}" aria-hidden="true">
  <defs>
    <radialGradient id="g-{kind}"><stop offset="0" stop-color="var(--c)" stop-opacity=".35" /><stop offset="1" stop-color="var(--c)" stop-opacity="0" /></radialGradient>
  </defs>
  <circle cx="50" cy="50" r="46" fill="url(#g-{kind})" class="glow" />

  {#if kind === 'page'}
    <rect x="14" y="18" width="72" height="62" rx="6" class="fill-dark stroke" />
    <line x1="14" y1="30" x2="86" y2="30" class="stroke" />
    <circle cx="22" cy="24" r="2" class="fill" /><circle cx="29" cy="24" r="2" class="fill" /><circle cx="36" cy="24" r="2" class="fill" />
    <rect x="22" y="38" width="40" height="4" rx="2" class="fill line l1" />
    <rect x="22" y="48" width="56" height="4" rx="2" class="fill line l2" />
    <rect x="22" y="58" width="30" height="4" rx="2" class="fill line l3" />
    <rect x="22" y="66" width="18" height="7" rx="2" class="fill btn" />
  {:else if kind === 'component'}
    <rect x="18" y="40" width="34" height="34" rx="5" class="fill-dark stroke" />
    <rect x="40" y="26" width="34" height="34" rx="5" class="fill-dark stroke brick" />
    <rect x="30" y="56" width="26" height="22" rx="4" class="fill-dark stroke" />
    <rect x="46" y="32" width="10" height="4" rx="2" class="fill glint" />
  {:else if kind === 'route'}
    <path d="M18 78 V46 A32 32 0 0 1 82 46 V78" class="stroke thick" fill="none" />
    <path d="M30 78 V48 A20 20 0 0 1 70 48 V78" class="stroke" fill="none" />
    <g class="chev">
      <path d="M36 60 l6 6 -6 6" class="stroke" fill="none" /><path d="M46 60 l6 6 -6 6" class="stroke" fill="none" /><path d="M56 60 l6 6 -6 6" class="stroke" fill="none" />
    </g>
  {:else if kind === 'middleware'}
    <path d="M50 14 L80 26 V50 C80 68 66 80 50 86 C34 80 20 68 20 50 V26 Z" class="fill-dark stroke" />
    <path d="M38 50 l9 9 16 -18" class="stroke thick" fill="none" />
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
    <text x="50" y="62" text-anchor="middle" class="t">ƒ</text>
    <circle cx="50" cy="50" r="40" class="orbit" fill="none" />
    <circle r="3" class="fill satellite" />
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
    </g>
  {:else if kind === 'event'}
    <polygon points="56,12 30,54 48,54 42,88 72,42 54,42 62,12" class="fill-dark stroke" />
    <circle cx="50" cy="50" r="20" class="stroke ripple" fill="none" />
  {:else if kind === 'table'}
    <ellipse cx="50" cy="28" rx="30" ry="10" class="fill-dark stroke" />
    <path d="M20 28 V72 A30 10 0 0 0 80 72 V28" class="fill-dark stroke" />
    <path d="M20 42 A30 10 0 0 0 80 42" class="stroke row r1" fill="none" />
    <path d="M20 56 A30 10 0 0 0 80 56" class="stroke row r2" fill="none" />
    <ellipse cx="50" cy="28" rx="30" ry="10" class="stroke" fill="none" />
  {:else if kind === 'store'}
    <rect x="20" y="18" width="60" height="64" rx="8" class="fill-dark stroke" />
    <circle cx="50" cy="50" r="16" class="stroke thick" fill="none" />
    <g class="spin-slow" style="transform-origin: 50px 50px">
      <line x1="50" y1="36" x2="50" y2="42" class="stroke thick" />
      <line x1="50" y1="58" x2="50" y2="64" class="stroke thick" />
      <line x1="36" y1="50" x2="42" y2="50" class="stroke thick" />
      <line x1="58" y1="50" x2="64" y2="50" class="stroke thick" />
    </g>
    <circle cx="50" cy="50" r="5" class="fill" />
  {:else if kind === 'cache'}
    <rect x="26" y="26" width="48" height="48" rx="6" class="fill-dark stroke" />
    {#each [34, 44, 54, 64] as p}
      <line x1={p} y1="16" x2={p} y2="26" class="stroke" /><line x1={p} y1="74" x2={p} y2="84" class="stroke" />
      <line x1="16" y1={p} x2="26" y2={p} class="stroke" /><line x1="74" y1={p} x2="84" y2={p} class="stroke" />
    {/each}
    <rect x="38" y="38" width="24" height="24" rx="3" class="fill flicker" />
  {:else if kind === 'external'}
    <path d="M30 70 H70 A14 14 0 0 0 70 42 A18 18 0 0 0 36 38 A13 13 0 0 0 30 70 Z" class="fill-dark stroke" />
    <path d="M50 50 m-8 0 a8 8 0 0 1 16 0" class="stroke wave w1" fill="none" />
    <path d="M50 50 m-14 0 a14 14 0 0 1 28 0" class="stroke wave w2" fill="none" />
    <circle cx="50" cy="50" r="3" class="fill" />
  {:else if kind === 'config'}
    {#each [32, 50, 68] as y, i}
      <line x1="22" y1={y} x2="78" y2={y} class="stroke" />
      <circle cy={y} r="5" class="fill-dark stroke knob k{i}" />
    {/each}
  {:else if kind === 'test'}
    <circle cx="50" cy="50" r="30" class="fill-dark stroke" />
    <path d="M36 50 l10 10 20 -22" class="stroke thick draw" fill="none" />
  {:else if kind === 'app'}
    <rect x="14" y="20" width="72" height="48" rx="5" class="fill-dark stroke" />
    <rect x="20" y="26" width="60" height="36" rx="2" class="fill screen" />
    <rect x="40" y="70" width="20" height="4" class="fill" /><rect x="32" y="76" width="36" height="4" rx="2" class="fill" />
  {:else}
    <polygon points="50,16 84,50 50,84 16,50" class="fill-dark stroke" />
    <circle cx="50" cy="50" r="6" class="fill" />
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

  /* calm, slow motion */
  .spin { animation: spin 14s linear infinite; transform-origin: 50px 50px; }
  .spin-slow { animation: spin 18s linear infinite; }
  .spin-rev { animation: spin 11s linear infinite reverse; }
  .hand { animation: spin 12s linear infinite; transform-origin: 50px 52px; }
  .hand-s { animation: spin 60s linear infinite; transform-origin: 50px 52px; }
  .satellite { offset-path: circle(40px at 50px 50px); animation: orbit 9s linear infinite; }
  .chev { animation: slide 2.6s ease-in-out infinite; }
  .belt { animation: belt 4s linear infinite; }
  .ripple { opacity: 0; animation: ripple 3.6s ease-out infinite; transform-origin: 50px 50px; }
  .line { opacity: .45; animation: breathe 4s ease-in-out infinite; }
  .l2 { animation-delay: .6s; } .l3 { animation-delay: 1.2s; }
  .btn { opacity: .8; }
  .row { opacity: .35; animation: breathe 4s ease-in-out infinite; } .r2 { animation-delay: 1s; }
  .glint { opacity: .3; animation: breathe 3s ease-in-out infinite; }
  .flicker { opacity: .5; animation: breathe 2.4s ease-in-out infinite; }
  .wave { opacity: .3; animation: breathe 3s ease-in-out infinite; } .w2 { animation-delay: .7s; }
  .knob { animation: knob 7s ease-in-out infinite; } .k0 { animation-delay: 0s; } .k1 { animation-delay: 2s; } .k2 { animation-delay: 4s; }
  .draw { stroke-dasharray: 50; animation: draw 5s ease-in-out infinite; }
  .screen { opacity: .25; animation: breathe 5s ease-in-out infinite; }
  .brick { animation: hover 5s ease-in-out infinite; }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes orbit { to { offset-distance: 100%; } }
  @keyframes slide { 0% { transform: translateX(-6px); opacity: .3; } 50% { transform: translateX(6px); opacity: 1; } 100% { transform: translateX(-6px); opacity: .3; } }
  @keyframes belt { from { transform: translateX(-22px); } to { transform: translateX(0); } }
  @keyframes ripple { 0% { transform: scale(.4); opacity: .7; } 100% { transform: scale(2); opacity: 0; } }
  @keyframes breathe { 0%, 100% { opacity: .3; } 50% { opacity: .95; } }
  @keyframes knob { 0%, 100% { transform: translateX(32px); } 50% { transform: translateX(64px); } }
  @keyframes draw { 0% { stroke-dashoffset: 50; } 40%, 70% { stroke-dashoffset: 0; } 100% { stroke-dashoffset: -50; } }
  @keyframes hover { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
</style>
