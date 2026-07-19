# Cascade

An AI jury reads what an agent delivered, grades it against the spec both
sides agreed to, and releases exactly that share of the escrow. Hand a
piece of the job to another agent and the same thing happens one level
down. Nobody is paid for work they didn't do. Nothing gets stuck.

Contract: `0xf529b1f12475bFcA9445B20337A790e5c92Aaec1` on GenLayer Bradbury
Explorer: https://explorer-bradbury.genlayer.com/address/0xf529b1f12475bFcA9445B20337A790e5c92Aaec1

## Run

```powershell
cd "$env:USERPROFILE\Downloads\cascade"
npm install
npm run dev
```

No wallet needed to look around. The Job board and Dashboard both read
live from `list_roots()`, so whatever's actually been posted on this
contract shows up automatically.

## Design

Light, warm-neutral, restrained: closer to Stripe or Uniswap Labs than a
terminal. Fraunces for display type, IBM Plex Sans for body, IBM Plex Mono
for every number and address, so figures are always tabular and never
shift width as they animate.

The one deliberate, load-bearing visual idea: **the vessel**. A horizontal
fill bar where the filled length is literally the payout percentage,
nothing decorative added on top. Static in the hero (`VerdictBars.jsx`,
the five real verdict bands at their real widths), live on every task
card everywhere else.

Amber (`--earned`) is money that reached an agent. Slate (`--returned`) is
money that went back to the buyer. Every wei ends in exactly one of those
two places, so the two colours are the ledger's conservation law, not
decoration, and neither is used for anything else on the page. No
green/red anywhere: this product exists specifically to reject pass/fail,
so a verdict is a fill level and a word, never a status colour.

## The three tabs

- **Home**, hero, why-it's-different, how-it-works, a Contract card
  (address, network, explorer link, copy). Nothing here touches chain.
- **Job**, the public board, sourced from `list_roots`, every task on
  the protocol grouped into Open (unclaimed), In progress, and Settled
  (resolved or reclaimed, both terminal). Posting and hand-off happen
  here. Clicking any card scrolls to a detail panel below the board
  (`Panel.jsx` + `Cascade.jsx`) showing that job's full tree, live.
- **Dashboard**, strictly personal: only jobs where the connected
  wallet is buyer or agent somewhere in the tree. A real breakdown
  (settled/pending counts, GEN escrowed as buyer vs returned, GEN earned
  as an agent, tracked separately, not conflated), a banner when a job's
  waiting on you specifically to resolve it, and an "Edit profile" panel
  for username and skill tags.

## Contract reference

Fifteen public methods. Writes:

```
create_root_task(spec, agent, tags) -> str      payable. agent="" means open, anyone can claim
subcontract(parent_id, spec, agent, amount, tags) -> str   amount is a STRING (wei)
claim_task(task_id)                             only works if agent==""
submit_deliverable(task_id, urls)               urls comma-separated, max 3
resolve_task(task_id)                           BUYER ONLY, deliberately (see gotchas)
withdraw_deliverable(task_id)                   agent only, while submitted
reclaim_task(task_id)                           buyer only, while posted, all children must be reclaimed (not resolved)
set_agent_tags(tags)
set_username(name)                              3-20 chars, alnum+underscore, case-insensitive unique, renameable, not removable
```

Views, all return JSON strings except the plain lookups:

```
list_roots() -> str            every root id, newest first
get_task(task_id) -> str
get_tree(root_id) -> str       whole subtree keyed by id, one call
get_agent_tags(address) -> str
get_username(address) -> str
get_address_by_username(name) -> str
```

## Shape

```
src/
  index.css                    design system, whole thing
  lib/gl.js                    genlayer-js wiring, contract address, wei/username helpers
  lib/tree.js                  get_tree JSON -> hierarchy + ledger math
  lib/tags.js                  the one shared skill-tag list
  lib/jobIndex.js              localStorage fallback job list, used only if list_roots is unavailable
  hooks/useNotifications.js    polls personal jobs, diffs status, generates real messages
  components/
    Panel.jsx                  dashboard chrome for the live detail view (title, live badge, address, copy)
    Cascade.jsx                the tree as connected cards, the Vessel component, task actions
    JobBoard.jsx                public board: every task, grouped, walks full trees not just roots
    JobCard.jsx                one task node's card, role-aware (buyer vs agent framing)
    Dashboard.jsx               personal view, stats, resolution banner, profile summary
    ProfileSettings.jsx         username + tags edit modal
    TagPicker.jsx                shared click-to-toggle chip picker
    DeliverablePreview.jsx      fetches and renders actual deliverable content, graceful CORS fallback
    Onboarding.jsx               first-connect intro modal
    NotificationBell.jsx         the bell dropdown
    TxProgress.jsx                transaction phase modal
    Reveal.jsx                   scroll-triggered fade-in wrapper
    VerdictBars.jsx               hero illustration
    Icons.jsx                     stroke icon set
  App.jsx                       tabs, wallet, every write function
```

## Things that will bite you if you edit this

1. **`amount` and `urls` are strings, addresses are lowercase strings.**
   Wei is ~1e18, past JavaScript's safe integer range, a number arrives
   mangled, usually as `1`. Use `genToWeiString()`. `BigInt()` throws on
   a float, hence the round inside it.
2. **`writeContract` resolves to the transaction hash, never the
   contract's return value.** Confirmed against GenLayer's own docs.
   To learn a newly created task's id, read `list_roots()` afterward
   (newest-first, shape fully known) rather than trying to parse the
   receipt.
3. **Reads need `transactionHashVariant: 'latest-nonfinal'`.** Without
   it you read finalized state, which lags 30-40 minutes behind reality.
4. **JSX does not process `\uXXXX` escapes** in raw text nodes or
   double-quoted attribute strings, only inside real JS string literals
   inside `{}`. This exact bug shipped at least four separate times
   across this build. Use the real character, always, everywhere it
   isn't already inside quotes.
5. **`resolve_task` and `reclaim_task` accept different child states.**
   Resolve accepts children that are `resolved` OR `reclaimed`. Reclaim
   requires every child to specifically be `reclaimed`. Reusing one
   check for the other button gate is a real bug that shipped once.
6. **A card that's a whole clickable `<button>` cannot contain its own
   `<a href>` inside** (invalid HTML, inconsistent click behavior across
   browsers). `JobCard` is a `div` with `role="button"` for exactly this
   reason, since `DeliverablePreview` renders real links inside it.
7. **The transaction phase modal's granular step tracking is unverified.**
   It polls `client.getTransaction({hash}).status` and hopes the value
   matches GenLayer's documented `TransactionStatus` enum
   (`PENDING/PROPOSING/COMMITTING/REVEALING/ACCEPTED`). Never confirmed
   live. The modal always shows a moving indeterminate bar regardless,
   pure CSS, no data dependency, so it can't look frozen even if the
   granular tracking turns out not to work. Console logs the raw poll
   response (`[cascade tx poll]`) for whoever tests this next.

## Known, on purpose

- **`resolve_task` is buyer-only, and that's a deliberate, temporary
  tradeoff, not a bug.** If a buyer goes quiet after work is submitted,
  the agent currently has no path to being paid, there's no reliable
  on-chain clock here to force a timeout. Holds until real dispute
  rights (grade, then hold, then finalize) replace it.
- **Skill tags and usernames are both self-declared and unverified,
  on purpose.** They're discovery aids for the open board, not
  credentials. An unqualified claim already gets punished by the jury
  with a low score and a small realized payout; gating on top of that
  would need real verification to mean anything, which is a separate,
  bigger, deliberately unbuilt decision.
- **Timeouts hit roughly a third of `resolve_task` calls on Bradbury.**
  Leader missing its execution window, not a contract bug. Nothing
  writes on failure, the task stays `submitted`, retrying is always
  safe and is the designed answer.
- **The jury reads the first 4,000 characters of each deliverable**,
  split evenly across however many URLs are submitted (up to 3), so the
  total budget stays roughly constant regardless of count. Focused
  artifacts grade reliably; a thousand-line file gets sampled, with an
  explicit note in the prompt telling the jury not to penalize that.
- **`DeliverablePreview` only renders content from sources that allow
  cross-origin reads.** Confirmed via a real header check that
  `raw.githubusercontent.com` does. Most ordinary web pages don't set
  that header; those fall back to a plain link instead of breaking.
- **Wallet disconnect is app-level only.** MetaMask has no API for a
  site to force a real disconnect. Reconnecting will be instant unless
  the site's access is revoked from inside MetaMask itself.
- **RainbowKit was evaluated and held, not built.** GenLayer's own docs
  show external-wallet integration via a bare address string, no
  provider object, pointing at `window.ethereum`-specific integration.
  RainbowKit's main value, WalletConnect and mobile wallets, is not
  `window.ethereum`. Unverified either way, not wired in without being
  able to check it actually works.
- **Open marketplace claiming has no self-claim guard.** A buyer can
  currently claim their own posted job. Not exploitable, it's their own
  escrow and the jury still grades honestly, but it was never a
  deliberate decision, just an unaddressed edge case.
