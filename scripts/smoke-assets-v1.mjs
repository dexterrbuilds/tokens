/* eslint-disable no-console */

function getEnv(name) {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

const baseUrl = getEnv('TOKENS_API_BASE_URL') || 'http://localhost:3002';
const apiKey = getEnv('TOKENS_API_KEY');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchJson(path) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    headers: {
      'x-api-key': apiKey,
    },
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    const body = typeof json === 'object' && json !== null ? JSON.stringify(json) : text;
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${path}: ${body || '(empty response)'}`);
  }

  return json;
}

function hasMint(variants, mint) {
  return variants.some((v) => v && typeof v.mint === 'string' && v.mint === mint);
}

function getLiquidity(variant) {
  const value = variant && variant.market ? variant.market.liquidity : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function assertLiquiditySortedDesc(variants, label) {
  for (let i = 1; i < variants.length; i++) {
    const prev = getLiquidity(variants[i - 1]);
    const next = getLiquidity(variants[i]);
    assert(prev >= next, `${label} not sorted by liquidity desc at index ${i - 1} -> ${i} (${prev} < ${next})`);
  }
}

async function main() {
  assert(apiKey, 'Missing TOKENS_API_KEY (required to call /api/v1/* endpoints)');

  // -----------------------------
  // Bitcoin
  // -----------------------------
  const bitcoin = await fetchJson('/api/v1/assets/bitcoin');
  assert(bitcoin?.asset?.assetId === 'bitcoin', 'bitcoin.asset.assetId should be "bitcoin"');
  assert((bitcoin?.asset?.symbol ?? '').trim() === 'BTC', 'bitcoin.asset.symbol should be "BTC"');

  const bitcoinSpot = bitcoin?.asset?.variantGroups?.spot ?? [];
  assert(Array.isArray(bitcoinSpot), 'bitcoin.asset.variantGroups.spot should be an array');
  assert(
    hasMint(bitcoinSpot, '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh'),
    'bitcoin variants should include wBTC mint',
  );
  assert(
    hasMint(bitcoinSpot, 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij'),
    'bitcoin variants should include cbBTC mint',
  );
  assertLiquiditySortedDesc(bitcoinSpot, 'bitcoin spot variants');

  // -----------------------------
  // Tesla
  // -----------------------------
  const tesla = await fetchJson('/api/v1/assets/tesla');
  assert(tesla?.asset?.assetId === 'tesla', 'tesla.asset.assetId should be "tesla"');
  assert((tesla?.asset?.symbol ?? '').trim() === 'TSLA', 'tesla.asset.symbol should be "TSLA"');

  const teslaSpot = tesla?.asset?.variantGroups?.spot ?? [];
  assert(Array.isArray(teslaSpot), 'tesla.asset.variantGroups.spot should be an array');
  assert(
    hasMint(teslaSpot, 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB'),
    'tesla variants should include xStock mint',
  );
  assert(
    hasMint(teslaSpot, 'KeGv7bsfR4MheC1CkmnAVceoApjrkvBhHYjWb67ondo'),
    'tesla variants should include Ondo mint',
  );
  assertLiquiditySortedDesc(teslaSpot, 'tesla spot variants');

  // Optional backwards-compat: legacy assetRef should resolve.
  const legacyTesla = await fetchJson('/api/v1/assets/xstock-tesla');
  assert(legacyTesla?.asset?.assetId === 'tesla', 'xstock-tesla should resolve to canonical assetId "tesla"');

  // -----------------------------
  // Gold
  // -----------------------------
  const gold = await fetchJson('/api/v1/assets/gold');
  assert(gold?.asset?.assetId === 'gold', 'gold.asset.assetId should be "gold"');
  assert((gold?.asset?.symbol ?? '').trim() === 'GLD', 'gold.asset.symbol should be "GLD"');

  const goldSpot = gold?.asset?.variantGroups?.spot ?? [];
  const goldEtf = gold?.asset?.variantGroups?.etf ?? [];
  assert(Array.isArray(goldSpot), 'gold.asset.variantGroups.spot should be an array');
  assert(Array.isArray(goldEtf), 'gold.asset.variantGroups.etf should be an array');

  assert(
    hasMint(goldSpot, 'AymATz4TCL9sWNEEV9Kvyz45CHVhDZ6kUgjTJPzLpU9P') ||
      hasMint(goldEtf, 'AymATz4TCL9sWNEEV9Kvyz45CHVhDZ6kUgjTJPzLpU9P'),
    'gold variants should include XAUT mint',
  );
  assert(
    hasMint(goldSpot, 'hWfiw4mcxT8rnNFkk6fsCQSxoxgZ9yVhB6tyeVcondo') ||
      hasMint(goldEtf, 'hWfiw4mcxT8rnNFkk6fsCQSxoxgZ9yVhB6tyeVcondo'),
    'gold variants should include Ondo SPDR Gold mint',
  );

  assertLiquiditySortedDesc(goldSpot, 'gold spot variants');
  assertLiquiditySortedDesc(goldEtf, 'gold etf variants');

  // -----------------------------
  // Anduril (PreStocks pre-IPO)
  // -----------------------------
  const anduril = await fetchJson('/api/v1/assets/anduril');
  assert(
    (anduril?.asset?.assetId ?? '').startsWith('pre-'),
    'anduril should resolve to a pre-* PreStocks asset',
  );
  const andurilCanonical = anduril?.asset?.canonicalMarket ?? null;
  // Tolerate a missing canonicalMarket while the prestocks pipeline warms, but
  // when present it must be the prestocks source with the derived fields.
  if (andurilCanonical) {
    assert(
      andurilCanonical.source === 'prestocks',
      `anduril canonicalMarket.source should be "prestocks", got ${andurilCanonical.source}`,
    );
    assert('impliedValuationUsd' in andurilCanonical, 'anduril canonicalMarket should carry impliedValuationUsd');
    assert('premiumToMarkPercent' in andurilCanonical, 'anduril canonicalMarket should carry premiumToMarkPercent');
    assert('markPriceUsd' in andurilCanonical, 'anduril canonicalMarket should carry markPriceUsd');
  }

  console.log('OK: v1 canonical asset smoke checks passed');
}

main().catch((err) => {
  console.error('FAILED:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

