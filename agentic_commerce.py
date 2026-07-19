# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
import json
from genlayer import *


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass


class AgenticCommerce(gl.Contract):

    task_counter: u64
    tasks:        TreeMap[str, str]   # JSON-encoded task dict
    root_buyer:   TreeMap[str, str]   # root task_id -> buyer address
    unspent_pool: TreeMap[str, str]   # root task_id -> str(int) shortfall accumulator
    root_ids:     DynArray[str]       # every root task_id ever created, in order
    agent_tags:   TreeMap[str, str]   # address -> comma-separated self-declared tags
    usernames:      TreeMap[str, str] # address -> claimed username
    username_index: TreeMap[str, str] # lowercased username -> address

    def __init__(self):
        self.task_counter = u64(0)

    # ── Helpers ──────────────────────────────────────────────

    def _addr(self) -> str:
        return str(gl.message.sender_address).lower().strip()

    def _get_task(self, task_id: str) -> dict:
        raw = self.tasks.get(task_id, None)
        if raw is None:
            raise gl.vm.UserError("Task " + task_id + " does not exist")
        return json.loads(raw)

    def _save_task(self, task_id: str, t: dict):
        self.tasks[task_id] = json.dumps(t)

    def _find_root(self, task_id: str) -> str:
        current = task_id
        t = self._get_task(current)
        while t["parent_id"] != "":
            current = t["parent_id"]
            t = self._get_task(current)
        return current

    # ── Creation ─────────────────────────────────────────────
    #
    # agent may be "" at creation. An empty agent means the task is open:
    # anyone can call claim_task to become its agent. Every guard that
    # checks "sender == task['agent']" already rejects everyone correctly
    # while agent is "", since no real address equals an empty string, so
    # nothing else needed to change to make an unclaimed task unusable
    # until claimed.

    @gl.public.write.payable
    def create_root_task(self, spec: str, agent: str, tags: str) -> str:
        payout = int(gl.message.value)
        if payout == 0:
            raise gl.vm.UserError("No GEN sent")

        task_id = str(int(self.task_counter))
        self.task_counter = u64(int(self.task_counter) + 1)
        buyer = self._addr()

        t = {
            "parent_id":        "",
            "buyer":             buyer,
            "agent":             agent.lower().strip(),
            "spec":              spec,
            "tags":              tags.strip(),
            "payout_allocated":  payout,
            "self_allocated":    payout,
            "children":          [],
            "deliverable_url":   "",
            "status":            "posted",
            "score":             -1,
            "realized":          -1,
            "fetched":           False,
            "reasoning":         "",
        }
        self._save_task(task_id, t)
        self.root_buyer[task_id]   = buyer
        self.unspent_pool[task_id] = "0"
        self.root_ids.append(task_id)
        return task_id

    @gl.public.write
    def subcontract(self, parent_id: str, spec: str, agent: str, amount: str, tags: str) -> str:
        # amount is a STRING, not an int. Wei values are ~1e18, past JavaScript's
        # safe integer limit (~9e15), so a client sending an int param mangles
        # it. This bit three separate tree tests: 1000000000000000000 arrived as
        # 1, the child got one wei, its payout floored to zero, and the run
        # looked plausible while proving nothing. Payable `value` is unaffected
        # because it travels a different path.
        try:
            amt = int(str(amount).strip())
        except:
            raise gl.vm.UserError("amount must be a whole number of wei, sent as a string")
        if amt <= 0:
            raise gl.vm.UserError("amount must be greater than zero")

        parent = self._get_task(parent_id)
        if self._addr() != parent["agent"]:
            raise gl.vm.UserError("not the agent for this task")
        if parent["status"] not in ("posted", "submitted"):
            raise gl.vm.UserError("parent task is " + parent["status"] + ", cannot subcontract")
        if amt > parent["self_allocated"]:
            raise gl.vm.UserError("exceeds unallocated balance")

        child_id = str(int(self.task_counter))
        self.task_counter = u64(int(self.task_counter) + 1)

        parent["self_allocated"] -= amt
        parent["children"].append(child_id)
        self._save_task(parent_id, parent)

        child = {
            "parent_id":        parent_id,
            "buyer":             parent["buyer"],
            "agent":             agent.lower().strip(),
            "spec":              spec,
            "tags":              tags.strip(),
            "payout_allocated":  amt,
            "self_allocated":    amt,
            "children":          [],
            "deliverable_url":   "",
            "status":            "posted",
            "score":             -1,
            "realized":          -1,
            "fetched":           False,
            "reasoning":         "",
        }
        self._save_task(child_id, child)
        return child_id

    @gl.public.write
    def claim_task(self, task_id: str):
        task = self._get_task(task_id)
        if task["agent"] != "":
            raise gl.vm.UserError("this task is already assigned")
        if task["status"] != "posted":
            raise gl.vm.UserError("task is " + task["status"] + ", cannot claim")
        task["agent"] = self._addr()
        self._save_task(task_id, task)

    @gl.public.write
    def set_agent_tags(self, tags: str):
        # Self-declared, not verified, not enforced anywhere. This is a
        # discovery aid for filtering the open-job board, not a
        # credential. A jury already punishes an unqualified claim with a
        # low score and a small realized payout; tags don't gate anything
        # on top of that.
        self.agent_tags[self._addr()] = tags.strip()

    @gl.public.write
    def set_username(self, name: str):
        # Mirrors the proven pattern already live on GenMarkets exactly,
        # not a new design: same length bound, same charset, same
        # case-insensitive uniqueness, same safe-rename cleanup.
        name = name.strip()
        if len(name) < 3 or len(name) > 20:
            raise gl.vm.UserError("Username must be 3-20 characters")
        for ch in name:
            if not (ch.isalnum() or ch == "_"):
                raise gl.vm.UserError("Letters, numbers, underscores only")
        addr     = self._addr()
        key      = name.lower()
        existing = self.username_index.get(key, None)
        if existing and existing != addr:
            raise gl.vm.UserError("Username taken")
        old = self.usernames.get(addr, "")
        if old:
            try:
                del self.username_index[old.lower()]
            except:
                pass
        self.usernames[addr]     = name
        self.username_index[key] = addr

    # ── Delivery ─────────────────────────────────────────────

    @gl.public.write
    def submit_deliverable(self, task_id: str, urls: str):
        task = self._get_task(task_id)
        if self._addr() != task["agent"]:
            raise gl.vm.UserError("not the agent for this task")
        url_list = [u.strip() for u in urls.split(",") if u.strip()]
        if not url_list:
            raise gl.vm.UserError("provide at least one deliverable URL")
        if len(url_list) > 3:
            raise gl.vm.UserError("at most 3 deliverable URLs per submission")
        task["deliverable_url"] = ",".join(url_list)
        task["status"]          = "submitted"
        self._save_task(task_id, task)

    # ── Resolution ───────────────────────────────────────────

    @gl.public.write
    def resolve_task(self, task_id: str):
        task = self._get_task(task_id)
        # Buyer-only, deliberately. Confirmed tradeoff: if the buyer goes
        # quiet after work is submitted, the agent has no path to being
        # paid, there is no reliable clock here to force a timeout, the
        # same limit already accepted for withdraw/reclaim. This is meant
        # to hold only until real dispute rights (grade, hold, finalize)
        # replace it, not as a permanent design.
        if self._addr() != task["buyer"]:
            raise gl.vm.UserError("only the buyer can ask the jury to resolve this task")
        if task["status"] != "submitted":
            raise gl.vm.UserError("deliverable not submitted yet")
        for child_id in task["children"]:
            child = self._get_task(child_id)
            if child["status"] not in ("resolved", "reclaimed"):
                raise gl.vm.UserError("subcontract " + child_id + " is still " + child["status"])

        spec           = task["spec"]
        url_list       = [u.strip() for u in task["deliverable_url"].split(",") if u.strip()]
        agent_addr     = task["agent"]
        self_allocated = task["self_allocated"]

        def judge() -> str:
            # The ENTIRE body is wrapped. Any unhandled exception in a nondet
            # block becomes exit(1), which surfaces as "Execution Error /
            # exit_code 1" with no indication of what threw. Returning the
            # exception text instead turns a dead end into a readable message
            # on the explorer.
            try:
                def fetch_one(u):
                    # Plain HTTP, not web.render. render() boots a full browser
                    # to rasterize a page, pure overhead for a raw text file,
                    # and puts a browser launch inside the same execution
                    # window the leader has to beat.
                    try:
                        resp = gl.nondet.web.request(u, method="GET")
                    except:
                        return None, "could not be fetched"

                    # Field names differ between SDK versions. The docs
                    # describe `main` (status_code / body), but the Depends
                    # header pins an older runtime whose Response confirmed
                    # has no .status_code. Probe rather than assume.
                    st = 200
                    for name in ("status_code", "status", "code"):
                        if hasattr(resp, name):
                            try:
                                st = int(getattr(resp, name))
                            except:
                                pass
                            break
                    if st != 200:
                        return None, "returned HTTP " + str(st)

                    raw_body = None
                    for name in ("body", "text", "content", "data"):
                        if hasattr(resp, name):
                            raw_body = getattr(resp, name)
                            break
                    if raw_body is None:
                        return None, "response had no readable body"

                    full = raw_body.decode("utf-8") if isinstance(raw_body, bytes) else str(raw_body)
                    if not full.strip():
                        return None, "returned no content"
                    return full, None

                n = len(url_list)
                # Total content budget stays roughly constant regardless of
                # how many deliverables are submitted, one big prompt with
                # three concatenated files is exactly the shape that pushed
                # an earlier version over a leader timeout window.
                per_file_budget = max(1500, 8000 // max(1, n))

                sections = []
                any_ok = False
                for i in range(n):
                    u = url_list[i]
                    full, err = fetch_one(u)
                    if full is None:
                        sections.append(
                            "--- deliverable " + str(i + 1) + " (" + u + ") ---\n"
                            "[could not grade this one: " + err + "]\n"
                        )
                    else:
                        any_ok = True
                        note = ""
                        if len(full) > per_file_budget:
                            note = (
                                " [truncated for length here, judge only this excerpt, "
                                "do not penalize it for seeming incomplete]"
                            )
                        sections.append(
                            "--- deliverable " + str(i + 1) + " (" + u + ")" + note + " ---\n"
                            + full[:per_file_budget] + "\n"
                        )

                if not any_ok:
                    return "FETCH_FAILED||None of the deliverable URLs could be fetched."

                content = "\n".join(sections)

                prompt = (
                    "You are grading delivered work against an agreed spec. Be strict: "
                    "only award a higher band when the deliverable clearly demonstrates "
                    "it, not when it merely seems plausible. If you are genuinely unsure "
                    "between two bands, choose the LOWER one.\n\n"
                    "SPEC:\n" + spec + "\n\n"
                    "DELIVERED CONTENT (" + str(n) + " item(s), fetched live just now):\n"
                    + content + "\n\n"
                    "Before choosing a label, check each concrete requirement in the spec "
                    "against the delivered content. A requirement only counts as met if "
                    "you can point to something specific in the content that satisfies it. "
                    "A requirement you cannot find evidence for counts as unmet, not as "
                    "probably-fine.\n\n"
                    "Choose EXACTLY ONE label:\n"
                    "  FULL        : every concrete requirement in the spec is clearly met\n"
                    "  MINOR_GAPS  : nearly all requirements met, only small or cosmetic gaps\n"
                    "  PARTIAL     : some requirements clearly met, others clearly missing\n"
                    "  TANGENTIAL  : loosely related, most requirements unmet\n"
                    "  UNRELATED   : unrelated to the spec, or no usable content\n\n"
                    "Judge ONLY against the spec above. Do not reward quality the spec "
                    "did not ask for, and do not penalize omissions it did not require. "
                    "If a deliverable is an error page, a navigation menu, or a table of "
                    "contents rather than real work, treat it as not fetched for that item.\n\n"
                    "Reply on ONE line, exactly this format, nothing else:\n"
                    "LABEL||<one short sentence citing specific evidence from the content>"
                )

                result = str(gl.nondet.exec_prompt(prompt)).strip()

                head = result.split("||")[0].strip().upper()
                for band in ("FULL", "MINOR_GAPS", "PARTIAL", "TANGENTIAL", "UNRELATED"):
                    if band in head:
                        reason = result.split("||", 1)[1].strip()[:400] if "||" in result else ""
                        if not reason:
                            reason = "No reasoning given."
                        return band + "||" + reason
                return "GRADER_FAILED||Grader returned an unusable label: " + result[:150]

            except Exception as e:
                return "GRADER_FAILED||" + type(e).__name__ + ": " + str(e)[:200]

        raw_result = gl.eq_principle.prompt_non_comparative(
            judge,
            # Written for the VALIDATOR, not the leader. Validators see this
            # alongside the leader's output and nothing else. Leader-facing
            # phrasing makes them try to grade the leader's output as if it
            # were the deliverable, then reject it for containing no work.
            task=(
                "A grader read one or more web pages and classified how well they "
                "satisfy a spec together, returning one label and a short reason. You "
                "are only checking the format of that response. You cannot see the "
                "pages or the spec, so do not attempt to re-grade anything."
            ),
            # Mechanical only. Validators must AGREE with each other, so every
            # clause has to be objectively decidable. Asking them to judge
            # whether a score "follows from" its reasoning is a judgment call:
            # they disagree, consensus fails, nothing commits.
            criteria=(
                "Accept if the response begins with one of FULL, MINOR_GAPS, PARTIAL, "
                "TANGENTIAL, UNRELATED, FETCH_FAILED, or GRADER_FAILED, followed by "
                "two pipe characters and then any non-empty text."
            ),
        )

        BANDS = {
            "FULL":       95,
            "MINOR_GAPS": 80,
            "PARTIAL":    55,
            "TANGENTIAL": 25,
            "UNRELATED":   5,
        }

        raw       = str(raw_result).strip()
        band      = raw.split("||")[0].strip().upper()
        reasoning = raw.split("||", 1)[1].strip()[:400] if "||" in raw else ""

        # Neither a dead link nor a broken grader is a verdict on the work.
        # Refusing to resolve leaves the task submitted so it can be retried,
        # rather than permanently zeroing an agent because a page was down.
        if band == "FETCH_FAILED":
            raise gl.vm.UserError(
                "Could not fetch deliverable: " + reasoning + " | task left submitted, retry resolve"
            )
        if band not in BANDS:
            # Carries the real exception text out of the nondet block so the
            # explorer shows what actually threw.
            raise gl.vm.UserError(
                "Grader failed: " + reasoning + " | task left submitted, retry resolve"
            )

        fetched = True
        score   = BANDS[band]

        realized  = (self_allocated * score) // 100
        shortfall = self_allocated - realized

        if realized > 0:
            _Recipient(Address(agent_addr)).emit_transfer(value=realized)

        root_id = self._find_root(task_id)
        pool    = int(self.unspent_pool.get(root_id, "0"))
        self.unspent_pool[root_id] = str(pool + shortfall)

        task["score"]     = score
        task["realized"]  = realized
        task["status"]    = "resolved"
        task["fetched"]   = fetched
        task["reasoning"] = reasoning
        self._save_task(task_id, task)

        if task["parent_id"] == "":
            buyer  = self.root_buyer[task_id]
            refund = int(self.unspent_pool.get(task_id, "0"))
            if refund > 0:
                _Recipient(Address(buyer)).emit_transfer(value=refund)
                self.unspent_pool[task_id] = "0"

    # ── Exits ────────────────────────────────────────────────
    #
    # Without these, a task whose resolve_task keeps failing locks its GEN in
    # the contract forever. That is not hypothetical: an earlier deploy stranded
    # 3 GEN in exactly this state, because the only way out was a resolve path
    # that had stopped working.
    #
    # Deliberately no timestamp-based timeout. There is no reliable clock here,
    # and a buyer-only reclaim on submitted work would let a buyer take the
    # deliverable and then pull the money back. So each side gets an exit that
    # cannot rug the other: the agent can withdraw their submission, and the
    # buyer can reclaim only once nothing is submitted. If the agent has
    # delivered and stands by it, the funds stay put until resolve succeeds.

    @gl.public.write
    def withdraw_deliverable(self, task_id: str):
        task = self._get_task(task_id)
        if self._addr() != task["agent"]:
            raise gl.vm.UserError("not the agent for this task")
        if task["status"] != "submitted":
            raise gl.vm.UserError("nothing submitted to withdraw")
        task["status"]          = "posted"
        task["deliverable_url"] = ""
        self._save_task(task_id, task)

    @gl.public.write
    def reclaim_task(self, task_id: str):
        task = self._get_task(task_id)
        if self._addr() != task["buyer"]:
            raise gl.vm.UserError("not the buyer for this task")
        if task["status"] != "posted":
            raise gl.vm.UserError(
                "task is " + task["status"] + ", agent must withdraw their deliverable first"
            )
        for child_id in task["children"]:
            child = self._get_task(child_id)
            if child["status"] != "reclaimed":
                raise gl.vm.UserError("subcontract " + child_id + " must be reclaimed first")

        amount = task["self_allocated"]
        task["self_allocated"] = 0
        task["status"]         = "reclaimed"
        self._save_task(task_id, task)

        parent_id = task["parent_id"]
        if parent_id == "":
            # Root: hand the money back to the buyer, plus anything already
            # pooled from children that resolved below 100%.
            refund = amount + int(self.unspent_pool.get(task_id, "0"))
            self.unspent_pool[task_id] = "0"
            if refund > 0:
                _Recipient(Address(task["buyer"])).emit_transfer(value=refund)
        else:
            # Child: the money was carved out of the parent's allocation, so it
            # returns there rather than skipping the chain back to the buyer.
            parent = self._get_task(parent_id)
            parent["self_allocated"] += amount
            self._save_task(parent_id, parent)

    # ── Views ────────────────────────────────────────────────

    @gl.public.view
    def list_roots(self) -> str:
        # Iterate by index, not direct iteration, matching the pattern
        # already proven live on GenMarkets' get_all_markets. Returns
        # newest first so a dashboard doesn't need to reverse it.
        total = len(self.root_ids)
        result = []
        for i in range(total):
            result.append(self.root_ids[total - 1 - i])
        return json.dumps(result)

    @gl.public.view
    def get_task(self, task_id: str) -> str:
        return json.dumps(self._get_task(task_id))

    @gl.public.view
    def get_tree(self, root_id: str) -> str:
        result = {}
        stack = [root_id]
        while stack:
            tid = stack.pop()
            t = self._get_task(tid)
            result[tid] = t
            stack.extend(t["children"])
        return json.dumps(result)

    @gl.public.view
    def get_agent_tags(self, address: str) -> str:
        return self.agent_tags.get(address.lower().strip(), "")

    @gl.public.view
    def get_username(self, address: str) -> str:
        return self.usernames.get(address.lower().strip(), "")

    @gl.public.view
    def get_address_by_username(self, name: str) -> str:
        return self.username_index.get(name.lower().strip(), "")
