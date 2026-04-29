# bip322-multisig-cli

> **⚠️ This repository has moved.**
>
> The CLI has been consolidated into the [`@dfx.swiss/bip322-multisig`](https://github.com/DFXswiss/packages/tree/develop/packages/bip322-multisig) package, which now provides **both** the library and the CLI binaries from a single source of truth.

## New usage

```bash
npm install -g @dfx.swiss/bip322-multisig
bip322-sign --descriptor 'wsh(sortedmulti(2,...))' --address bc1q...
# … sign in Sparrow …
bip322-finalize --psbt signed.psbt --address bc1q...
```

The package also exposes a JavaScript / TypeScript API:

```ts
import { buildBip322Psbt, extractBip322Signature } from '@dfx.swiss/bip322-multisig';
```

## Why the move?

This standalone repo was an intermediate step. Once a shared package was created in [`DFXswiss/packages`](https://github.com/DFXswiss/packages) for both the upcoming services frontend integration and the CLI to consume, keeping a separate CLI repo with duplicated logic added no value. The package is now the single source of truth.

## Status

- New issues and pull requests should go to [`DFXswiss/packages`](https://github.com/DFXswiss/packages).
- This repository is read-only and may be archived.
