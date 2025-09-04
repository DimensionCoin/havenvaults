"use client";

import { useCallback, useState } from "react";
import {
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { useSolanaWallets } from "@privy-io/react-auth/solana";

type TransferInput = {
  fromOwner: string | PublicKey; // user wallet (authority)
  toOwner: string | PublicKey; // other user wallet
  totalAmountUi: number; // total USDC entered (fee is taken from this)
  accessToken?: string | null; // optional bearer; cookie fallback works too
  backendUrl?: string; // defaults to /api/relay
};

const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC!;
const USDC_MINT = new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT!);
const HAVEN_FEEPAYER = new PublicKey(
  process.env.NEXT_PUBLIC_HAVEN_FEEPAYER_ADDRESS!
);
const TREASURY_OWNER = new PublicKey(
  process.env.NEXT_PUBLIC_APP_TREASURY_OWNER!
);

const DECIMALS = 6;
const FEE_UI = 0.02;

export function useSponsoredUsdcTransfer() {
  const [loading, setLoading] = useState(false);
  const [lastSig, setLastSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { wallets } = useSolanaWallets();

  const send = useCallback(
    async (input: TransferInput) => {
      setLoading(true);
      setError(null);
      setLastSig(null);

      try {
        const from =
          input.fromOwner instanceof PublicKey
            ? input.fromOwner
            : new PublicKey(input.fromOwner);

        const to =
          input.toOwner instanceof PublicKey
            ? input.toOwner
            : new PublicKey(input.toOwner);

        const total = Number(input.totalAmountUi);
        if (!Number.isFinite(total) || total <= FEE_UI) {
          throw new Error("Enter an amount greater than the 0.02 USDC fee.");
        }

        // find the matching embedded wallet by address to sign the message
        const fromBase58 = from.toBase58();
        const userWallet = wallets.find((w) => w.address === fromBase58);
        if (!userWallet)
          throw new Error("Source wallet not available in this session.");

        const connection = new Connection(RPC, "confirmed");

        // Detect token program (SPL Token vs Token-2022) from the mint owner
        const mintInfo = await connection.getAccountInfo(USDC_MINT);
        if (!mintInfo) throw new Error("USDC mint not found on chain.");
        const tokenProgramId = mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID)
          ? TOKEN_2022_PROGRAM_ID
          : TOKEN_PROGRAM_ID;

        // Derive ATAs
        const fromAta = getAssociatedTokenAddressSync(
          USDC_MINT,
          from,
          false,
          tokenProgramId
        );
        const toAta = getAssociatedTokenAddressSync(
          USDC_MINT,
          to,
          false,
          tokenProgramId
        );
        const treasuryAta = getAssociatedTokenAddressSync(
          USDC_MINT,
          TREASURY_OWNER,
          false,
          tokenProgramId
        );

        // Build instructions:
        // - Idempotent create ATAs for destination + treasury (fee payer = Haven)
        //   (We do NOT create the 'from' ATA; if it didn't exist, user wouldn't have funds.)
        const ixs = [
          createAssociatedTokenAccountIdempotentInstruction(
            HAVEN_FEEPAYER,
            toAta,
            to,
            USDC_MINT,
            tokenProgramId
          ),
          createAssociatedTokenAccountIdempotentInstruction(
            HAVEN_FEEPAYER,
            treasuryAta,
            TREASURY_OWNER,
            USDC_MINT,
            tokenProgramId
          ),
        ];

        // - Transfers (user authority signs)
        const toUnits = (ui: number) => Math.round(ui * 1_000_000); // 6dp
        const fee = toUnits(FEE_UI);
        const net = toUnits(total) - fee;

        ixs.push(
          createTransferCheckedInstruction(
            fromAta,
            USDC_MINT,
            toAta,
            from,
            net,
            DECIMALS,
            [],
            tokenProgramId
          ),
          createTransferCheckedInstruction(
            fromAta,
            USDC_MINT,
            treasuryAta,
            from,
            fee,
            DECIMALS,
            [],
            tokenProgramId
          )
        );

        // Build v0 tx with Haven as payer and a LIVE blockhash (user is signing this message)
        const { blockhash } = await connection.getLatestBlockhash("finalized");
        const msg = new TransactionMessage({
          payerKey: HAVEN_FEEPAYER,
          recentBlockhash: blockhash,
          instructions: ixs,
        }).compileToV0Message();

        const tx = new VersionedTransaction(msg);

        // Ask Privy embedded wallet to sign the MESSAGE (not send)
        const provider = await userWallet.getProvider();
        const serializedMessageB64 = Buffer.from(
          tx.message.serialize()
        ).toString("base64");
        const { signature: userSigB64 } = await provider.request({
          method: "signMessage",
          params: { message: serializedMessageB64 },
        });

        // Attach user's signature to the tx (at the correct signer position)
        const userSig = Buffer.from(userSigB64, "base64");
        tx.addSignature(from, userSig);

        // Send to backend so Haven can countersign (fee payer) and broadcast
        const body = JSON.stringify({
          transaction: Buffer.from(tx.serialize()).toString("base64"),
        });

        // bearer (optional – your API can also read privy-token cookie)
        const headers: HeadersInit = input.accessToken
          ? {
              "Content-Type": "application/json",
              Authorization: `Bearer ${input.accessToken}`,
            }
          : { "Content-Type": "application/json" };

        const res = await fetch(input.backendUrl ?? "/api/relay", {
          method: "POST",
          headers,
          body,
          credentials: "include", 
        });

        const j = (await res.json()) as { signature?: string; error?: string };
        if (!res.ok || !j.signature)
          throw new Error(j.error ?? `HTTP ${res.status}`);

        setLastSig(j.signature);
        return j.signature;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [wallets]
  );

  return { send, loading, lastSig, error };
}
