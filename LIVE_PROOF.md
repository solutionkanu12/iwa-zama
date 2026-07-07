# Live end-to-end proof on Sepolia

This records a real, two-wallet end-to-end run of the confidential savings
circle on Sepolia (not the local mock). It exercises the full encrypted path:
two wallets join a circle, each submits an FHE-encrypted contribution, the
contract auto-releases the payout when the round fills, and each member's
encrypted reliability is decrypted only by that member. Reproduce it with
`scripts/liveTwoWallet.ts`.

## Setup

- Network: Sepolia, chainId 11155111
- IwaCircle: `0xFd4B38Cf46Cf74841634596153fd9F4c8f1eD362`
- ConfidentialToken: `0xEE4335082628Cdfa7C07860e919Ce4b0e4DD77FB`
- Circle id: 7 (2 members, 1h round window)
- Wallet A (deployer): `0x022219f36a76cf1d9e7d1DD6b473Bc81cc0dc8dc`
- Wallet B (generated, deployer-funded): `0xbf21ea5f3604E9EBf0664D18b41Ba2ae3a5f94fd`

## Transactions

| Step | Tx |
| --- | --- |
| A joins (creates circle 7) | `0x2fb7d1f18f01bc4b6377a68d637135158054de735fbb473f0bbf07d96f645e35` |
| B joins (fills, activates) | `0x997ba9d2e318cea2f5af08674dc1144513673cabec99c223b8a4a3865664396b` |
| A encrypted contribution | `0x62185253b1209a5fc0f221b223a744128c23f3e180b0bdbf09180bbd0a9cc11c` |
| B encrypted contribution (completes round 0) | `0xfc0377181e632fe5b648113bb4cd61e3e56e8122955e6e0ff489f769d057b219` |

Each contribution amount is encrypted client-side into an external `euint64`
handle plus input proof before it is sent; the cleartext amount never goes
on chain.

## Automatic payout, no admin call

The `PayoutReleased` event fires **inside** wallet B's contribution transaction
`0xfc0377…`, in the same transaction that completed the round:

```
PayoutReleased: round 0 -> recipient 0x022219f36a76cf1d9e7d1DD6b473Bc81cc0dc8dc  (== members[0])
```

After it, `getCircleProgress(7)` reports `currentRound: 1, roundsCompleted: 1`.
No organizer or admin function was called to release the pot; the contract
released it on the completing contribution.

## Real, member-only reliability

Each member user-decrypted their own reliability score via the EIP-712 flow:

```
wallet A reliability (decrypted by A): 1
wallet B reliability (decrypted by B): 1
```

Both are non-zero because both contributed on time.

The score is decryptable **only** by its owner:

```
isReliabilityDecryptableBy(circle 7, A, byA): true
isReliabilityDecryptableBy(circle 7, A, byB): false
```

And a real user-decrypt attempt by the other member is rejected by the
coprocessor ACL:

```
wallet B attempt to decrypt wallet A's reliability -> denied: true
  rejected with: User address 0xbf21ea5f3604E9EBf0664D18b41Ba2ae3a5f94fd is not
  authorized to user decrypt handle 0xbd92a5e86ed5b174367547099b9f408901905e451
```

## Reproduce

```
NODE_OPTIONS=--dns-result-order=ipv4first \
  CIRCLE_ID=7 npx hardhat run scripts/liveTwoWallet.ts --network sepolia
```

The script is idempotent (skips joins/operator grants already in place) and
retries the intermittent WSL connect timeouts, so a transient network blip does
not spoil the run.
