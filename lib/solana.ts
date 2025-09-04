// lib/solana.ts
import type { SolanaCaip2ChainId } from "@privy-io/server-auth";

type Cluster = "mainnet-beta" | "testnet" | "devnet";

// Official CAIP-2 ids for Solana clusters.
// NOTE: devnet string must include the "i" after Yq6  ⬇️
const CAIP2_BY_CLUSTER: Record<Cluster, SolanaCaip2ChainId> = {
  "mainnet-beta": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  testnet: "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z",
  devnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
};

export function getCaip2(): SolanaCaip2ChainId {
  const cluster = (process.env.SOLANA_CLUSTER ?? "devnet") as Cluster;
  return CAIP2_BY_CLUSTER[cluster];
}
