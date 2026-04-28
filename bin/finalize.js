#!/usr/bin/env node
'use strict';

const fs = require('fs');
const bitcoin = require('bitcoinjs-lib');
const ecc = require('@bitcoinerlab/secp256k1');

bitcoin.initEccLib(ecc);

function usage() {
  console.error(`Usage: node finalize.js --psbt <file> --address <bc1q...> [--api <baseUrl>] [--no-submit]

Reads a signed BIP-322 PSBT (from Sparrow), extracts the witness, base64-encodes
it as a BIP-322 simple signature, and POSTs it to DFX /v1/auth.
Defaults: --api https://api.dfx.swiss`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = { api: 'https://api.dfx.swiss', submit: true };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--psbt') { args.psbt = v; i++; }
    else if (k === '--address') { args.address = v; i++; }
    else if (k === '--api') { args.api = v.replace(/\/$/, ''); i++; }
    else if (k === '--no-submit') { args.submit = false; }
    else { console.error(`Unknown arg: ${k}`); usage(); }
  }
  if (!args.psbt || !args.address) usage();
  return args;
}

function loadPsbt(file) {
  const raw = fs.readFileSync(file);
  const txt = raw.toString('utf8').trim();
  if (txt.startsWith('cHNidP') || /^[A-Za-z0-9+/=]+$/.test(txt)) {
    return bitcoin.Psbt.fromBase64(txt);
  }
  return bitcoin.Psbt.fromBuffer(raw);
}

function extractWitnessBase64(psbt) {
  const input = psbt.data.inputs[0];
  if (input.finalScriptWitness) {
    return input.finalScriptWitness.toString('base64');
  }
  try {
    psbt.finalizeInput(0);
  } catch (e) {
    throw new Error(`PSBT not finalizable: ${e.message}`);
  }
  const finalized = psbt.data.inputs[0].finalScriptWitness;
  if (!finalized) throw new Error('No finalScriptWitness after finalize');
  return finalized.toString('base64');
}

async function postAuth(apiBase, address, signature) {
  const url = `${apiBase}/v1/auth`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address, signature }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`auth failed: ${res.status} ${text}`);
  return JSON.parse(text);
}

async function main() {
  const args = parseArgs(process.argv);
  const psbt = loadPsbt(args.psbt);
  console.log(`✓ PSBT loaded (${psbt.data.inputs.length} inputs)`);

  const sigB64 = extractWitnessBase64(psbt);
  console.log(`✓ BIP-322 simple signature (${sigB64.length} chars):`);
  console.log(sigB64);

  if (!args.submit) {
    console.log('\n--no-submit set: skipping POST');
    return;
  }

  console.log(`\n→ POST ${args.api}/v1/auth ...`);
  const r = await postAuth(args.api, args.address, sigB64);
  console.log(`✓ Authenticated. accessToken:\n${r.accessToken}`);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
