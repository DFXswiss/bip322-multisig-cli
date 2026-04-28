# bip322-multisig-cli

CLI to register a Bitcoin **P2WSH multisig** wallet at the DFX `/auth` endpoint using **Sparrow** as the PSBT signer.

Sparrow's *Sign/Verify Message* dialog [does not support multisig wallets](https://github.com/sparrowwallet/sparrow/issues/193) — but Sparrow signs multisig **PSBTs** perfectly, which is what this tool exploits. It builds a BIP-322 `to_sign` PSBT, you sign it through the regular Sparrow flow with your hardware wallets, and the tool extracts the resulting witness as a BIP-322 *simple* signature and submits it to DFX.

## Install

```bash
npm install
```

Requires Node ≥ 18.

## Usage

### 1. Build the BIP-322 to_sign PSBT

```bash
node bin/sign.js \
  --descriptor 'wsh(sortedmulti(2,[fp1/48h/0h/0h/2h]xpub.../<0;1>/*,[fp2/48h/0h/0h/2h]xpub.../<0;1>/*,[fp3/48h/0h/0h/2h]xpub.../<0;1>/*))' \
  --address bc1q... \
  --out tosign.psbt
```

The descriptor must be the full DFX-style `wsh(sortedmulti(...))` descriptor with key origin info (master fingerprint + derivation path + xpub) for each cosigner. Sparrow exports it via *Settings → Show wallet info → Export → Output Descriptor*.

`--address` selects which child of the descriptor to register. The tool searches receive (`/0/*`) and change (`/1/*`) branches up to `--max-index` (default 200).

### 2. Sign in Sparrow

1. *File → Open Transaction* → select `tosign.psbt`
2. Sparrow shows a 0-sat OP_RETURN transaction. **This is correct for BIP-322** — the transaction is never broadcast; only the signature witness is used.
3. Sign with the threshold number of cosigners.
4. *File → Save Transaction* → `signed.psbt`

> ℹ️ Hardware wallet support for BIP-322-style PSBTs varies. Coldcard has dedicated BIP-322 mode; BitBox02 accepts since recent firmware; Ledger and Trezor may refuse the OP_RETURN-only output. If one signer refuses, try a different combination of cosigners.

### 3. Finalize and submit to DFX

```bash
node bin/finalize.js --psbt signed.psbt --address bc1q...
```

Outputs the BIP-322 simple signature (Base64) and POSTs it to `https://api.dfx.swiss/v1/auth`. Returns the JWT access token.

Use `--no-submit` to only print the signature without contacting DFX, or `--api http://localhost:3000` for a local backend.

## How it works

BIP-322 defines two virtual transactions: `to_spend` commits the message to the address; `to_sign` spends the dummy output of `to_spend`. The simple signature is just the witness stack of `to_sign`'s input, base64-encoded.

This tool builds `to_sign` as a regular PSBT with all the BIP32 derivation paths Sparrow needs to dispatch to the hardware wallet cosigners. Sparrow handles the multisig orchestration; the tool extracts the result.

## License

MIT
