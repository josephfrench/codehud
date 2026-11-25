<script lang="ts">
  /** SVG pattern defs for lane terrain. Fill a shape with `url(#tex-<name>)` and set its CSS `color` to the lane tone. */
  let { scale = 1 }: { scale?: number } = $props();
  const t = $derived(`scale(${scale})`);
</script>

<defs>
  <pattern id="tex-dots" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform={t}><circle cx="6" cy="6" r="1.4" fill="currentColor" /></pattern>
  <pattern id="tex-diag" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform={t}><path d="M-3,3 l6,-6 M0,12 L12,0 M9,15 l6,-6" fill="none" stroke="currentColor" stroke-width="1.1" /></pattern>
  <pattern id="tex-waves" width="16" height="12" patternUnits="userSpaceOnUse" patternTransform={t}><path d="M0,6 Q4,0 8,6 T16,6" fill="none" stroke="currentColor" stroke-width="1.1" /></pattern>
  <pattern id="tex-grid" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform={t}><path d="M0,0.5 H18 M0.5,0 V18" fill="none" stroke="currentColor" stroke-width="1" /></pattern>
  <pattern id="tex-zigzag" width="16" height="10" patternUnits="userSpaceOnUse" patternTransform={t}><path d="M0,8 L4,2 L8,8 L12,2 L16,8" fill="none" stroke="currentColor" stroke-width="1.1" /></pattern>
  <pattern id="tex-rings" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform={t}><circle cx="9" cy="9" r="5" fill="none" stroke="currentColor" stroke-width="1.1" /></pattern>
  <pattern id="tex-checker" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform={t}><rect width="8" height="8" fill="currentColor" fill-opacity=".55" /><rect x="8" y="8" width="8" height="8" fill="currentColor" fill-opacity=".55" /></pattern>
  <pattern id="tex-cross" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform={t}><path d="M0,0 L12,12 M12,0 L0,12" fill="none" stroke="currentColor" stroke-width=".9" /></pattern>
</defs>
