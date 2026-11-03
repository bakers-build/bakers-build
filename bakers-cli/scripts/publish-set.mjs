import { createRequire } from 'node:module';
const { valid, gt } = createRequire(new URL('../core/package.json', import.meta.url))('semver');

export async function publishSet(packages, version, channel, registry) {
  if (!valid(version) || !['next', 'latest'].includes(channel) || packages.length === 0)
    throw new Error('Invalid release set, version or channel');
  const pending = [];
  // Preflight the whole set before writing any immutable version or moving a channel.
  for (const pkg of packages) {
    const current = await registry.current(pkg.name, channel);
    if (current && (!valid(current) || gt(current, version)))
      throw new Error(`${pkg.name}: refusing to move ${channel} backwards`);
    const integrity = await registry.integrity(pkg.name, version);
    if (integrity && integrity !== pkg.integrity)
      throw new Error(`${pkg.name}@${version}: published integrity differs`);
    if (!integrity) pending.push(pkg);
  }
  for (const pkg of pending) await registry.publish(pkg, version);
  for (const pkg of packages) await registry.promote(pkg.name, version, channel);
}
