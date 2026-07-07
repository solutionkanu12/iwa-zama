# Iwa

Iwa is a confidential rotating savings circle, an ajo, built on Zama's FHEVM. Members join a circle, contribute on a schedule, and the contract keeps track of how reliable each member is, their on-time contributions and their streaks, entirely in encrypted form. The amount a member contributes and the reliability score derived from it are never public. When a round is fully funded the payout is released automatically, so there is no organizer who has to trigger or approve it.

This project was submitted to the Zama Developer Program Season 3, Builder Track.

## What it does

A member joins a circle and contributes a fixed amount each round through a confidential token. Every contribution updates an encrypted reliability counter that only the member can read for themselves. The contract knows whether a contribution arrived on time and it keeps an encrypted streak, but it never exposes those numbers to anyone else. Once every member of a round has contributed, the pot is released to that round's recipient without anyone stepping in to approve it.

## Composable privacy, the part that matters

The technical heart of Iwa is a second contract, IwaTrustGate. It reads a member's encrypted reliability score directly out of IwaCircle and compares it against a threshold, and it does the whole comparison in encrypted space. The result is an encrypted approval, a yes or no that only a party the member has explicitly authorized can decrypt. No decryption happens anywhere in that comparison. The score is never revealed, not to the gate, not to the caller, not on chain.

This is what composable privacy means in practice. One contract acts on another contract's encrypted data and produces a useful answer, and the underlying value stays encrypted the entire time. Acting on encrypted data across contracts is the explicit theme of this season, and IwaTrustGate is a direct demonstration of it.

## What is private and what is not

It is worth being precise about this. Iwa runs on a public chain, so wallet addresses are visible, and the fact that a given wallet took part in a circle is visible, the same as any Ethereum transaction. That part is not hidden, and Iwa does not claim it is.

What stays private is the amount a member contributes and the reliability score derived from their history. Those values are encrypted with FHE and are only ever readable by the member, or by someone the member explicitly authorizes for a specific check. The point of Iwa is not to hide that you are saving. It is to keep your amounts and your standing confidential while still letting you prove your standing when you choose to.

## Contract addresses

Deployed on Sepolia, chainId 11155111.

| Contract | Address |
| --- | --- |
| IwaCircle | 0x6873600208829a7AF5df198b6Bf51433A266baB8 |
| IwaTrustGate | 0x7C494731cCb9bbEE76D60ECee45A08324e0Ca380 |

## Repository

The contracts live in `contracts/`, with IwaCircle and IwaTrustGate at the top level and a demo confidential token under `mocks/`. Tests are in `test/` and deployment scripts in `scripts/`. It is a Hardhat project using Zama's FHEVM plugin, so `npm run compile` builds the contracts and `npm run deploy:sepolia` deploys them. The web frontend is a Vite and React app in `web/`.

## Origin

Iwa started as a Stellar based version that used zero-knowledge proofs to prove a member's reliability. It was rebuilt on Zama's FHEVM for this hackathon because FHE lets a second contract act on the encrypted reliability score directly, with no proof object to generate and no decryption step in between. That fits this season's composability theme better than the proof based approach did, and it made the trust gate simpler and more honest to build.
