/**
 * Automatic playback-source maintenance is intentionally disabled.
 *
 * Movyz playback is manual + curated:
 * - sources are prepared and verified before being stored in Supabase;
 * - user playback reads only prepared DB rows;
 * - no resolver is invoked during playback;
 * - no Browser Run / scheduled source discovery is allowed here.
 *
 * This compatibility function remains only so older tooling cannot
 * accidentally re-enable the old queue-based resolver path.
 */
export async function runMaintenanceTick(
  jobKey: 'primary_sources' | 'secondary_sources' | 'repair_sources',
  _browserBinding?: unknown,
) {
  return {
    disabled: true,
    jobKey,
    reason: 'Automatic playback-source discovery is disabled; use manually prepared DB sources.',
  };
}
