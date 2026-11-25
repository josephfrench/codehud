<script lang="ts">
  /** SVG pattern defs for the ground. Fill a shape with `url(#tex-<ground>)` and set its CSS `color` to the layer colour. */
  let { scale = 1 }: { scale?: number } = $props();
  const t = $derived(`scale(${scale})`);
</script>

<defs>
  <!-- plaza: paving slabs -->
  <pattern id="tex-plaza" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform={t}><rect x="1.5" y="1.5" width="19" height="19" rx="1" fill="none" stroke="currentColor" stroke-width="1" /></pattern>
  <!-- wall: brick courses -->
  <pattern id="tex-wall" width="24" height="12" patternUnits="userSpaceOnUse" patternTransform={t}><path d="M0,0.5 H24 M0,6.5 H24 M6,0 V6 M18,6 V12" fill="none" stroke="currentColor" stroke-width="1" /></pattern>
  <!-- road: centre-line dashes -->
  <pattern id="tex-road" width="26" height="22" patternUnits="userSpaceOnUse" patternTransform={t}><path d="M3,11 H15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></pattern>
  <!-- town: scattered roofs -->
  <pattern id="tex-town" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform={t}><path d="M2,7 l3,-3 l3,3 z M10,14 l3,-3 l3,3 z" fill="currentColor" /></pattern>
  <!-- water: waves -->
  <pattern id="tex-water" width="16" height="12" patternUnits="userSpaceOnUse" patternTransform={t}><path d="M0,6 Q4,0 8,6 T16,6" fill="none" stroke="currentColor" stroke-width="1.1" /></pattern>
  <!-- fog: sparse motes -->
  <pattern id="tex-fog" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform={t}><circle cx="6" cy="6" r="1" fill="currentColor" /><circle cx="18" cy="16" r=".7" fill="currentColor" /></pattern>
  <!-- rail: ties and rails -->
  <pattern id="tex-rail" width="12" height="16" patternUnits="userSpaceOnUse" patternTransform={t}><path d="M0,4.5 H12 M0,11.5 H12 M6,0 V16" fill="none" stroke="currentColor" stroke-width="1" /></pattern>
  <!-- field: furrows -->
  <pattern id="tex-field" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform={t}><path d="M-3,3 l6,-6 M0,12 L12,0 M9,15 l6,-6" fill="none" stroke="currentColor" stroke-width="1" /></pattern>
</defs>
