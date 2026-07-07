import styles from "./RoadmapPage.module.css";

// Standalone Iwa roadmap page. Same brand and layout language as the litepaper.
// Honest, not overpromising. Separate from the app and other pages; touches
// nothing else.

const META = [
  { label: "Author", value: "Solution" },
  { label: "Version", value: "1.0" },
  { label: "Date", value: "July 7, 2026" },
  { label: "Network", value: "Sepolia" },
];

const NOW = [
  {
    lead: "IwaCircle",
    rest: "the savings circle and reputation contract on FHEVM. It runs the rounds, holds each member's reliability as encrypted counters, and releases each round's pot automatically once it is fully funded.",
  },
  {
    lead: "IwaTrustGate",
    rest: "a second contract that reads IwaCircle's encrypted reliability across contracts, compares it to a threshold in encrypted space, and returns an encrypted approval only an authorized party can decrypt.",
  },
  {
    lead: "The confidential token rail",
    rest: "contributions and payouts move as encrypted amounts through a confidential token, with a demo token deployed for this build.",
  },
  {
    lead: "On-device encryption",
    rest: "amounts are encrypted in the browser before they are sent, and a member decrypts their own reliability through a signed request that returns the value to their device only.",
  },
];

const NEXT = [
  {
    lead: "Reputation that travels between circles",
    rest: "so reliability a member has proven in one circle can carry to another, and a saver builds a single standing instead of starting over each time.",
  },
  {
    lead: "Real lender integration",
    rest: "moving past the demo gate to lenders and services that can run their own threshold checks against a member's encrypted standing, with the member's authorization.",
  },
];

const LATER = [
  {
    lead: "A production grade confidential token",
    rest: "replacing the demo token with a confidential token built for real use.",
  },
  {
    lead: "A reviewed path to mainnet",
    rest: "moving off Sepolia once the contracts have been through proper review.",
  },
];

function CowrieGlyph() {
  return (
    <svg width="22" height="24" viewBox="0 0 60 70" aria-hidden="true">
      <ellipse cx="30" cy="36" rx="20" ry="26" fill="#B6A6F2" />
      <ellipse cx="25" cy="29" rx="11" ry="15" fill="#CECBF6" opacity=".8" />
      <path d="M30 12C34 30 34 42 30 60C26 42 26 30 30 12Z" fill="#F6F4FC" />
    </svg>
  );
}

function PhaseList({ items }: { items: { lead: string; rest: string }[] }) {
  return (
    <ul className={styles.list}>
      {items.map((item) => (
        <li key={item.lead} className={styles.li}>
          <span className={styles.liLead}>{item.lead}</span>
          <span className={styles.liSep}> · </span>
          {item.rest}
        </li>
      ))}
    </ul>
  );
}

export function RoadmapPage() {
  return (
    <main className={styles.page}>
      <article className={styles.doc}>
        <div className={styles.masthead}>
          <CowrieGlyph />
          <span className={styles.wordmark}>Iwa</span>
        </div>

        <header className={styles.hero}>
          <p className={styles.eyebrow}>roadmap · v1.0</p>
          <h1 className={styles.title}>Where Iwa is going</h1>
          <p className={styles.subhead}>
            Iwa is built for the Zama Developer Program, Season 3, Builder Track,
            and runs on Sepolia today. This roadmap lays out what is already
            working and the steady, specific steps that come next.
          </p>
          <dl className={styles.meta}>
            {META.map((m) => (
              <div key={m.label} className={styles.metaField}>
                <dt className={styles.metaLabel}>{m.label}</dt>
                <dd className={styles.metaValue}>{m.value}</dd>
              </div>
            ))}
          </dl>
        </header>

        <section className={styles.section}>
          <h2 className={styles.h2}>Where things stand</h2>
          <p className={styles.p}>
            Iwa already proves the core idea end to end on Sepolia. A member can
            save in a circle, build a reliability record that stays encrypted,
            and a second contract can act on that encrypted record to confirm the
            member clears a threshold, without the score ever being revealed. The
            work from here is to widen where that standing can travel and who can
            rely on it, without changing that foundation.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>Now, shipped</h2>
          <p className={styles.p}>
            Everything below is deployed and running on Sepolia today.
          </p>
          <PhaseList items={NOW} />
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>Next</h2>
          <p className={styles.p}>
            The near term widens where a member's standing can travel and who can
            act on it.
          </p>
          <PhaseList items={NEXT} />
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>Later</h2>
          <p className={styles.p}>
            Further out, the rails get sturdier and the credential earns its name
            in more places, on terms the saver still controls.
          </p>
          <PhaseList items={LATER} />
        </section>
      </article>

      <section className={styles.darkBand}>
        <div className={styles.darkInner}>
          <p className={styles.darkEyebrow}>the throughline</p>
          <p className={styles.darkP}>
            Every step widens what a saver can prove and where it can travel,
            while the rule underneath stays fixed. Your record is yours, and you
            decide what to share.
          </p>
          <p className={styles.darkClose}>Prove reliability, reveal nothing.</p>
        </div>
      </section>

      <article className={styles.doc}>
        <section className={styles.section}>
          <h2 className={styles.h2}>A note on this roadmap</h2>
          <p className={styles.note}>
            This roadmap is indicative. Scope and timing may change as the
            project grows, and the contracts described here run on Sepolia for
            now. No dates are promised.
          </p>
        </section>
        <p className={styles.docFooter}>
          Iwa roadmap v1.0 · July 7, 2026 · Solution
        </p>
      </article>
    </main>
  );
}
