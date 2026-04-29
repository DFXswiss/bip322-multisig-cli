#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { default: BIP322 } = require('bip322-js/dist/BIP322');
const bitcoin = require('bitcoinjs-lib');
const { BIP32Factory } = require('bip32');
const ecc = require('@bitcoinerlab/secp256k1');
const { bech32 } = require('bech32');

const bip32 = BIP32Factory(ecc);
bitcoin.initEccLib(ecc);

function usage() {
  console.error(`Usage: node sign.js --descriptor <descriptor> --address <bc1q...> [--api <baseUrl>] [--out <file>] [--max-index <N>]

Builds a BIP-322 to_sign PSBT for the given P2WSH multisig address.
Defaults: --api https://api.dfx.swiss --out bip322-tosign.psbt --max-index 200

Output: base64 PSBT written to --out, ready to be opened in Sparrow.
After signing in Sparrow, run finalize.js with the resulting PSBT.`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { api: 'https://api.dfx.swiss', out: 'bip322-tosign.psbt', maxIndex: 200 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--descriptor') { args.descriptor = v; i++; }
    else if (k === '--address') { args.address = v; i++; }
    else if (k === '--api') { args.api = v.replace(/\/$/, ''); i++; }
    else if (k === '--out') { args.out = v; i++; }
    else if (k === '--max-index') { args.maxIndex = parseInt(v, 10); i++; }
    else { console.error(`Unknown arg: ${k}`); usage(); }
  }
  if (!args.descriptor || !args.address) usage();
  return args;
}

function parseDescriptor(desc) {
  const m = desc.match(/^wsh\(sortedmulti\((\d+),(.+)\)\)(?:#[a-z0-9]{8})?$/i);
  if (!m) throw new Error('Only wsh(sortedmulti(...)) descriptors are supported');
  const threshold = parseInt(m[1], 10);
  const keyParts = splitTopLevel(m[2]);
  const keys = keyParts.map(parseKeyPart);
  return { threshold, keys };
}

function splitTopLevel(s) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(buf); buf = ''; continue; }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

function parseKeyPart(s) {
  const m = s.match(/^\[([0-9a-f]{8})((?:\/[0-9]+h?)+)\](xpub[1-9A-HJ-NP-Za-km-z]+)(?:\/<([0-9]+);([0-9]+)>)?(?:\/(\*|\d+))?$/i);
  if (!m) throw new Error(`Cannot parse key part: ${s}`);
  return {
    fingerprint: m[1].toLowerCase(),
    originPath: m[2].replace(/^\//, ''),
    xpub: m[3],
    receiveBranch: m[4] !== undefined ? parseInt(m[4], 10) : 0,
    changeBranch: m[5] !== undefined ? parseInt(m[5], 10) : 1,
  };
}

function pathToArray(s) {
  return s.split('/').map((p) => {
    const hard = p.endsWith('h') || p.endsWith("'");
    const n = parseInt(hard ? p.slice(0, -1) : p, 10);
    return hard ? (n + 0x80000000) >>> 0 : n;
  });
}

function buildWitnessScript(pubkeys, threshold) {
  const sorted = [...pubkeys].sort(Buffer.compare);
  const parts = [Buffer.from([0x50 + threshold])];
  for (const pk of sorted) parts.push(Buffer.from([0x21]), pk);
  parts.push(Buffer.from([0x50 + sorted.length, 0xae]));
  return Buffer.concat(parts);
}

function p2wshAddress(witnessScript) {
  const h = crypto.createHash('sha256').update(witnessScript).digest();
  const words = [0, ...bech32.toWords(h)];
  return bech32.encode('bc', words);
}

function findChild(keys, targetAddress, maxIndex) {
  const nodes = keys.map((k) => bip32.fromBase58(k.xpub));
  for (const branch of [keys[0].receiveBranch, keys[0].changeBranch]) {
    for (let i = 0; i < maxIndex; i++) {
      const childPubs = nodes.map((n) => n.derive(branch).derive(i).publicKey);
      const ws = buildWitnessScript(childPubs, 2);
      if (p2wshAddress(ws) === targetAddress) {
        return { branch, index: i, pubkeys: childPubs, witnessScript: ws };
      }
    }
  }
  return null;
}

async function fetchChallenge(apiBase, address) {
  const url = `${apiBase}/v1/auth/signMessage?address=${encodeURIComponent(address)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`signMessage failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  const args = parseArgs(process.argv);
  const desc = parseDescriptor(args.descriptor);
  if (desc.threshold !== 2) {
    console.error(`Warning: threshold is ${desc.threshold}, tool tested for 2-of-N`);
  }

  const found = findChild(desc.keys, args.address, args.maxIndex);
  if (!found) throw new Error(`Address ${args.address} not derivable from descriptor in first ${args.maxIndex} indices`);

  console.log(`✓ Address derived at /${found.branch}/${found.index}`);

  const challenge = await fetchChallenge(args.api, args.address);
  console.log(`✓ Challenge: ${challenge.message}`);

  const program = crypto.createHash('sha256').update(found.witnessScript).digest();
  const scriptPubKey = Buffer.concat([Buffer.from([0x00, 0x20]), program]);

  const toSpend = BIP322.buildToSpendTx(challenge.message, scriptPubKey);
  const toSpendTxid = toSpend.getId();
  console.log(`✓ to_spend.txid: ${toSpendTxid}`);

  const psbt = new bitcoin.Psbt();
  psbt.setVersion(0);
  psbt.setLocktime(0);

  const bip32Derivation = desc.keys.map((k, idx) => ({
    masterFingerprint: Buffer.from(k.fingerprint, 'hex'),
    path: `m/${k.originPath.replace(/h/g, "'")}/${found.branch}/${found.index}`,
    pubkey: found.pubkeys[idx],
  }));

  psbt.addInput({
    hash: toSpendTxid,
    index: 0,
    sequence: 0,
    witnessUtxo: { script: scriptPubKey, value: 0 },
    witnessScript: found.witnessScript,
    sighashType: bitcoin.Transaction.SIGHASH_ALL,
    bip32Derivation,
    nonWitnessUtxo: toSpend.toBuffer(),
  });

  psbt.addOutput({ value: 0, script: Buffer.from([0x6a]) });

  const psbtB64 = psbt.toBase64();
  fs.writeFileSync(args.out, psbtB64);
  console.log(`✓ Written: ${path.resolve(args.out)}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Open Sparrow → File → Open Transaction → select ${args.out}`);
  console.log(`  2. Sign with 2 of 3 cosigners (the OP_RETURN warning is expected for BIP-322)`);
  console.log(`  3. Sparrow → File → Save Transaction → choose .psbt`);
  console.log(`  4. Run: node finalize.js --psbt <signed.psbt> --address ${args.address}`);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
