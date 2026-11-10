// The box credential warnings and errors to post: each when it first appears and once a UTC
// day while it lasts, from the conductors' credential_health. A cleared one is forgotten, so
// nothing is posted for it and a return is posted again.

// credential_health as bakers.build stores it, a JSON string of entries; anything else is none.
function entries(health) {
  if (Array.isArray(health)) return health;
  try {
    const parsed = JSON.parse(health ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * @param {Record<string, string>} previous key → UTC date it was last posted
 * @param {Array<{uuid: string, conductor_id: string, label?: string, credential_health?: any}>} conductors
 * @param {string} today the UTC date, YYYY-MM-DD
 * @returns {{due: Array<{key: string, box: string, name: string, status: string, expires_at?: string, reason?: string}>, next: Record<string, string>}}
 *   next keeps the open ones' last post; the caller records today for each due one it posted.
 */
export function credentialPosts(previous, conductors, today) {
  const due = [];
  const next = {};
  for (const conductor of conductors) {
    for (const entry of entries(conductor.credential_health)) {
      if (entry?.status !== 'warning' && entry?.status !== 'error') continue;
      // With the status: a warning turning into an error is news the same day.
      const key = `${conductor.uuid}:${entry.name}:${entry.status}`;
      if (previous[key]) next[key] = previous[key];
      if (previous[key] !== today) due.push({ ...entry, key, box: conductor.label || conductor.conductor_id });
    }
  }
  return { due, next };
}
