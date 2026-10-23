// Custom profile catalog. The key is the shop item's imageKey and the CSS
// class suffix; its prefix decides which profile slot it occupies.
export type CosmeticSlot = 'frame' | 'banner' | 'name';
export const COSMETICS = [
  { sku: 'PROFILE_FRAME_GOLD', key: 'frame-gold', title: 'Gold Halo', gen: 120, description: 'A rotating golden halo with a warm glow.' },
  { sku: 'PROFILE_FRAME_CYAN', key: 'frame-cyan', title: 'Cyan Pulse', gen: 150, description: 'A neon cyan ring that pulses like a heartbeat.' },
  { sku: 'PROFILE_FRAME_VIOLET', key: 'frame-violet', title: 'Violet Nova', gen: 180, description: 'Violet energy orbiting your avatar.' },
  { sku: 'PROFILE_FRAME_ROSE', key: 'frame-rose', title: 'Rose Signal', gen: 210, description: 'A rose ring that broadcasts soft waves.' },
  { sku: 'PROFILE_FRAME_OBSIDIAN', key: 'obsidian', title: 'Obsidian Core', gen: 240, description: 'Dark glass edges with a slow silver sweep.' },
  { sku: 'PROFILE_FRAME_AURORA', key: 'aurora', title: 'Aurora Crest', gen: 280, description: 'Northern-light colours flowing around you.' },
  { sku: 'PROFILE_FRAME_SOLAR', key: 'solar', title: 'Solar Crown', gen: 320, description: 'A blazing solar corona with flares.' },
  { sku: 'PROFILE_FRAME_ICE', key: 'ice', title: 'Ice Circuit', gen: 360, description: 'Frosted circuitry with a crystalline shimmer.' },
  { sku: 'PROFILE_BANNER_NEBULA', key: 'banner-nebula', title: 'Nebula Drift', gen: 300, description: 'A drifting purple nebula behind your profile.' },
  { sku: 'PROFILE_BANNER_GRID', key: 'banner-grid', title: 'Cyber Grid', gen: 350, description: 'A neon synthwave grid racing to the horizon.' },
  { sku: 'PROFILE_BANNER_OCEAN', key: 'banner-ocean', title: 'Deep Ocean', gen: 380, description: 'Slow waves of deep blue light.' },
  { sku: 'PROFILE_BANNER_DUNES', key: 'banner-dunes', title: 'Golden Dunes', gen: 400, description: 'Sunlit golden dunes with a shimmering haze.' },
  { sku: 'PROFILE_BANNER_AURORA', key: 'banner-aurora', title: 'Aurora Sky', gen: 450, description: 'An aurora rippling across a night sky.' },
  { sku: 'PROFILE_BANNER_EMBER', key: 'banner-ember', title: 'Ember Storm', gen: 500, description: 'Rising embers over a dark storm.' },
  { sku: 'PROFILE_NAME_NEON', key: 'name-neon', title: 'Neon Glow', gen: 250, description: 'Your name lit up in flickering neon.' },
  { sku: 'PROFILE_NAME_FROST', key: 'name-frost', title: 'Frost Script', gen: 300, description: 'An icy gradient with a cold shine.' },
  { sku: 'PROFILE_NAME_RAINBOW', key: 'name-rainbow', title: 'Prism Shift', gen: 350, description: 'A full spectrum flowing through your name.' },
  { sku: 'PROFILE_NAME_GOLD', key: 'name-gold', title: 'Gold Foil', gen: 400, description: 'Polished gold foil with a moving glint.' },
  { sku: 'PROFILE_NAME_GLITCH', key: 'name-glitch', title: 'Glitch', gen: 450, description: 'A cyberpunk glitch that splits your name.' },
] as const;

export function cosmeticSlot(key: string): CosmeticSlot {
  return key.startsWith('banner-') ? 'banner' : key.startsWith('name-') ? 'name' : 'frame';
}
export const PROFILE_BIO_MAX = 80;
