import styles from "./LitepaperPage.module.css";

// Standalone Iwa litepaper page. Iwa brand: Bricolage display, Inter body, Space
// Mono for eyebrow/meta/data. Lavender and iris palette, off-white surfaces, no
// gradient text, no mint, sentence case. Separate from the app and the landing
// page; touches nothing else.

const IWA_CIRCLE = "0x6873600208829a7AF5df198b6Bf51433A266baB8";
const IWA_TRUST_GATE = "0x7C494731cCb9bbEE76D60ECee45A08324e0Ca380";

const META = [
  { label: "Author", value: "Solution" },
  { label: "Version", value: "1.0" },
  { label: "Date", value: "July 7, 2026" },
  { label: "Network", value: "Sepolia" },
];

const REFERENCES = [
  {
    n: 1,
    name: "Zama FHEVM",
    desc: "the confidential smart contract stack Iwa is built on.",
    url: "https://www.zama.ai/fhevm",
  },
  {
    n: 2,
    name: "Iwa source code",
    desc: "the savings circle contract, the trust gate, and the frontend.",
    url: "https://github.com/solutionkanu12/iwa-zama",
  },
  {
    n: 3,
    name: "Iwa on X",
    desc: "updates and announcements.",
    url: "https://x.com/joinIwa",
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

export function LitepaperPage() {
  return (
    <main className={styles.page}>
      <article className={styles.doc}>
        <div className={styles.masthead}>
          <CowrieGlyph />
          <span className={styles.wordmark}>Iwa</span>
        </div>

        <header className={styles.hero}>
          <p className={styles.eyebrow}>litepaper · v1.0</p>
          <h1 className={styles.title}>Your good name, proven and private</h1>
          <p className={styles.subhead}>
            Iwa is a confidential rotating savings circle on Zama's FHEVM.
            Members save together on a schedule, and the contract tracks each
            member's reliability entirely in encrypted form. What you contribute
            and how reliable you are stay private, while the circle itself runs
            on a public chain.
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
          <h2 className={styles.h2}>Abstract</h2>
          <p className={styles.p}>
            Iwa is a digital ajo, a rotating savings circle, built on Zama's
            FHEVM. Members save together in rounds, and every on-time
            contribution builds an encrypted record of their reliability. The
            amount a member contributes and the reliability score derived from it
            are never public. When a round is fully funded, the payout is
            released automatically, with no organizer to trigger or approve it. A
            second contract can then read a member's encrypted reliability and
            confirm it clears a threshold, entirely in encrypted space, so a
            member can prove they are reliable without the score being revealed
            to anyone.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>The problem</h2>
          <p className={styles.p}>
            Savings circles, known as ajo or esusu, have always built real
            trust. Members who show up round after round earn a reputation their
            community knows by heart. But that trust is trapped. It lives inside
            the group and cannot travel.
          </p>
          <p className={styles.p}>
            To prove you are reliable to a bank or a lender, you are usually
            asked to expose your whole financial history, and even then the
            people who save in circles are often the ones the formal system
            cannot see. Putting a savings circle straight onto a public
            blockchain does not fix this on its own, because a normal chain would
            put every contribution and every balance in the open. Iwa keeps the
            circle on chain while keeping the amounts and the reliability score
            encrypted.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>How Iwa works</h2>
          <p className={styles.p}>
            A member joins a circle and contributes a fixed amount each round
            through a confidential token, the same way ajo has always worked, now
            handled by a smart contract on Sepolia. Each contribution is
            encrypted on the member's own device before it is sent, so the amount
            is never exposed. The contract updates an encrypted reliability
            counter and an encrypted streak, and it records whether the
            contribution arrived on time.
          </p>
          <p className={styles.p}>
            Only the member can decrypt their own reliability, through a signed
            request that returns the value to their device and nowhere else. Once
            every member of a round has contributed, the contract releases the
            pot to that round's recipient automatically. No one has to collect
            it, and no organizer has to approve it.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>Composable privacy</h2>
          <p className={styles.p}>
            The core of Iwa is a second contract, IwaTrustGate. It reads a
            member's encrypted reliability score directly from IwaCircle and
            compares it to a threshold, and it does the whole comparison in
            encrypted space. The output is an encrypted approval, a yes or no that
            only a party the member has explicitly authorized can decrypt. No
            decryption happens anywhere in that comparison, and the score itself
            is never revealed.
          </p>
          <p className={styles.p}>
            This is the idea Iwa is built to show. One contract can act on
            another contract's encrypted data and return a useful answer, while
            the underlying value stays encrypted from end to end. A lender can
            learn that a member clears the bar they care about without ever
            seeing the number behind it.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>The technology</h2>
          <p className={styles.p}>
            Iwa is built on Zama's FHEVM and runs on Sepolia. IwaCircle runs the
            savings rounds and holds each member's reliability as encrypted
            counters, so the numbers are always derived from the real
            contribution history and can never drift from it. Contributions move
            through a confidential token, and for this build that token is a demo
            token deployed alongside the contracts.
          </p>
          <p className={styles.p}>
            IwaTrustGate sits beside it and performs the encrypted threshold
            check across contracts. Both are deployed and running on Sepolia at
            the addresses below.
          </p>
          <div className={styles.addrCard}>
            <div className={styles.addrItem}>
              <span className={styles.addrLabel}>IwaCircle · Sepolia</span>
              <code className={styles.addr}>{IWA_CIRCLE}</code>
            </div>
            <div className={styles.addrItem}>
              <span className={styles.addrLabel}>IwaTrustGate · Sepolia</span>
              <code className={styles.addr}>{IWA_TRUST_GATE}</code>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>Privacy model</h2>
          <p className={styles.p}>
            It is worth being exact about what Iwa hides and what it does not.
            Iwa runs on a public chain, so wallet addresses are visible, and the
            fact that a wallet took part in a circle is visible too, the same as
            any Ethereum transaction. Iwa does not claim otherwise.
          </p>
          <p className={styles.p}>
            What stays private is the amount a member contributes and the
            reliability score built from their history. Those values are
            encrypted with FHE and can only be read by the member, or by someone
            the member authorizes for a single specific check. The aim is not to
            hide that you are saving. It is to keep your amounts and your standing
            confidential, while still letting you prove your standing on your own
            terms.
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>What is next</h2>
          <p className={styles.p}>
            This build was made for the Zama Developer Program, Season 3, Builder
            Track, and runs on Sepolia. From here the work is steady and
            specific. Reliability that a member has proven in one circle should
            be able to travel to another, so a saver builds one standing rather
            than starting over each time. The demo gate contract should give way
            to real lender integration, and the demo token should be replaced
            with a production grade confidential token. Further out, once the
            contracts have been through proper review, Iwa can move to mainnet.
            The aim stays narrow. Prove reliability, reveal nothing more than you
            choose to.
          </p>
        </section>
      </article>

      <section className={styles.darkBand}>
        <div className={styles.darkInner}>
          <p className={styles.darkEyebrow}>in closing</p>
          <p className={styles.darkP}>
            A savings circle already knows who is reliable. Iwa lets that truth
            travel, on terms the saver controls. You decide what to prove, you
            prove it against your own encrypted record, and the number behind it
            stays yours.
          </p>
          <p className={styles.darkClose}>Your good name, proven and private.</p>
        </div>
      </section>

      <article className={styles.doc}>
        <section className={styles.section}>
          <h2 className={styles.h2}>References and notes</h2>
          <p className={styles.refLead}>
            The sources and references below support this litepaper.
          </p>
          <ol className={styles.refs}>
            {REFERENCES.map((r) => (
              <li key={r.url} className={styles.refItem}>
                <span className={styles.refNum}>[{r.n}]</span>
                <div className={styles.refBody}>
                  <p className={styles.refText}>
                    <span className={styles.refName}>{r.name}</span>
                    <span className={styles.refSep}> · </span>
                    <span className={styles.refDesc}>{r.desc}</span>
                  </p>
                  <a
                    className={styles.refLink}
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {r.url}
                  </a>
                </div>
              </li>
            ))}
          </ol>
          <p className={styles.note}>
            This litepaper describes Iwa as built for the Zama Developer Program,
            Season 3, Builder Track. The contracts run on Sepolia, and details
            may evolve as the project grows. This document is informational and
            is not financial, investment, or legal advice.
          </p>
        </section>

        <p className={styles.docFooter}>
          Iwa litepaper v1.0 · July 7, 2026 · Solution
        </p>
      </article>
    </main>
  );
}
