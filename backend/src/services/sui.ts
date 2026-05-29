import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SUI_CLI = process.env.SUI_CLI ?? 'sui';
const SUI_NETWORK = process.env.SUI_NETWORK ?? 'testnet';
const PACKAGE_ID = process.env.SUI_PACKAGE_ID ?? '';
const MARKET_MODULE = process.env.SUI_MARKET_MODULE ?? 'prediction_market';
const MARKET_ADMIN_CAP_ID = process.env.SUI_MARKET_ADMIN_CAP_ID ?? '';
const MOCK_USDC_TYPE = process.env.MOCK_USDC_TYPE ?? '';
const MOCK_USDC_TREASURY_CAP_ID = process.env.MOCK_USDC_TREASURY_CAP_ID ?? '';

export type SuiJson = Record<string, unknown> | unknown[];

type SuiObjectChange = {
  type?: string;
  objectId?: string;
  objectType?: string;
};

function requireEnv(name: string, value: string): string {
  if (!value) throw new Error(`Missing required Sui env var: ${name}`);
  return value;
}

async function sui(args: string[]): Promise<SuiJson> {
  const { stdout } = await execFileAsync(SUI_CLI, args, {
    maxBuffer: 1024 * 1024 * 20,
  });
  return JSON.parse(stdout) as SuiJson;
}

function clientArgs(args: string[]): string[] {
  return ['client', '--client.env', SUI_NETWORK, ...args];
}

function objectChanges(json: SuiJson): SuiObjectChange[] {
  if (!json || Array.isArray(json)) return [];
  const changes = (json as { objectChanges?: unknown }).objectChanges;
  return Array.isArray(changes) ? changes as SuiObjectChange[] : [];
}

function findCreatedObject(json: SuiJson, predicate: (objectType: string) => boolean): string {
  const found = objectChanges(json).find((change) => {
    if (change.type !== 'created' || !change.objectId || !change.objectType) return false;
    return predicate(change.objectType);
  });
  if (!found?.objectId) {
    throw new Error(`Expected Sui object was not created. Object changes: ${JSON.stringify(objectChanges(json))}`);
  }
  return found.objectId;
}

function digest(json: SuiJson): string | null {
  if (!json || Array.isArray(json)) return null;
  const raw = (json as { digest?: unknown }).digest;
  return typeof raw === 'string' ? raw : null;
}

export function suiConfig() {
  return {
    network: SUI_NETWORK,
    rpc_url: process.env.SUI_RPC_URL ?? 'https://fullnode.testnet.sui.io:443',
    active_address: process.env.SUI_ACTIVE_ADDRESS ?? null,
    package_id: PACKAGE_ID,
    market_module: MARKET_MODULE,
    market_admin_cap_id: MARKET_ADMIN_CAP_ID,
    mock_usdc_type: MOCK_USDC_TYPE,
    mock_usdc_treasury_cap_id: MOCK_USDC_TREASURY_CAP_ID,
    mock_usdc_metadata_id: process.env.MOCK_USDC_METADATA_ID ?? null,
    mock_usdc_decimals: Number(process.env.MOCK_USDC_DECIMALS ?? 6),
  };
}

export async function suiStatus() {
  const [env, address, suiBalance, usdcBalance] = await Promise.all([
    execFileAsync(SUI_CLI, clientArgs(['active-env'])).then((r) => r.stdout.trim()),
    execFileAsync(SUI_CLI, clientArgs(['active-address'])).then((r) => r.stdout.trim()),
    sui(clientArgs(['balance', '--json'])),
    MOCK_USDC_TYPE
      ? sui(clientArgs(['balance', '--coin-type', MOCK_USDC_TYPE, '--json']))
      : Promise.resolve([]),
  ]);

  return {
    ...suiConfig(),
    active_env: env,
    active_address: address,
    balances: {
      sui: suiBalance,
      mock_usdc: usdcBalance,
    },
  };
}

export async function mintMockUsdc(recipient: string, amountRaw: string) {
  return sui(clientArgs([
    'call',
    '--package',
    requireEnv('SUI_PACKAGE_ID', PACKAGE_ID),
    '--module',
    'mock_usdc',
    '--function',
    'mint',
    '--args',
    requireEnv('MOCK_USDC_TREASURY_CAP_ID', MOCK_USDC_TREASURY_CAP_ID),
    amountRaw,
    recipient,
    '--gas-budget',
    '20000000',
    '--json',
  ]));
}

export async function openSuiLocalBasketPosition(args: {
  bundleId: string;
  amountRaw: string;
  recipient?: string;
}) {
  const status = await suiStatus();
  const recipient = args.recipient || status.active_address;
  if (!recipient) throw new Error('No Sui recipient provided and no active address available');

  const mint = await mintMockUsdc(recipient, args.amountRaw);
  const mintedCoinId = findCreatedObject(mint, (objectType) =>
    MOCK_USDC_TYPE
      ? objectType === `0x2::coin::Coin<${MOCK_USDC_TYPE}>`
      : objectType.includes('::mock_usdc::MOCK_USDC>'),
  );

  const question = `Senthos ${args.bundleId} local Sui position`;
  const market = await createSuiMarket(question, '0');
  const marketId = findCreatedObject(market, (objectType) =>
    objectType.endsWith(`::${MARKET_MODULE}::Market`),
  );

  const buy = await buySuiMarketSide(marketId, mintedCoinId, args.amountRaw, 'yes');
  const positionId = findCreatedObject(buy, (objectType) =>
    objectType.endsWith(`::${MARKET_MODULE}::Position`),
  );

  return {
    chain: 'sui',
    network: SUI_NETWORK,
    bundle_id: args.bundleId,
    owner: recipient,
    amount_raw: args.amountRaw,
    market_id: marketId,
    position_id: positionId,
    digests: {
      mint: digest(mint),
      create_market: digest(market),
      buy: digest(buy),
    },
    raw: { mint, market, buy },
  };
}

export async function createSuiMarket(question: string, closeMs: string) {
  const bytes = Array.from(Buffer.from(question, 'utf8'));
  return sui(clientArgs([
    'call',
    '--package',
    requireEnv('SUI_PACKAGE_ID', PACKAGE_ID),
    '--module',
    MARKET_MODULE,
    '--function',
    'create_market',
    '--args',
    requireEnv('SUI_MARKET_ADMIN_CAP_ID', MARKET_ADMIN_CAP_ID),
    `[${bytes.join(',')}]`,
    closeMs,
    '--gas-budget',
    '20000000',
    '--json',
  ]));
}

export async function buySuiMarketSide(
  marketId: string,
  coinId: string,
  amountRaw: string,
  side: 'yes' | 'no',
) {
  return sui(clientArgs([
    'ptb',
    '--split-coins',
    `@${coinId}`,
    `[${amountRaw}]`,
    '--assign',
    'payment',
    '--move-call',
    `${requireEnv('SUI_PACKAGE_ID', PACKAGE_ID)}::${MARKET_MODULE}::buy_${side}`,
    `@${marketId}`,
    'payment.0',
    '--gas-budget',
    '30000000',
    '--json',
  ]));
}

export async function resolveSuiMarket(marketId: string, side: 'yes' | 'no') {
  return sui(clientArgs([
    'call',
    '--package',
    requireEnv('SUI_PACKAGE_ID', PACKAGE_ID),
    '--module',
    MARKET_MODULE,
    '--function',
    `resolve_${side}`,
    '--args',
    requireEnv('SUI_MARKET_ADMIN_CAP_ID', MARKET_ADMIN_CAP_ID),
    marketId,
    '--gas-budget',
    '20000000',
    '--json',
  ]));
}

export async function claimSuiMarket(marketId: string, positionId: string) {
  return sui(clientArgs([
    'call',
    '--package',
    requireEnv('SUI_PACKAGE_ID', PACKAGE_ID),
    '--module',
    MARKET_MODULE,
    '--function',
    'claim',
    '--args',
    marketId,
    positionId,
    '--gas-budget',
    '20000000',
    '--json',
  ]));
}

export async function redeemSuiLocalBasketPosition(args: {
  marketId: string;
  positionId: string;
}) {
  const resolved = await resolveSuiMarket(args.marketId, 'yes');
  const claimed = await claimSuiMarket(args.marketId, args.positionId);
  return {
    chain: 'sui',
    network: SUI_NETWORK,
    market_id: args.marketId,
    position_id: args.positionId,
    digests: {
      resolve: digest(resolved),
      claim: digest(claimed),
    },
    raw: { resolved, claimed },
  };
}
