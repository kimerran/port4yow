---
title: "Lantern"
tagline: "The security-first Stellar wallet \u2014 Chrome MV3 extension and Android"
summary: "Stops the approve-what-you-cannot-read drain: an on-device risk verdict gates every signature, and guardians can recover an account but never spend from it."
category: "Systems & backend"
sequence: 11
cover: ../../assets/projects/lantern.jpg
coverAlt: "Lantern's mobile screens side by side \u2014 home, settings, activity and earn \u2014 from the single TypeScript codebase shared with the browser extension."
stack:
  - "TypeScript"
  - "React 18"
  - "Tailwind CSS"
  - "Vite"
  - "@crxjs/vite-plugin (MV3)"
  - "Capacitor (Android)"
  - "@stellar/stellar-sdk 16"
  - "Soroban"
  - "SEP-1/10/24"
  - "bip39 + SEP-0005 HD derivation"
  - "Web Crypto (AES-GCM / PBKDF2)"
  - "Rust"
  - "Vitest"
liveUrl: "https://lantern.artisam.xyz/"
badge: "Hackathon Project"
---

## What it is

Lantern is a non-custodial Stellar wallet that ships as a Chrome MV3 extension and an Android app
from one TypeScript/React codebase. Every signature — payment, trustline, signer change or Soroban
contract call — passes the same scan → explain → confirm → sign gate, so users read what a
transaction really does before approving it. It also adds guardian social recovery on native
multisig, SEP-24 fiat cash in/out, swaps and Blend lending.

## Value

- Stops the "approve what you can't read" drain — an on-device risk verdict gates every signature.
- Kills the seed-phrase failure mode — guardians can recover an account, never spend from it.
- Turns Stellar's primitives — anchors, multisig, Soroban — into first-class wallet flows.

## Technology highlights

- **On-device transaction risk engine** — decodes and explains each operation, assigns a risk
  verdict, and gates high-risk signing behind type-CONFIRM. No cloud scanner in the trust path.
- **Guardian recovery on native multisig** — recovery built from Stellar weighted multisig and
  out-of-band co-signing, plus secp256r1 passkey smart accounts on Soroban.
