import { useCallback, useEffect, useRef, useState } from "react";
import {
  classifyContractError,
  contribute,
  get_circle,
  get_reputation,
  has_contributed,
  join_circle,
} from "../lib/iwaContract.ts";
import {
  connectWallet,
  disconnectWallet,
  discoverWallets,
  getWalletClient,
  WalletCancelledError,
  type DiscoveredWallet,
} from "../lib/wallet.ts";
import {
  DEMO_CIRCLE_ID,
  tokenSymbol,
  tokenDecimals,
} from "../lib/sepoliaConfig.ts";
import { formatAmount } from "../lib/amount.ts";
import type { Circle, Reputation } from "../lib/types.ts";
import { Island } from "../components/Island.tsx";
import { Button } from "../components/Button.tsx";
import { ProveView } from "./ProveView.tsx";
import { CreateCircleView } from "./CreateCircleView.tsx";
import { BrowseCirclesView } from "./BrowseCirclesView.tsx";
import styles from "./CircleView.module.css";

// Flow 1 (the circle view) and Flow 2 (contribute), matched to
// design/iwa-prototype.html. Connect gate first (MetaMask on Sepolia), then the
// circle screen from get_circle. Contribute opens a confirm step that encrypts
// the amount on this device and calls IwaCircle.contribute. Payout is automatic
// when a round completes, so there is no manual collect step.

const PRIVACY_LINE =
  "Your contribution amounts and your reliability score stay encrypted on chain. Only your good standing can be proven, and only by you.";

// Map a failed contribution to an honest, specific message rather than a
// catch-all.
function payErrorMessage(err: unknown): string {
  switch (classifyContractError(err)) {
    case "AlreadyContributedThisRound":
      return "You have already contributed this round.";
    case "NotAMember":
      return "Join the circle before contributing.";
    case "CircleNotActive":
      return "This round is not open for contributions.";
    case "Declined":
      return "Signature was declined.";
    default:
      return "Could not contribute. Please try again.";
  }
}

// Map a failed join to an honest, specific message.
function joinErrorMessage(err: unknown): string {
  switch (classifyContractError(err)) {
    case "AlreadyMember":
      return "You have already joined this circle.";
    case "CircleFull":
      return "This circle is already full.";
    case "Declined":
      return "Signature was declined.";
    default:
      return "Could not join the circle. Please try again.";
  }
}

// Short middle-truncation for addresses and tx ids.
function short(s: string): string {
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

// Collector for a round follows the savings contract rule:
// members[(round - 1) % size]. It is your turn when that seat is yours.
function collectorSlotOf(circle: Circle): number {
  return (circle.current_round - 1) % circle.size;
}

// The small cowrie glyph used as the app mark.
function NavGlyph() {
  return (
    <svg width="22" height="24" viewBox="0 0 60 70" aria-hidden="true">
      <ellipse cx="30" cy="36" rx="20" ry="26" fill="#B6A6F2" />
      <ellipse cx="25" cy="29" rx="11" ry="15" fill="#CECBF6" opacity=".8" />
      <path d="M30 12C34 30 34 42 30 60C26 42 26 30 30 12Z" fill="#F6F4FC" />
    </svg>
  );
}

// The cowrie seal (inline SVG for now, replaced with a polished asset later).
function CowrieSeal() {
  return (
    <svg
      className={styles.cowrieSvg}
      viewBox="-24 -20 248 264"
      width="100%"
      role="img"
      aria-label="Cowrie seal"
    >
      <ellipse cx="108" cy="132" rx="58" ry="74" fill="#AFA9EC" opacity=".55" />
      <ellipse cx="100" cy="110" rx="62" ry="80" fill="#B6A6F2" />
      <ellipse cx="86" cy="90" rx="38" ry="52" fill="#CECBF6" opacity=".75" />
      <path d="M100 40C110 80 110 140 100 180C90 140 90 80 100 40Z" fill="#F6F4FC" />
      <g stroke="#8d80c4" strokeWidth="2.4" strokeLinecap="round" opacity=".7">
        <line x1="93" y1="66" x2="85" y2="66" />
        <line x1="107" y1="66" x2="115" y2="66" />
        <line x1="92" y1="86" x2="83" y2="86" />
        <line x1="108" y1="86" x2="117" y2="86" />
        <line x1="91" y1="108" x2="82" y2="108" />
        <line x1="109" y1="108" x2="118" y2="108" />
        <line x1="92" y1="130" x2="83" y2="130" />
        <line x1="108" y1="130" x2="117" y2="130" />
        <line x1="93" y1="152" x2="85" y2="152" />
        <line x1="107" y1="152" x2="115" y2="152" />
      </g>
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      className={styles.lk}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#6D4DF2"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function CheckIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      aria-hidden="true"
    >
      <path d="M5 12l4 4 10-10" />
    </svg>
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// Count a figure up to its target on mount. Respects reduced motion (jumps
// straight to the value).
function useCountUp(target: number, durationMs: number): number {
  const [value, setValue] = useState(() =>
    prefersReducedMotion() ? target : 0,
  );
  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / durationMs, 1);
      setValue(Math.round(target * p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

function StandingCard({
  reputation,
  onGenerate,
}: {
  reputation: Reputation;
  onGenerate: () => void;
}) {
  const cycles = useCountUp(reputation.completedCycles, 600);
  const onTime = useCountUp(reputation.onTimeRate, 750);
  const noLate = reputation.lateCount === 0;
  const fullyOnTime = reputation.onTimeRate === 100;
  return (
    <Island className={styles.card}>
      <h2 className={styles.h2}>Your standing</h2>
      <p className={styles.meta}>
        Private to you. Nothing here is shared until you choose to prove it.
      </p>

      <div className={styles.bignum}>
        <span className={styles.bignumN}>{cycles}</span>
        <span className={styles.bignumU}>cycles completed</span>
      </div>

      <div className={styles.statline}>
        <div className={styles.stat}>
          <div
            className={`${styles.statN} ${fullyOnTime ? styles.statGood : ""}`}
          >
            {onTime}%
          </div>
          <div className={styles.statL}>on time</div>
        </div>
        <div className={styles.stat}>
          <div className={`${styles.statN} ${noLate ? styles.statGood : ""}`}>
            {reputation.lateCount}
          </div>
          <div className={styles.statL}>late</div>
        </div>
      </div>

      <p className={`${styles.mono} ${styles.standingSummary}`}>
        {reputation.completedCycles} cycles · {reputation.onTimeRate}% on time ·{" "}
        {reputation.lateCount} late
      </p>

      <div className={styles.stack}>
        <Button onClick={onGenerate}>Generate proof</Button>
      </div>
    </Island>
  );
}

function AppNav({
  address,
  section,
  onCircle,
  onBrowse,
  onStanding,
  onCreate,
  onDisconnect,
}: {
  address: string | null;
  section: "circle" | "browse" | "standing" | "create";
  onCircle: () => void;
  onBrowse: () => void;
  onStanding: () => void;
  onCreate: () => void;
  onDisconnect: () => void;
}) {
  const enabled = !!address;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the wallet menu when clicking anywhere outside it.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  return (
    <>
      <Island className={styles.appNav}>
        <div className={styles.navL}>
          <NavGlyph />
          <span className={styles.nm}>Iwa</span>
        </div>
        <div className={styles.tabs} role="tablist" aria-label="App sections">
          <button
            type="button"
            className={`${styles.tab} ${section === "circle" ? styles.tabActive : ""}`}
            role="tab"
            aria-selected={section === "circle"}
            onClick={onCircle}
            disabled={!enabled}
          >
            Circle
          </button>
          <button
            type="button"
            className={`${styles.tab} ${section === "browse" ? styles.tabActive : ""}`}
            role="tab"
            aria-selected={section === "browse"}
            onClick={onBrowse}
            disabled={!enabled}
          >
            Browse
          </button>
          <button
            type="button"
            className={`${styles.tab} ${section === "standing" ? styles.tabActive : ""}`}
            role="tab"
            aria-selected={section === "standing"}
            onClick={onStanding}
            disabled={!enabled}
          >
            My standing
          </button>
          <button
            type="button"
            className={`${styles.tab} ${section === "create" ? styles.tabActive : ""}`}
            role="tab"
            aria-selected={section === "create"}
            onClick={onCreate}
            disabled={!enabled}
          >
            New circle
          </button>
        </div>
        <div className={styles.walletSlot}>
          {address ? (
            <div className={styles.walletMenu} ref={menuRef}>
              <button
                type="button"
                className={styles.wallet}
                onClick={() => setMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <span className={styles.walletDot} />
                <span className={styles.walletAddr}>{short(address)}</span>
              </button>
              {menuOpen ? (
                <div className={styles.dropdown} role="menu">
                  <button
                    type="button"
                    className={styles.dropdownItem}
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onDisconnect();
                    }}
                  >
                    Disconnect
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Island>

      {/* Mobile-only bottom tab bar (native-app style). Hidden on desktop via
          CSS; a separate block from the top bar's tabs above, which are
          untouched and still render (hidden on mobile by CSS instead). */}
      <nav
        className={styles.bottomNav}
        role="tablist"
        aria-label="App sections"
      >
        <button
          type="button"
          className={`${styles.bottomTab} ${section === "circle" ? styles.bottomTabActive : ""}`}
          role="tab"
          aria-selected={section === "circle"}
          onClick={onCircle}
          disabled={!enabled}
        >
          Circle
        </button>
        <button
          type="button"
          className={`${styles.bottomTab} ${section === "browse" ? styles.bottomTabActive : ""}`}
          role="tab"
          aria-selected={section === "browse"}
          onClick={onBrowse}
          disabled={!enabled}
        >
          Browse
        </button>
        <button
          type="button"
          className={`${styles.bottomTab} ${section === "standing" ? styles.bottomTabActive : ""}`}
          role="tab"
          aria-selected={section === "standing"}
          onClick={onStanding}
          disabled={!enabled}
        >
          My standing
        </button>
        <button
          type="button"
          className={`${styles.bottomTab} ${section === "create" ? styles.bottomTabActive : ""}`}
          role="tab"
          aria-selected={section === "create"}
          onClick={onCreate}
          disabled={!enabled}
        >
          New circle
        </button>
      </nav>
    </>
  );
}

type Screen =
  | "circle"
  | "contribute"
  | "standing"
  | "prove"
  | "create"
  | "browse";
type Status = "idle" | "working" | "done";

export function CircleView({
  initialAddress = null,
}: {
  // Set when the wallet was already connected before this screen mounted
  // (the visitor connected from the landing page). Skips the connect gate
  // and picks up exactly where handleConnect would have left off.
  initialAddress?: string | null;
} = {}) {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [circle, setCircle] = useState<Circle | null>(null);

  // Installed wallets discovered via EIP-6963, so the member picks one instead
  // of the app grabbing whichever extension won the window.ethereum race.
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [walletsLoading, setWalletsLoading] = useState(true);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const [screen, setScreen] = useState<Screen>("circle");
  const [contribStatus, setContribStatus] = useState<Status>("idle");
  const [contribTx, setContribTx] = useState<string | null>(null);
  const [contribError, setContribError] = useState<string | null>(null);
  const [contribOnTime, setContribOnTime] = useState(true);
  const [alreadyPaid, setAlreadyPaid] = useState(false);
  const [joinStatus, setJoinStatus] = useState<Status>("idle");
  const [joinTx, setJoinTx] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [reputation, setReputation] = useState<Reputation | null>(null);

  // Whether the connected wallet has already contributed the circle's current
  // round, read from the contract, so we never offer a Contribute that will
  // revert with AlreadyPaid.
  const loadPaidStatus = useCallback(
    async (c: Circle, addr: string | null) => {
      if (!addr || c.size === 0) {
        setAlreadyPaid(false);
        return;
      }
      try {
        setAlreadyPaid(await has_contributed(c.id, addr));
      } catch {
        setAlreadyPaid(false);
      }
    },
    [],
  );

  // Everything that happens once we have an address, whether it came from a
  // connect click here or was already connected before this screen mounted.
  // The connected wallet address IS the member identity on IwaCircle, so there
  // is no separate commitment to derive.
  const finishConnect = useCallback(
    async (addr: string) => {
      // Real read: the circle state, composed from the deployed IwaCircle
      // contract on Sepolia.
      try {
        const c = await get_circle(DEMO_CIRCLE_ID, addr);
        setCircle(c);
        await loadPaidStatus(c, addr);
      } catch (err) {
        console.warn("circle read failed", err);
      } finally {
        setConnecting(false);
      }
    },
    [loadPaidStatus],
  );

  // Discover installed wallets when the connect gate is showing.
  useEffect(() => {
    if (address) return;
    let active = true;
    setWalletsLoading(true);
    discoverWallets().then((found) => {
      if (!active) return;
      setWallets(found);
      setWalletsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [address]);

  const handleConnect = useCallback(
    async (wallet?: DiscoveredWallet) => {
      setConnecting(true);
      setConnectingId(wallet?.info.uuid ?? "default");
      let addr: string;
      try {
        addr = await connectWallet(wallet);
      } catch (err) {
        // A cancelled modal is expected: stay on the connect gate, no crash.
        if (!(err instanceof WalletCancelledError)) {
          console.warn("wallet connect failed", err);
        }
        setConnecting(false);
        setConnectingId(null);
        return;
      }
      setAddress(addr);
      await finishConnect(addr);
    },
    [finishConnect],
  );

  // Picked up an already-connected wallet from the landing page: same
  // connectWallet() seam, already run there, so there is no second connect
  // prompt here. Runs once.
  const pickedUpInitialAddress = useRef(false);
  useEffect(() => {
    if (!initialAddress || pickedUpInitialAddress.current) return;
    pickedUpInitialAddress.current = true;
    setConnecting(true);
    setAddress(initialAddress);
    void finishConnect(initialAddress);
  }, [initialAddress, finishConnect]);

  const handleDisconnect = useCallback(async () => {
    await disconnectWallet();
    // Clear every piece of per-wallet state so a newly connected wallet is
    // evaluated fresh, with no stale membership or paid status.
    setAddress(null);
    setCircle(null);
    setConnecting(false);
    setConnectingId(null);
    setScreen("circle");
    setContribStatus("idle");
    setContribTx(null);
    setContribError(null);
    setContribOnTime(true);
    setAlreadyPaid(false);
    setJoinStatus("idle");
    setJoinTx(null);
    setJoinError(null);
    setReputation(null);
  }, []);

  const openContribute = useCallback(() => {
    setContribStatus("idle");
    setContribTx(null);
    setContribError(null);
    setScreen("contribute");
  }, []);

  const backToCircle = useCallback(() => setScreen("circle"), []);

  const join = useCallback(async () => {
    if (!circle || !address) return;
    setJoinStatus("working");
    setJoinError(null);

    // Joins on IwaCircle are open: membership is keyed by the wallet address, so
    // there is no proof of standing to attach. Trust is a separate flow (the
    // IwaTrustGate, reused on the prove screen).
    try {
      const r = await join_circle(circle.id, address);
      setJoinTx(r.txHash);
      setJoinStatus("done");
      // Refresh the circle so the newly filled slot (yours) shows.
      const c = await get_circle(circle.id, address);
      setCircle(c);
      await loadPaidStatus(c, address);
    } catch (err) {
      console.warn("join failed", err);
      setJoinError(joinErrorMessage(err));
      setJoinStatus("idle");
    }
  }, [circle, address, loadPaidStatus]);

  const goStanding = useCallback(async () => {
    setScreen("standing");
    if (reputation) return;
    // Real read: your reliability for this circle, user-decrypted on this device
    // (needs a wallet signature). If the wallet could not sign, show an all-zero
    // standing rather than crash.
    if (!circle || !address) {
      setReputation({ completedCycles: 0, onTimeRate: 0, lateCount: 0 });
      return;
    }
    try {
      const r = await get_reputation(circle.id, address, getWalletClient());
      setReputation(r);
    } catch (err) {
      console.warn("reputation read failed", err);
      setReputation({ completedCycles: 0, onTimeRate: 0, lateCount: 0 });
    }
  }, [reputation, circle, address]);

  const goProve = useCallback(() => setScreen("prove"), []);
  const backToStanding = useCallback(() => setScreen("standing"), []);
  const goCreate = useCallback(() => setScreen("create"), []);
  const goBrowse = useCallback(() => setScreen("browse"), []);

  // Load and switch to a circle by id (used after creating one). Resets the
  // transient per-circle state so nothing carries over from another circle.
  const goToCircle = useCallback(
    async (id: number) => {
      setScreen("circle");
      setJoinStatus("idle");
      setJoinTx(null);
      setJoinError(null);
      setContribStatus("idle");
      setContribTx(null);
      setContribError(null);
      setReputation(null);
      try {
        const c = await get_circle(id, address ?? undefined);
        setCircle(c);
        await loadPaidStatus(c, address);
      } catch (err) {
        console.warn("circle read failed", err);
      }
    },
    [address, loadPaidStatus],
  );

  const pay = useCallback(async () => {
    if (!circle || !address) return;
    setContribStatus("working");
    setContribError(null);
    try {
      // Encrypt the amount on this device and call IwaCircle.contribute. Payout
      // is automatic when the round completes, so there is no collect step.
      const r = await contribute(circle.id, BigInt(circle.amount), address);
      setContribTx(r.txHash);
      setContribOnTime(r.onTime);
      setContribStatus("done");
      setAlreadyPaid(true);
      // Re-read the circle so any state change shows.
      const c = await get_circle(circle.id, address);
      setCircle(c);
    } catch (err) {
      // Surface the real reason (already contributed, not a member, declined,
      // ...) instead of a catch-all balance message.
      console.warn("pay failed", err);
      setContribError(payErrorMessage(err));
      setContribStatus("idle");
    }
  }, [circle, address]);

  let body;
  if (!address) {
    body = (
      <Island className={`${styles.card} ${styles.cardCenter}`}>
        <div className={styles.seal}>
          <CowrieSeal />
        </div>
        <h2 className={`${styles.h2} ${styles.connectH2}`}>Join the circle</h2>
        <p className={styles.connectLede}>
          {wallets.length > 1
            ? "Choose a wallet to see the circle and claim your spot."
            : "Connect your wallet to see the circle and claim your spot."}
        </p>
        <div className={styles.stack}>
          {walletsLoading ? (
            <Button disabled>Detecting wallets</Button>
          ) : wallets.length > 0 ? (
            wallets.map((w) => (
              <Button
                key={w.info.uuid}
                onClick={() => handleConnect(w)}
                disabled={connecting}
              >
                <img
                  src={w.info.icon}
                  alt=""
                  aria-hidden="true"
                  width={18}
                  height={18}
                  style={{
                    verticalAlign: "middle",
                    marginRight: "8px",
                    borderRadius: "4px",
                  }}
                />
                {connecting && connectingId === w.info.uuid
                  ? "Connecting"
                  : `Connect ${w.info.name}`}
              </Button>
            ))
          ) : (
            <Button onClick={() => handleConnect()} disabled={connecting}>
              {connecting ? "Connecting" : "Connect wallet"}
            </Button>
          )}
        </div>
        <p className={`${styles.mono} ${styles.connectNote}`}>Sepolia testnet</p>
      </Island>
    );
  } else if (screen === "browse") {
    // Discovery does not depend on the demo circle, so it renders before the
    // circle-loading gate.
    body = <BrowseCirclesView onView={goToCircle} />;
  } else if (!circle) {
    body = (
      <Island className={styles.card}>
        <h2 className={styles.h2}>Loading your circle</h2>
        <p className={styles.meta}>Reading the circle from Sepolia</p>
      </Island>
    );
  } else if (screen === "contribute") {
    const sym = tokenSymbol(circle.token);
    const decimals = tokenDecimals(circle.token);
    body = (
      <Island className={styles.card}>
        <button type="button" className={styles.backBtn} onClick={backToCircle}>
          ‹ back to circle
        </button>
        <h2 className={styles.h2}>
          Round {circle.current_round} of {circle.size}
        </h2>
        <p className={styles.meta}>Contribute your fixed amount for this round.</p>

        <div className={styles.rows}>
          <div className={styles.row}>
            <span className={styles.k}>Amount</span>
            <span className={`${styles.v} ${styles.vBig}`}>
              {formatAmount(circle.amount, decimals)} {sym}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.k}>To</span>
            <span className={styles.v}>Weekly circle</span>
          </div>
          <div className={styles.row}>
            <span className={styles.k}>Status</span>
            <span className={`${styles.v} ${styles.statusMint}`}>on time</span>
          </div>
        </div>

        <div className={styles.promise}>
          <LockIcon />
          <p className={styles.promiseText}>{PRIVACY_LINE}</p>
        </div>

        {contribStatus !== "done" ? (
          <>
            <div className={styles.stack}>
              <Button
                onClick={pay}
                disabled={contribStatus === "working" || !address}
              >
                {contribStatus === "working"
                  ? "Contributing"
                  : `Contribute ${formatAmount(circle.amount, decimals)} ${sym}`}
              </Button>
            </div>
            {contribError ? (
              <p
                className={styles.meta}
                style={{ textAlign: "center", marginTop: "8px" }}
              >
                {contribError}
              </p>
            ) : null}
          </>
        ) : (
          <div className={styles.done}>
            <span className={`${styles.vdot} ${styles.vdotLg}`}>
              <CheckIcon size={20} />
            </span>
            <p className={styles.doneMsg}>
              {contribOnTime ? "Recorded. On time." : "Recorded. Late this round."}
            </p>
            <p className={`${styles.mono} ${styles.doneTx}`}>
              tx {contribTx ? short(contribTx) : ""}
            </p>
            <div className={styles.stack}>
              <Button
                variant="ghost"
                className={styles.doneBack}
                onClick={backToCircle}
              >
                Back to circle
              </Button>
            </div>
          </div>
        )}
      </Island>
    );
  } else if (screen === "standing") {
    body = !reputation ? (
      <Island className={styles.card}>
        <h2 className={styles.h2}>Your standing</h2>
        <p className={styles.meta}>Reading your record</p>
      </Island>
    ) : (
      <StandingCard reputation={reputation} onGenerate={goProve} />
    );
  } else if (screen === "prove") {
    body = (
      <ProveView
        onBackToStanding={backToStanding}
        address={address}
        circleId={circle.id}
      />
    );
  } else if (screen === "create") {
    body = (
      <CreateCircleView
        address={address}
        onBack={backToCircle}
        onCreated={goToCircle}
      />
    );
  } else {
    // The collector for this round (members[(round - 1) % size]) is highlighted
    // in the roster. Payout is automatic when the round completes, so there is
    // no manual collect action.
    const collectorSlot = collectorSlotOf(circle);
    const sym = tokenSymbol(circle.token);
    const decimals = tokenDecimals(circle.token);
    const isMember = circle.members.some((m) => m.isYou);
    const hasOpenSlot = circle.members.some((m) => !m.filled);
    const canJoin = !isMember && hasOpenSlot;
    body = (
      <Island className={styles.card}>
        <h2 className={styles.h2}>Weekly circle</h2>
        <p className={styles.meta}>
          {circle.size} members · {formatAmount(circle.amount, decimals)} {sym}{" "}
          each round
        </p>
        {circle.trust_required ? (
          <p className={styles.meta}>Requires proof of good standing to join</p>
        ) : null}

        <div className={styles.slots} aria-label="Circle members, anonymous">
          {circle.members.map((m, i) => {
            const cls = [
              styles.slot,
              !m.filled ? styles.slotEmpty : "",
              m.isYou ? styles.slotYou : "",
              m.slot === collectorSlot ? styles.slotTurn : "",
            ]
              .filter(Boolean)
              .join(" ");
            const label = m.isYou
              ? "your seat"
              : m.filled
                ? "an anonymous member"
                : "empty seat";
            return (
              <div
                key={m.slot}
                className={cls}
                role="img"
                aria-label={label}
                title={label}
                style={{ animationDelay: `${i * 0.045}s` }}
              >
                <span className={styles.ic} />
              </div>
            );
          })}
        </div>

        <div className={styles.rows}>
          <div className={styles.row}>
            <span className={styles.k}>Round</span>
            <span className={`${styles.v} ${styles.vBig}`}>
              {circle.current_round} of {circle.size}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.k}>This round</span>
            <span className={styles.v}>
              {formatAmount(circle.amount, decimals)} {sym}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.k}>Pot</span>
            <span className={styles.v}>
              {formatAmount(circle.pot, decimals)} {sym}
            </span>
          </div>
          <div className={styles.row}>
            <span className={styles.k}>Your streak</span>
            <span className={styles.v}>
              {circle.yourStreak} cycles, always on time
            </span>
          </div>
        </div>

        <div className={styles.promise}>
          <LockIcon />
          <p className={styles.promiseText}>{PRIVACY_LINE}</p>
        </div>

        <div className={styles.stack}>
          {canJoin && joinStatus !== "done" ? (
            <Button
              onClick={join}
              disabled={joinStatus === "working" || !address}
            >
              {joinStatus === "working" ? "Joining" : "Join the circle"}
            </Button>
          ) : null}
          {joinStatus === "done" ? (
            <div className={styles.collectConfirm}>
              <span className={`${styles.vdot} ${styles.vdotSm}`}>
                <CheckIcon size={13} />
              </span>
              Joined the circle
            </div>
          ) : null}
          {alreadyPaid ? (
            <div className={styles.collectConfirm}>
              <span className={`${styles.vdot} ${styles.vdotSm}`}>
                <CheckIcon size={13} />
              </span>
              Contributed this round
            </div>
          ) : (
            <Button onClick={openContribute}>
              Contribute {formatAmount(circle.amount, decimals)} {sym}
            </Button>
          )}
        </div>
        {joinError ? (
          <p
            className={styles.meta}
            style={{ textAlign: "center", marginTop: "8px" }}
          >
            {joinError}
          </p>
        ) : null}
        {joinStatus === "done" && joinTx ? (
          <p
            className={`${styles.mono} ${styles.doneTx}`}
            style={{ textAlign: "center", marginTop: "8px" }}
          >
            tx {short(joinTx)}
          </p>
        ) : null}
      </Island>
    );
  }

  const section: "circle" | "browse" | "standing" | "create" =
    screen === "browse"
      ? "browse"
      : screen === "create"
        ? "create"
        : screen === "standing" || screen === "prove"
          ? "standing"
          : "circle";

  return (
    <>
      <AppNav
        address={address}
        section={section}
        onCircle={backToCircle}
        onBrowse={goBrowse}
        onStanding={goStanding}
        onCreate={goCreate}
        onDisconnect={handleDisconnect}
      />
      {body}
      <p className={`${styles.mono} ${styles.protoNote}`}>
        Reads, proof, and writes live on Sepolia testnet
      </p>
    </>
  );
}
