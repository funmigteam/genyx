export const INITIAL_PACKAGE_CODES = ['BRONZE', 'SILVER', 'GOLD'] as const;
export const ADVANCED_PACKAGE_CODES = ['PLATINUM', 'DIAMOND'] as const;

export function requiresInitialPackage(packageCode: string) {
  return ADVANCED_PACKAGE_CODES.includes(packageCode as typeof ADVANCED_PACKAGE_CODES[number]);
}
