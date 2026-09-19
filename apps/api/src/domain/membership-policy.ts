// Access to account information, existing payments and withdrawal of existing
// funds stays available. Membership gates new participation, not recovery.
export function requiresMembership(method: string, route: string) {
  return method === 'POST' && (
    /^\/v1\/tasks\/[^/]+\/claim$/.test(route) ||
    /^\/v1\/shop\/[^/]+\/purchase$/.test(route) ||
    /^\/v1\/auctions\/[^/]+\/bids$/.test(route) ||
    /^\/v1\/lottery\/[^/]+\/enter$/.test(route) ||
    route === '/v1/payments/package-intents' || route === '/v1/payments/season-intents'
  );
}
