# Along the way: the research, and what it means for Moduo Tasks Feature

> **Source and status:** written by Mike's Claude for the concept artifacts *Tasks Along the Way*, *Moduo Metro* and *Queue, Along the Way* (2026-10-09). Maciej shared it on 2026-10-10.
> - It's kept here **separately** from this re-plan's own research. That agent didn't have the full app context, so the directions below are input, not decisions.
> - The re-plan evaluates it item by item in [../REPLAN.md](../REPLAN.md) §10.
> - Paraphrases and evidence labels are the original author's. Nothing here is decided.

Research behind the three concept artifacts from 2026-10-09: *Tasks Along the Way*, *Moduo Metro* and *Queue, Along the Way*. Each finding gets a paraphrase, a strength label and what it implies for how a feature should work. Paraphrases are mine, not quotes; the sources are listed at the end with DOIs.

References were checked against publisher and index records on 2026-10-09.

**Evidence labels**
- **Strong:** meta-analyses or many replications.
- **Moderate:** several studies, with some caveats.
- **Early:** few or small studies, or a design framework.
- **Practice:** clinical or coaching advice, not trials.

---

## The method itself

> "Can I do something along the way?" → "I need to do something along the way."

The habit has a name in research: **pre-crastination** (Rosenbaum, Gong & Potts, 2014). People walking down an alley picked up the nearer of two buckets, even though that meant carrying it farther. The likely reason is to finish a subgoal early and free up working memory.
- **Evidence:** Moderate. The behavior replicates across labs, including a version with pigeons (Wasserman & Brzykcy, 2015). The working-memory explanation is supported but small, and still debated.
- **Implication:** the urge to grab a nearby small task is natural. The product's job is to put the right small task on the path at the right moment, not to create the urge.

---

## 1. Tie tasks to places and events, not only to clock times

**Event cues beat clock cues in ADHD (Altgassen, Kretschmer & Kliegel, 2014; Talbot & Kerns, 2014).**
- **Finding:** time-based remembering ("at 3 pm, call the dentist") is more consistently impaired in ADHD than event-based remembering ("when I open Email, reply to Marta"). Event-based lapses still happen; Talbot & Kerns found both kinds impaired. There is no ADHD-specific meta-analysis yet.
- **Evidence:** Early. Small lab samples, mostly children.
- **Honest wording:** time-based remembering is more consistently impaired in ADHD than cue-based remembering, though cue-based deficits also appear.

**If-then plans (Gollwitzer, 1999; Gollwitzer & Sheeran, 2006).**
- **Finding:** adding a when/where/how plan to a goal clearly improves follow-through. The meta-analysis pooled 94 tests from 63 reports (N = 8,461), with d = .65.
- **Evidence:** Strong. A 2025 update (Sheeran, Listrom & Gollwitzer) reports smaller effects for some outcomes.

**If-then plans in ADHD (Gawrilow & Gollwitzer, 2008; Gawrilow, Gollwitzer & Oettingen, 2011).**
- **Finding:** if-then plans improved inhibition, set-shifting and math under distraction in boys with ADHD.
- **Evidence:** Early. All from one lab, with small all-boy samples (pooled d = .48 in 2008). There is no controlled study in adults with ADHD yet.

**Plan making relieves an unfinished goal (Masicampo & Baumeister, 2011).**
- **Finding:** writing a specific plan for an unfinished goal removed its intrusive thoughts and its drag on other tasks.
- **Evidence:** Early. Small samples, and no direct replication found. The 2025 Zeigarnik meta-analysis (Ghibellini & Meier) found no memory advantage for unfinished tasks, only a tendency to resume them, which weakens the paper's premise.

**What this means for Moduo**
- A task should be able to carry a *where*: a module, a linked entity (thread, contact, note), a person, or a physical place. Spine links can set it automatically.
- Parking a task at a place is itself a small plan, so the UI can say so ("You can stop holding it in your head").
- Don't promise users that dates are bad. Offer places as an extra cue.

---

## 2. Help at the moment and place the work happens

**Point of performance (Barkley, 1997).**
- **Finding:** Barkley's model frames ADHD as a problem of acting on what you know at the moment it matters, so help has to be placed where and when the action happens. The *Psychological Bulletin* paper lists internalized, self-directed speech among the executive functions ADHD weakens; that is the model's least-supported part.
- **Source note:** the phrase "point of performance" is in the 1997 book *ADHD and the Nature of Self-Control*, not in the paper.
- **Evidence:** Practice. This is theory and clinical guidance.

**Doorway effect (Radvansky & Copeland, 2006; Radvansky, Krawietz & Tamplin, 2011).**
- **Finding:** walking through a doorway reduced memory for what people had just handled, compared with walking the same distance inside one room.
- **Evidence:** Early, and fragile. An independent replication in immersive VR (McFadyen et al., 2021) found the effect only under extra memory load.

**Just-in-time adaptive interventions (Nahum-Shani et al., 2018).**
- **Finding:** the framework names four components: decision points, tailoring variables, intervention options and decision rules. It adds receptivity (whether the person can take help right now) and treats "provide nothing" as a valid option.
- **Evidence:** Early. It is a design framework, not an efficacy trial.

**What this means for Moduo**
- Moments to offer something: entering a module, opening an entity, the minutes before a call, returning from being away.
- Offer **one** item, at most once per visit, in a quiet strip. Never a modal, never a sound.
- Stay silent during a focus block or a call. Hold the offer, and let the user open it on demand ("Show it now").
- "Not now" must cost nothing. Count skips only so you can suggest shrinking, moving or letting go after about three.
- The strip is the user's own question asked out loud. Its copy can literally be "Anything along the way here?" (Ask mode).
- Don't lean on the doorway effect for big claims; use it as motivation, not proof.

---

## 3. Make the step small and the payoff immediate

**Temporal motivation theory (Steel, 2007).**
- **Finding:** across 691 correlations, the dependable predictors of procrastination were task aversiveness, a distant payoff, low self-efficacy, impulsiveness and low conscientiousness. The theory merges expectancy theory with hyperbolic discounting.
- **Evidence:** Moderate (a meta-analytic review). I haven't verified the exact formula.

**Delay aversion (Sonuga-Barke, 2002).**
- **Finding:** the dual-pathway model of ADHD has two routes: weak inhibitory control, and a motivational route where delayed rewards lose their value.

**Delay discounting in ADHD (Jackson & MacKillop, 2016).**
- **Finding:** a meta-analysis of 25 comparisons (N = 3,913) found steeper delay discounting in ADHD, d = .43.
- **Evidence:** Strong, with some publication bias.

**Microtasks (Cheng, Teevan, Iqbal & Bernstein, 2015).**
- **Finding:** split into microtasks, work took longer in total but came out better, felt easier and may have held up better under interruption.
- **Evidence:** Early.

**CBT for adult ADHD (Safren et al., 2010; Solanto et al., 2010).**
- **Finding:** programs teaching organization, planning and breaking tasks down beat active control conditions in randomized trials. Safren had 86 medicated adults; Solanto had 88 adults, with about 5.4× the odds of response.
- **Evidence:** Moderate. Two RCTs with modest samples.

**What this means for Moduo**
- Every task should be able to show a **first step**: the first open subtask, or a one-line step written by the user or suggested by their assistant over MCP.
- A fuller version is a size ladder: Touch (≤30 s), Start (≤2 min), Chunk (≤15 min), All of it. Each door or Now card offers the smallest size left.
- A holding reply or other small touch counts as progress. It resets the task's waiting clock but leaves the task open.
- Give immediate feedback when something is done: a check-off, a run summary or a trip receipt. No streaks.

---

## 4. Order work for momentum, and make switching visible

**Behavioral momentum (Mace et al., 1988).**
- **Finding:** a few easy, likely-to-be-followed requests just before a hard one raised compliance with the hard one.
- **Evidence:** Early for adults. These are single-case designs, mostly with children who have autism or intellectual disabilities, and the effect depends on reinforcing the easy requests. A 2024 meta-analysis (Sayar et al.) rates it a "promising" practice. Applying it to adult ADHD is an analogy.

**Attention residue (Leroy, 2009) and the ready-to-resume plan (Leroy & Glomb, 2018).**
- **Finding:** switching away from an unfinished task leaves part of your attention behind, which hurts the next task. A brief plan for coming back reduced that residue without hurting the new task.
- **Evidence:** Moderate.

**What this means for Moduo**
- **Arrange for flow:** group the queue by context. Use the area tag tasks share most, ignore kind-of-work tags (fix, improvement, UI), give ties to the more specific area, and fall back to the bucket. Keep high-priority contexts first and the user's own order for ties. On the real queue this cut switches from 7 to 3.
- **Riders:** quick tasks (≤30 min) ride with the first task of their context, so there is a quick yes before the long one. In Metro terms the local train stops at small stations; express skips them for deep work.
- Show the cost of a context switch: a divider in the list, or a flat transfer cost (15 min in Metro). Before a switch, ask one question, "Where are you, and what's next?". The spec's Hand off note already does this.
- Arranging must be reversible (Undo) and explain itself ("Why this order?").

---

## 5. Lower the dread instead of adding to it

**Procrastination as mood repair (Sirois & Pychyl, 2013).**
- **Finding:** procrastination is mostly short-term mood repair, avoiding a bad feeling now at the future self's expense.
- **Evidence:** Moderate.

**Affective forecasting (Wilson & Gilbert, 2005).**
- **Finding:** people overestimate how intense and how lasting their future feelings will be (the impact bias).
- **Evidence:** Moderate. It is about feelings, not time.

**Planning fallacy (Buehler, Griffin & Ross, 1994).**
- **Finding:** people underestimate how long tasks will take.

**The Wall of Awful (Brendan Mahan, ADHD Essentials).**
- **Finding:** each avoided attempt adds an emotional "brick" that makes starting harder.
- **Evidence:** Practice. Not tested empirically.

**What this means for Moduo**
- No red, no overdue walls, no streaks. Falling behind is the normal case, as the Product Brief says. Skip never counts as a reschedule.
- Show the pile honestly: "9 things, about 4 minutes of first steps". To respect the planning fallacy, always show the "all of it" total next to it.
- A short, timed sweep (5 in 5 minutes, or a quick run) clears it smallest first, for momentum.
- Replace "overdue" with status language: Good service, Minor delays (no estimate, or no name you can act on), Delays (moved before).
- After about three "not now"s, suggest shrinking it, giving it a new place, or letting it go.

---

## 6. Use waiting moments and physical trips

**Wait-learning (Cai, Guo, Glass & Miller, 2015) and WaitSuite (Cai, Ren & Miller, 2017).**
- **Finding:** vocabulary micro-quizzes shown while people waited for chat replies, elevators, wifi or outgoing email taught about 57 words per person in two weeks, without taking time from anything else.
- **Evidence:** Early. Small two-week field studies (20 and 25 users), with no ADHD sample.

**Place-based reminders (Ludford et al., 2006).**
- **Finding:** in PlaceMail, a month-long field study, location reminders were useful for errands. How people actually move through a place mattered more than a simple radius around it.
- **Evidence:** Early.

**The "launching pad" (Dolin, 2024, *Attention*/CHADD).**
- **Finding:** a fixed spot by the door for everything that has to leave the house.
- **Evidence:** Practice.

**What this means for Moduo**
- Spare minutes are a door: the 10 minutes before a call (offer only tasks shorter than the gap minus 30 seconds), a call's waiting room, a long upload.
- Physical trips, since there is no mobile app: an explicit "Step away" (or the desktop lock and idle events) shows what to take along. On return it asks what came along.
- No location tracking.

---

## 7. Commitment, habits, and support that fades

**Commitment devices (Bryan, Karlan & Nelson, 2010).**
- **Finding:** the review separates hard commitments (money at stake) from soft ones (only a psychological cost) and treats soft ones as useful design tools.
- **Evidence:** Moderate.
- **Retraction:** do not cite Ariely & Wertenbroch (2002) on self-imposed deadlines. *Psychological Science* retracted it on 2026-09-02, after a failed preregistered replication and data anomalies.

**Context-cued habits (Wood & Neal, 2007; Wood & Rünger, 2016).**
- **Finding:** repeating an action in a stable context links the cue directly to the response, and changing the context disrupts the habit.
- **Evidence:** Strong (theory reviews).

**Scaffolding and fading (Wood, Bruner & Ross, 1976; van de Pol, Volman & Beishuizen, 2010).**
- **Finding:** scaffolding originates in the 1976 study. Fading support as competence grows is a core feature in later research; the term itself comes from the later work.

**What this means for Moduo**
- Door modes follow the user's own path: Quiet → Ask ("Anything along the way?") → Offer → Take one / Hold ("I need to do something along the way"). Take one is a soft commitment: it holds a card, never the screen, and "Pass it on" is always available.
- When a habit holds (for example, took one on 80%+ of visits for three weeks), suggest stepping down a mode. The app should aim to be needed less.

---

## 8. Smaller supporting notes

**Method of loci (Dresler et al., 2017).**
- **Finding:** six weeks of training markedly improved recall in novices, lasting four months.
- **Evidence:** Small (51 men), not ADHD-specific.
- **Use:** a spatial "Doors" layout can help memory, but it's optional.

**Temptation bundling (Milkman, Minson & Volpp, 2014; Kirgios et al., 2020).**
- **Finding:** pairing a treat with a chore raised early gym visits by about 51%; the larger follow-up found +10–14%. Effects fade.
- **Use:** pair small tasks with things the user already does.

**Fogg Behavior Model (2009) and *Tiny Habits* (2020).**
- **Finding:** behavior happens when motivation, ability and a prompt coincide. When motivation is low, make the behavior easier.
- **Evidence:** A design framework, not evidence.

**Dopamine reward pathway (Volkow et al., 2009, 2011).**
- **Finding:** lower reward-pathway markers in unmedicated adults with ADHD.
- **Evidence:** One lab, overlapping samples. Treat it as a hypothesis, and don't use it in product copy.

---

## Design rules distilled

1. **One thing at a time.** One Now, one offer per visit, one primary action per screen.
2. **Places and moments as cues,** alongside dates.
3. **Smallest step first,** and a touch counts.
4. **Batch by context.** Make switches visible, and ask for a resume note before switching.
5. **Quiet by default.** Respect focus and calls, "provide nothing" is valid, and "Not now" is free.
6. **No red, no streaks.** Show honest totals in both feeling terms and time terms.
7. **Reversible and explainable.** Undo plus "Why this order?". Signals (e.g. GitHub) only suggest, never auto-complete.
8. **Support fades.** Suggest stepping down once habits hold.
9. **AI stays MCP-only.** The user's assistant may write first steps or sizes; Moduo never does it on its own.

---

## References

- Altgassen, M., Kretschmer, A., & Kliegel, M. (2014). Task dissociation in prospective memory performance in individuals with ADHD. *Journal of Attention Disorders, 18*(7). https://doi.org/10.1177/1087054712445484
- Barkley, R. A. (1997). Behavioral inhibition, sustained attention, and executive functions. *Psychological Bulletin, 121*(1), 65–94. https://doi.org/10.1037/0033-2909.121.1.65
- Barkley, R. A. (1997). *ADHD and the nature of self-control*. Guilford Press.
- Bryan, G., Karlan, D., & Nelson, S. (2010). Commitment devices. *Annual Review of Economics, 2*, 671–698. https://doi.org/10.1146/annurev.economics.102308.124324
- Buehler, R., Griffin, D., & Ross, M. (1994). Exploring the "planning fallacy". *JPSP, 67*(3), 366–381.
- Cai, C. J., Guo, P. J., Glass, J. R., & Miller, R. C. (2015). Wait-learning. *CHI '15*, 3701–3710. https://doi.org/10.1145/2702123.2702267
- Cai, C. J., Ren, A., & Miller, R. C. (2017). WaitSuite. *ACM TOCHI, 24*(1). https://hdl.handle.net/1721.1/112331
- Cheng, J., Teevan, J., Iqbal, S. T., & Bernstein, M. S. (2015). Break it down. *CHI '15*, 4061–4064.
- Dolin, A. (2024, August). The back-to-school toolkit when kids and parents have ADHD. *Attention* (CHADD).
- Dresler, M., et al. (2017). Mnemonic training reshapes brain networks to support superior memory. *Neuron, 93*(5), 1227–1235.e6. https://doi.org/10.1016/j.neuron.2017.02.003
- Gawrilow, C., & Gollwitzer, P. M. (2008). Implementation intentions facilitate response inhibition in children with ADHD. *Cognitive Therapy and Research, 32*(2), 261–280. https://doi.org/10.1007/s10608-007-9150-1
- Gawrilow, C., Gollwitzer, P. M., & Oettingen, G. (2011). If-then plans benefit executive functions in children with ADHD. *J. Social and Clinical Psychology, 30*(6), 616–646.
- Ghibellini, R., & Meier, B. (2025). Interruption, recall and resumption: A meta-analysis of the Zeigarnik and Ovsiankina effects. *Humanities and Social Sciences Communications, 12*. https://doi.org/10.1057/s41599-025-05000-w
- Gollwitzer, P. M. (1999). Implementation intentions. *American Psychologist, 54*(7), 493–503.
- Gollwitzer, P. M., & Sheeran, P. (2006). Implementation intentions and goal achievement: A meta-analysis. *Advances in Experimental Social Psychology, 38*, 69–119.
- Jackson, J. N. S., & MacKillop, J. (2016). ADHD and monetary delay discounting: A meta-analysis. *Biological Psychiatry: CNNI, 1*(4), 316–325. https://doi.org/10.1016/j.bpsc.2016.01.007
- Leroy, S. (2009). Why is it so hard to do my work? *OBHDP, 109*(2), 168–181. https://doi.org/10.1016/j.obhdp.2009.04.002
- Leroy, S., & Glomb, T. M. (2018). Tasks interrupted… "ready-to-resume" plan. *Organization Science, 29*(3), 380–397. https://doi.org/10.1287/orsc.2017.1184
- Ludford, P. J., et al. (2006). Because I carry my cell phone anyway. *CHI '06*, 889–898. https://doi.org/10.1145/1124772.1124903
- Mace, F. C., et al. (1988). Behavioral momentum in the treatment of noncompliance. *JABA, 21*(2), 123–141. https://doi.org/10.1901/jaba.1988.21-123
- Mahan, B. The Wall of Awful (ADHD Essentials podcast; practice concept).
- Masicampo, E. J., & Baumeister, R. F. (2011). Consider it done! *JPSP, 101*(4), 667–683. https://doi.org/10.1037/a0024192
- McFadyen, J., et al. (2021). Doorways do not always cause forgetting. *BMC Psychology*. https://doi.org/10.1186/s40359-021-00536-3
- Milkman, K. L., Minson, J. A., & Volpp, K. G. M. (2014). Temptation bundling. *Management Science, 60*(2), 283–299. https://doi.org/10.1287/mnsc.2013.1784
- Nahum-Shani, I., et al. (2018). Just-in-time adaptive interventions in mobile health. *Annals of Behavioral Medicine, 52*(6), 446–462. https://doi.org/10.1007/s12160-016-9830-8
- Radvansky, G. A., & Copeland, D. E. (2006). Walking through doorways causes forgetting. *Memory & Cognition, 34*(5), 1150–1156.
- Rosenbaum, D. A., Gong, L., & Potts, C. A. (2014). Pre-crastination. *Psychological Science, 25*(7), 1487–1496. https://doi.org/10.1177/0956797614532657
- Safren, S. A., et al. (2010). CBT vs relaxation with educational support for medication-treated adults with ADHD. *JAMA, 304*(8), 875–880. https://doi.org/10.1001/jama.2010.1192
- Sirois, F., & Pychyl, T. (2013). Procrastination and the priority of short-term mood regulation. *SPPC, 7*(2), 115–127. https://doi.org/10.1111/spc3.12011
- Solanto, M. V., et al. (2010). Efficacy of meta-cognitive therapy for adult ADHD. *Am J Psychiatry, 167*(8), 958–968. https://doi.org/10.1176/appi.ajp.2009.09081123
- Sonuga-Barke, E. J. S. (2002). Psychological heterogeneity in AD/HD: a dual pathway model. *Behavioural Brain Research, 130*(1–2), 29–36. https://doi.org/10.1016/S0166-4328(01)00432-6
- Steel, P. (2007). The nature of procrastination. *Psychological Bulletin, 133*(1), 65–94.
- Talbot, K.-D. S., & Kerns, K. A. (2014). Event- and time-triggered remembering in children with ADHD. *J. Experimental Child Psychology, 127*. https://doi.org/10.1016/j.jecp.2014.02.011
- van de Pol, J., Volman, M., & Beishuizen, J. (2010). Scaffolding in teacher–student interaction. *Educational Psychology Review, 22*(3), 271–296. https://doi.org/10.1007/s10648-010-9127-6
- Wilson, T. D., & Gilbert, D. T. (2005). Affective forecasting. *Current Directions in Psychological Science, 14*(3), 131–134.
- Wood, D., Bruner, J. S., & Ross, G. (1976). The role of tutoring in problem solving. *JCPP, 17*(2), 89–100.
- Wood, W., & Neal, D. T. (2007). A new look at habits and the habit–goal interface. *Psychological Review, 114*(4), 843–863.
- Wood, W., & Rünger, D. (2016). Psychology of habit. *Annual Review of Psychology, 67*, 289–314.
- *Retracted, do not cite:* Ariely, D., & Wertenbroch, K. (2002). *Psychological Science, 13*(3), 219–224. Retracted 2026-09-02.
