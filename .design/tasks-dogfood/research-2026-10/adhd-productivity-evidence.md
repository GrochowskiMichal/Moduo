# Evidence review: productivity science and ADHD for Moduo's Tasks module (2026-10-09)

> Raw research report, 2026-10-09, kept for its sources. The synthesis and the open calls are in [../RESEARCH-2026-10.md](../RESEARCH-2026-10.md). Nothing here is decided.

## How to read this

**Strength labels:** **Strong** = meta-analysis or multiple RCTs. **Moderate** = several studies, or one strong multi-study paper. **Weak** = a single study, a small sample, qualitative work, or an extrapolation from a different population. **Folk** = popular claim that has never been tested.

**Verification:** citations marked **†** come from my prior knowledge. I could not re-check them in this session: the web-search budget ran out (200/200), and most publisher pages (PMC, Springer, Lancet, Nature, SAGE) returned 403 or CAPTCHA. Citations without † were confirmed through search results or fetched pages this session.

**Biggest caveat:** I found **no study that directly compares a sparse task list with a dense one for adults with ADHD.** Everything on that central question is inferred from general HCI work, attention lab studies, and memory research on ADHD.

---

## A. Visual density, cognitive load and customization

**A1. Clutter predicts search time, and clutter is not the same as item count.** In map-search tasks, Rosenholtz's "feature congestion" measure tracked how long people took to find a target. Feature congestion means variety in colour, contrast and orientation, not the number of items. **Moderate** (lab, general population). Rosenholtz, Li & Nakano 2007, *J. Vision* 7(2) — https://dspace.mit.edu/handle/1721.1/37287
→ *Implication:* reduce visual congestion (saturated colours, chip styles, icon variety), not information. Reserve strong colour for one or two meanings.

**A2. Grouping predicts search time better than raw density.** Tullis analysed 520 displays. The best predictors of search time were the number of perceptual groups and the size of those groups, not overall density. The regression generalised to 150 new displays (r = .80). **Moderate** (older but robust). Tullis 1983/84 — https://core.ac.uk/display/4438915
→ *Implication:* a denser list can be fine if it is strongly grouped (Next / In flight / Later). Fix grouping before you remove fields.
I found no study of dashboard density as such; Tullis and Rosenholtz are the closest evidence.

**A3. Minimalism is not neutral, and preferences differ between people.** Charts with visual embellishment were remembered better and understood no worse (Bateman et al. 2010, CHI†). People's preferred level of website visual complexity varies with age, education and country (Reinecke et al. 2013, CHI†). Both **Weak–moderate**.
→ *Implication:* there is no universally "correct" density. Individual differences are real.

**A4. People with ADHD are more distracted by irrelevant items, but relevant load protects them just as much as controls.** Adults with ADHD showed larger interference from task-irrelevant distractors (cartoon pictures) during letter search. Raising the perceptual load of the task itself cut that interference as effectively for the ADHD group as for controls. The mechanism comes from Lavie's load theory, which is well supported in the general population. **Weak–moderate** (one small lab study). Forster, Robertson, Jennings, Asherson & Lavie **2014**, *Neuropsychology* 28(1):91–97 (online 2013) — https://discovery.ucl.ac.uk/id/eprint/1425379/
→ *Implication:* this is the most important finding for the quiet-versus-rich question. **Task-relevant information is not the enemy. Irrelevant chrome is, and it costs ADHD users more.**

**A5. Irrelevant decoration costs attention.** Kindergartners in a heavily decorated classroom spent more time off-task and learned less. **Weak** (n = 24, children, not ADHD). Fisher, Godwin & Seltman 2014, *Psych. Science*†.
→ *Implication:* decorative visuals in the work area are a cost, not a comfort.

**A6. Sensory profiles in ADHD vary in both directions.** Adults with ADHD reported more sensation *avoiding* and more sensation *seeking* than controls (Bijlenga et al. 2017, *Eur. Psychiatry*†). Background noise helped attention in ADHD but hurt controls (Söderlund et al. 2007, *JCPP*†; this is the "moderate brain arousal" account). **Weak–moderate.**
→ *Implication:* there is no single "ADHD-correct" density. Some users will want calm and others stimulation. This is the strongest evidence-based argument for letting users choose.

**A7. "Out of sight, out of mind" is real, but the mechanism is not "object permanence."**
- Adults with ADHD have working-memory deficits. **Moderate–strong** (Alderson et al. 2013 meta-analysis†).
- *Time-based* prospective memory (remembering to act at a time) is clearly impaired in ADHD. *Event-based* prospective memory (acting when a cue appears) is largely spared. **Moderate.** Altgassen, Kretschmer & Kliegel 2014, *J. Atten. Disord.* 18(7) — https://doi.org/10.1177/1087054712445484 ; Talbot, Müller & Kerns review — https://uvic.academia.edu/KarleyDaleTalbot
- In children, the time-based deficit was fully explained by less *strategic* clock-checking, according to a search-result summary (I did not open the paper). **Weak.** https://link.springer.com/article/10.1038/s41598-025-08944-w
- Offloading intentions to external tools reliably improves prospective memory in the general population. **Moderate–strong.** Gilbert, Boldt, Sachdeva, Scarampi & Tsai 2022/23 review — https://pmc.ncbi.nlm.nih.gov/articles/PMC9971128/
- Qualitative support: one interviewee said that a reminder only they set for themselves "just becomes invisible after a few days." **Weak.** Chen, Meng & Nie, CSCW 2026 (n = 22 + 20) — https://arxiv.org/abs/2603.17258
→ *Implication:* make things visible **at the moment and place of action**, and anchor reminders to events. Visibility does not require density: a few well-placed cues beat a long wall of items.

**A8. Progressive disclosure has a real trade-off.** Reduced "training wheels" interfaces helped novices learn (Carroll & Carrithers 1984†). In a controlled study, a minimal layered interface improved how easily people found features, but users of the full interface were more aware of the advanced features. **Moderate.** Findlater & McGrenere 2007, INTERACT — https://faculty.washington.edu/leahkf/pubs/Interact2007-findlater.pdf
→ *Implication:* a quiet default must still signal what is hidden, for example "+3 fields", counts, or a visible density switch. Otherwise users never learn the richer mode exists.

**A9. Defaults stick, few people customize, and user control beats automatic adaptation.**
- Defaults change behaviour substantially: d = 0.68 across 58 studies with 73,675 participants. **Strong.** Jachimowicz et al. 2019, *Behav. Public Policy* — https://ideas.repec.org/a/cup/bpubpo/v3y2019i02p159-186_00.html
- Mackay (1991; 51 users) found that most people do not customize. The barriers were lack of time and difficulty. Customization was triggered by annoyance or by noticing repeated patterns. https://www.lri.fr/~mackay/pdffiles/CHI91.Triggers.pdf
- Page et al. (1996) found that 92% of *heavy WordPerfect users* customized something, and the heaviest users customized most. https://chi1996.acm.org/proceedings/papers/Page/srp_txt.html
- *Reconciling the two:* the people who customize are heavy users who are already engaged. Most users live with the default. Both studies are old and small: **Weak–moderate.**
- Users preferred *adaptable* menus (they control them) over *adaptive* ones (the system changes them). Static menus were fastest. **Moderate** (n = 27). Findlater & McGrenere 2004, CHI — https://www.cs.ubc.ca/labs/edapt/papers/findlater2004.pdf
- Asking people to make an *active choice* at setup raised retirement-plan enrolment sharply compared with an opt-in default. **Strong** in that domain. Carroll et al. 2009, *QJE*†.
→ *Implication:* the default has to serve the majority who never change it. Offer the choice actively once (onboarding), then put a one-click switch at friction moments, which are Mackay's triggers. Use user-controlled presets; do not let the app silently re-densify itself.

---

## B. ADHD and task management

**B1. Structured skills training for adults with ADHD has modest support.** Its content overlaps heavily with what a task app does: one calendar plus one task list, prioritising, breaking tasks down, and postponing distractions.
- Safren et al. 2010, *JAMA*: n = 86 adults already on medication. CBT beat relaxation-plus-education on blinded ratings through 12 months. https://anhoriga.se/Artiklar-och-rapporter/2010/cognitive-behavioral-therapy-vs-relaxation-with-educational-support-for-medication-treated-adults-with-adhd-and-persistent-symptoms-a-randomized-controlled-trial
- Solanto et al. 2010, *AJP*: n = 88. Group meta-cognitive therapy for time management, organisation and planning gave a 53% response rate versus 28% for supportive therapy. https://pubmed.ncbi.nlm.nih.gov/20231319/
- Meta-analyses: Knouse, Teller & Brooks 2017, *JCCP*† (moderate effects). Cochrane, Lopez et al. 2018† (low-quality evidence).
- Ostinelli et al. 2025, *Lancet Psychiatry* 12(1):32–43, a network meta-analysis of 113 RCTs: stimulants and atomoxetine were the **only** interventions that improved core symptoms in the short term on *both* self- and clinician-rated scales. I could not open the full text to check the CBT-specific result. https://iris.unimore.it/handle/11380/1368079
- **Moderate** overall.
→ *Implication:* build in the CBT/MCT habits (single trusted list, scheduled review, chunking). Never claim the app treats ADHD.

**B2. Digital tools for ADHD: promising, but only weakly tested.**
- Moëll et al. 2015, *Internet Interventions*: an online course teaching adults with ADHD to use smartphone apps (n = 57, waitlist control). Large self-reported gains in organisation and attention. https://doaj.org/article/1b7369c5f7174fb7a75c47bdf1fceb47
- Antshel, McBride & Knouse 2025, *J. Atten. Disord.*: the Inflow CBT app (n = 154, waitlist control). Self-reported inattention and organisation improved. No change in functional impairment. The sample was mostly female and college-educated. https://doi.org/10.1177/10870547251384462
- **Weak–moderate.** I found **no RCT of a general-purpose to-do or planner app** in ADHD.
→ *Implication:* every Moduo ADHD feature is plausible but unproven. Instrument the features and run your own A/B tests.
Organizational skills training has RCT support in children (Abikoff et al. 2013, *JCCP*†). I did not review it for adults.

**B3. Implementation intentions (if-then plans).** In general, forming an if-then plan has a meta-analytic d = .65 (Gollwitzer & Sheeran 2006†). A 2025 update across 642 tests found d between .27 and .66. Effects were larger with an explicit *if-then* format, high motivation, and rehearsal. **Strong.** Sheeran, Listrom & Gollwitzer 2025, *Eur. Rev. Soc. Psych.* — https://kops.uni-konstanz.de/handle/123456789/69905
For ADHD specifically, if-then plans brought children with ADHD up to control levels on a Go/NoGo inhibition task (Gawrilow & Gollwitzer 2008 — https://doi.org/10.1007/s10608-007-9150-1). That is **Weak–moderate** support for adult task management, because it extrapolates from children and a lab inhibition task.
→ *Implication:* let a task carry an optional "when X, I'll…" trigger, not only a date.

**B4. Breaking tasks down.** Breaking a task into steps ("unpacking") produced longer and more accurate time estimates, and helped more for complex tasks. **Moderate.** Kruger & Evans 2004, *JESP* 40:586†. Children who set close subgoals progressed faster than those with distant goals. **Moderate**, a classic single study. Bandura & Schunk 1981, *JPSP*†.
→ *Implication:* make "break it down" a first-class action. It is also the natural response when the drift dot appears.

**B5. Time perception, visual timers and delay aversion.**
- ADHD is associated with steeper delay discounting: 21 studies, about 4,000 participants. **Moderate–strong.** Jackson & MacKillop 2016 — https://experts.mcmaster.ca/scholarly-works/275822
- ADHD is also associated with greater sensitivity to how quickly and how often rewards arrive (Sonuga-Barke dual-pathway model 2002†; Luman et al. 2005 review†).
- I found **no RCT of visual timers** for adults. The rationale is only mechanistic: an externally visible clock substitutes for the impaired strategic clock-checking. **Weak.**
→ *Implication:* make payoff immediate (visible progress at the moment of completion; short focus blocks). A visible remaining-time display in Focus is sensible, but say plainly that it is unproven.

**B6. Gamification and streaks.**
- A semester-long classroom study with badges and leaderboards found *lower* intrinsic motivation and satisfaction, which in turn lowered exam scores. **Moderate** (single study). Hanus & Fox 2015, *Computers & Education* 80†.
- Across seven studies, a logged *broken* streak reduced later engagement compared with an intact one. The drop was worse when people blamed themselves for the break, and smaller when the streak could be "repaired." **Moderate.** Silverman & Barasch 2023, *JCR* 49(6) — https://udspace.udel.edu/handle/19716/34160
- Gamification evidence for adults with ADHD is **weak** (mostly children's games and neurofeedback).
→ *Implication:* "no streaks or confetti" is defensible. If progress is ever counted, use cumulative counts or repairable streaks, never consecutive-day streaks.

**B7. Emotion, overdue items and shame.**
- Emotion dysregulation in adults with ADHD is large: Hedges' g = 1.17 across 13 studies (n = 2,535). **Moderate–strong.** Beheshti et al. 2020 — https://bmcpsychiatry.biomedcentral.com/articles/10.1186/s12888-020-2442-7
- "Rejection sensitive dysphoria" (RSD) rests on case series and focus groups (n = 4–43), has no validated measure, and is in neither DSM nor ICD. **Weak/Folk.** Summary: https://www.psychologytoday.com/us/blog/if-i-be-waspish/202604/rejection-sensitivity-dysphoria-the-actual-research
- Students who forgave themselves for procrastinating felt less negative affect afterwards and procrastinated less before the next exam (n = 134, prospective but correlational). **Weak–moderate.** Wohl, Pychyl & Bennett 2010†.
- Self-reported procrastination is associated with ADHD symptoms in students (Niermann & Scheres 2014†).
- Qualitative: shame spirals when lists go unfollowed — "Every time I write a plan, I get anxious." (Chen et al. 2026)
→ *Implication:* overdue and drift signals should **inform and offer a repair** (reschedule, break down, drop) and should not accuse. Note that "red worsens performance" is not supported by meta-analysis (Gnambs 2020†). The case against red walls rests on volume, framing and affect, not on colour science.

**B8. Choice paralysis and decision fatigue are weaker than claimed.**
- Choice overload averaged roughly **zero** across 50 experiments (5,036 participants). **Strong.** Scheibehenne, Greifeneder & Todd 2010 — https://madoc.bib.uni-mannheim.de/30861/
- It appears only under specific conditions: complex choice sets and uncertain preferences (Chernev et al. 2015†).
- Ego depletion failed its multi-lab replications: d ≈ .04 in Hagger et al. 2016† and similar in Vohs et al. 2021†.
→ *Implication:* justify the Queue ("just show me what's next") by working-memory load and difficulty getting started, not by "decision fatigue."

**B9. Single-task "focus" views.** I found **no direct evidence** in ADHD. The case is indirect only: switch costs, attention residue (both covered previously), and A4's finding that irrelevant distractors cost ADHD users more. **Weak** (extrapolated).
→ *Implication:* fine to ship. Measure completion rates instead of assuming it works.

**B10. Urgent versus important.** Across several studies, people chose tasks with mere *apparent* urgency over tasks with objectively larger payoffs. **Moderate** (one multi-study paper). Zhu, Yang & Hsee 2018, *JCR* 45(3):673–690 — https://econbiz.de/Record/the-mere-urgency-effect-zhu-meng/10011929694
The Eisenhower matrix itself has **never been tested**.
→ *Implication:* countdowns and red "due soon" cues pull attention toward the wrong work. Show importance or outcome alongside the date.

**Updates to previously covered topics:** no newer findings changed the earlier conclusions, though my search was limited. Social scaffolding (body doubling, a friend checking in) again came out as central in the 2026 CSCW interviews. That is still **qualitative/weak** evidence, but it is consistent.

---

## C. General productivity science

**C1. Concrete when-and-where plans.** In a field study, prompting employees to write down a date and time raised flu vaccination by about 4 percentage points (Milkman et al. 2011, *PNAS*†). Together with B3: **Strong.**
→ *Implication:* turning a task into a scheduled slot, or an if-then plan, is one of the best-evidenced micro-features available.

**C2. The planning fallacy and estimates.** People routinely underestimate how long tasks take (Buehler, Griffin & Ross 1994†, widely replicated: **Strong**). Part of the cause is misremembering how long past tasks took (Roy, Christenfeld & McKenzie 2005, *Psych. Bull.*†). Breaking tasks down helps (B4).
→ *Implication:* the capacity mirror ("~5h lined up") should use the user's **own past estimate-to-actual ratio** as its reference class, for example "you usually take 1.4× your estimate." Raw estimates are systematically optimistic.

**C3. Time management works mostly on wellbeing.** A meta-analysis of 158 studies (53,957 participants) found r ≈ .25 with job performance and *larger* associations with wellbeing and life satisfaction. The data are correlational. **Moderate.** Aeon, Faber & Panaccio 2021, *PLOS ONE* — https://doi.org/10.1371/journal.pone.0245066
I found no RCT of time-blocking or timeboxing specifically.
→ *Implication:* pitch planning features as giving a sense of control and calm, not as an output multiplier.

**C4. Zeigarnik fails; Ovsiankina holds.** In a 2025 meta-analysis, unfinished tasks were **not** remembered better than finished ones (ratio 0.99). But people did tend to resume interrupted tasks (about 67% versus a 50% baseline). **Moderate.** Ghibellini & Meier 2025, *Humanities & Social Sciences Communications* 12 — https://ideas.repec.org/a/pal/palcom/v12y2025i1d10.1057_s41599-025-05000-w.html
→ *Implication:* a visible unfinished item plus a "where I left off" note works *with* the real tendency to resume. Don't write copy saying "unfinished tasks haunt your memory."

**C5. Making a plan for an unfinished goal reduced intrusive thoughts about it.** Masicampo & Baumeister 2011, *JPSP* 101(4) (DOI 10.1037/a0024192). The studies had small samples and come from the same lab era as ego depletion. I found no high-powered direct replication. **Weak–moderate.**
→ *Implication:* "capture it, then give it a when" is plausible relief. Don't overclaim it.

**C6. Visible progress.**
- Prompting people to monitor their progress improved goal attainment (d = .40, 138 studies, N = 19,951). The effect was **larger when progress was physically recorded or made public**. **Strong.** Harkin et al. 2016, *Psych. Bull.* — https://eprints.whiterose.ac.uk/91437/
- People speed up as they near a goal (goal-gradient effect; Kivetz, Urminsky & Zheng 2006†) and work harder when given a head start (endowed progress; Nunes & Drèze 2006†). **Moderate.**
- Amabile & Kramer's "progress principle" (diaries from 238 workers) is correlational. **Weak–moderate.**
→ *Implication:* a done list and "3 of 5 steps" indicators are among the best-supported features. Keep them free of streaks.

**C7. Fresh starts and recovery.** People are more likely to start aspirational behaviour at temporal landmarks such as a new week, month or birthday (the "fresh start effect"; Dai, Milkman & Riis 2014, *Mgmt Sci*†). **Moderate.** Milkman et al.'s 2021 gym megastudy† found that most intuitive nudges had small effects. I could not re-check which arms came out on top.
→ *Implication:* offer a Monday or month-start re-plan that clears accumulated drift and welcomes the user back without guilt.

**C8. Deadlines.**
- ~~Self-imposed deadlines helped, but less than evenly spaced external ones (Ariely & Wertenbroch 2002†). **Moderate.**~~ **Do not cite:** per Mike's "Along the way" research (shared 2026-10-10), *Psychological Science* retracted this paper on 2026-09-02 after a failed preregistered replication and data anomalies. Not independently verified here.
- A deadline framed as falling in the "current" period prompted earlier starts (Tu & Soman 2014, *JCR*†).
- Longer deadlines made tasks seem harder and reduced completion (the "mere deadline effect"; Zhu, Bagchi & Hock 2019, *JCR*†). **Moderate.**
→ *Implication:* for big tasks, suggest spaced check-ins and "this week" framing rather than one distant date.

**C9. Low-evidence rituals.**
- Temptation bundling worked in a small first study (Milkman et al. 2014†) and had smaller, fading effects at scale (Kirgios et al. 2020†): **Weak–moderate.**
- GTD's weekly review has only a theoretical paper behind it (Heylighen & Vidal 2008†) and no trials: **Folk/untested.**
- The Eisenhower matrix has never been tested.
→ *Implication:* offer these as optional rituals. Don't present them as science.

**C10. Energy and chronotype.**
- Performance is better at a person's preferred time of day (the synchrony effect; May, Hasher & Stoltzfus 1993†). Later replications are mixed: **Weak–moderate.**
- ADHD is associated with later chronotypes (Coogan & McGowan 2017 review†): **Moderate.**
- Per-task "energy" tagging has **no evidence**.
→ *Implication:* keep the energy field optional and hidden by default. It works as a self-knowledge aid, not as an evidence-based scheduler.

**C11. Team visibility.**
- Making individual contributions identifiable reduces social loafing (Karau & Williams 1993 meta-analysis†): **Strong.**
- Progress monitoring works better when it is public (C6).
- However, at a factory, full observation suppressed productive improvisation, and adding privacy curtains raised productivity by 10–15% (Bernstein 2012, *ASQ*†): **Moderate** (single field site).
→ *Implication:* show **ownership and status** (who's on what, what's in flight) but not live activity. Keep the personal Queue private by default.

---

## D. Notifications and interruptions

**D1. Interruptions have costs.**
- Interrupted workers made up for interruptions by working faster, but reported more stress, frustration and time pressure (Mark, Gudith & Klocke 2008, CHI†): **Moderate.**
- Interruptions of only 2.8 seconds doubled sequence errors, and 4.4 seconds tripled them. **Moderate** (lab). Altmann, Trafton & Hambrick 2014 — https://www.interruptions.net/literature/Altmann-JExpPsycholGen14.pdf
- Merely *receiving* a phone notification impaired attention (Stothart et al. 2015†).

**D2. Timing matters.** Interruptions delivered at natural task breakpoints caused less annoyance and less performance cost (Adamczyk & Bailey 2004†; Iqbal & Bailey 2008†): **Moderate.**

**D3. Batching works; zero notifications backfires.** In a field RCT (n = 237), batching notifications three times a day improved attention, mood, productivity, stress and sense of control. It also **raised fear of missing out compared with the control group**. **Hourly batching had no benefit.** Receiving **no** notifications left people *more* anxious than control. **Moderate.** Fitz et al. 2019, *Computers in Human Behavior* 101:84–94 — https://doi.org/10.1016/j.chb.2019.07.016

**D4. ADHD-specific evidence is thin.**
- In the general population (n = 221, within-subject), weeks with phone alerts on produced more self-reported inattention and hyperactivity. **Moderate.** Kushlev, Proulx & Dunn 2016, CHI — https://www.interruptions.net/literature/Kushlev-CHI16.pdf
- Frequent digital media use predicted later ADHD symptoms in adolescents (Ra et al. 2018, *JAMA*†; longitudinal, small odds ratio).
- I found **no trial of notification policies in adults diagnosed with ADHD.**
- **The tension to resolve:** time-based prospective memory is impaired in ADHD (A7), so these users need *more* cue-based reminders, yet ambient alerts worsen attention.
→ *Implication:* default to a quiet digest a few times a day, delivered at breakpoints such as the end of a Focus block. Accept a small fear-of-missing-out cost, and offset it with a few precise, event-anchored reminders (in-flight check-backs). Don't make silent the recommended default. Note that Fitz studied all phone notifications, not one app's.

---

## (1) The 10 most evidence-backed design implications

1. **Show what is relevant; strip what is irrelevant.** Next, In flight and Blocked should be visible by default. Decoration, colour variety and chip noise should go. (Forster 2014; Rosenholtz 2007; Altgassen 2014)
2. **Group strongly before you cut.** Grouping predicts search time better than density does. (Tullis)
3. **Reminders and check-backs anchored to events and placed where the user acts**, not date-only pings. (Altgassen 2014; Gilbert et al. 2022)
4. **Let users attach a "when/where" or if-then trigger** to a task. (Sheeran et al. 2025; Gollwitzer & Sheeran 2006; Milkman 2011†)
5. **Visible progress and a done list**, physically recorded. Shared visibility is opt-in. (Harkin 2016; goal gradient†)
6. **Estimates calibrated against the user's own actuals**, plus "break it down" as a first-class action. (Buehler†; Roy 2005†; Kruger & Evans†)
7. **Non-punitive overdue and drift states that always offer a repair.** No consecutive-day streaks. (Beheshti 2020; Silverman & Barasch 2023; Wohl 2010†)
8. **Notifications as a digest about three times a day, delivered at breakpoints.** Accept a small fear-of-missing-out cost, offset it with a few precise event-anchored exceptions, and don't default to zero. (Fitz 2019; Kushlev 2016; Adamczyk & Bailey†)
9. **A good default plus a one-time active choice plus user-controlled density presets** (not automatic adaptation). The quiet mode must show what it hides. (Jachimowicz 2019; Findlater & McGrenere 2004, 2007; Carroll 2009†)
10. **A "where I left off" resume note** on hand-off and interruption. (Leroy & Glomb 2018, covered earlier; Ovsiankina in Ghibellini & Meier 2025)
- *Bonus for teams:* show ownership, not surveillance. (Karau & Williams†; Bernstein†)

## (2) Myths to keep out of product copy

- **"Object permanence" in ADHD.** This is a Piagetian concept about infants, misapplied to adults. The real mechanisms are working-memory and time-based prospective-memory deficits.
- **"Interest-based nervous system"** and **"dopamine menu."** Both are clinical folklore and have never been tested.
- **RSD as an established ADHD feature, or "99% of ADHD people have RSD."** The research consists of tiny qualitative studies, with no validated measure and no DSM/ICD entry.
- **"Unfinished tasks haunt your memory" (Zeigarnik).** A meta-analysis found a ratio of 0.99; only the tendency to resume is real.
- **Decision fatigue or ego depletion as the reason for a feature.** Multi-lab replications failed. The famous "hungry judges" finding has been heavily critiqued.
- **"Too many choices paralyse."** The average effect is about zero; it holds only under specific conditions.
- **"Gamification works for ADHD."** The evidence for adults is unproven, and broken streaks backfire.
- **"It takes 23 minutes to refocus."** This misquotes Mark's field data about how long people take to return to an interrupted task.
- **"The Eisenhower matrix / GTD / Pomodoro is proven."** None has been trialled as such. Biwer 2023 tested *systematic breaks*, not "25 minutes."
- **"Red makes you perform worse."** This is not supported by meta-analysis.
- **"21 days to form a habit."** The median was 66 days, ranging from 18 to 254 (Lally et al. 2010†).
- **"Wall of awful."** A vivid clinical metaphor, never tested.
- **The written-goals statistics** (the "Harvard/Yale study"; "42% more likely"). The first is apocryphal and the second comes from an unpublished conference presentation.

## (3) Should an ADHD-oriented task app default to quiet/minimal or information-rich, and should users choose?

**There is no direct trial, and "quiet versus rich" is partly the wrong axis.** The evidence separates three different kinds of load:

- **Relevant information load is helpful or neutral.** Adults with ADHD benefit as much as controls when the focal task carries more relevant load (Forster 2014). Search time depends on grouping, not density (Tullis). Time-based memory fails while event-based memory holds (Altgassen 2014), so what is needed should be *visible at the point of action*. The folk observation "out of sight, out of mind" is right; its explanation is wrong.
- **Irrelevant visual load is harmful, and more so in ADHD** (Forster 2014; Fisher 2014†).
- **Affective load is harmful in a population with large emotion dysregulation** (g ≈ 1.17). This covers red overdue walls, counts framed as debt, and broken streaks.

**Recommendation:**
- Default to **"complete but calm."**
  - The things needed for the *next decision* are visible without clicks: what's next, what's in flight and its check-back date, what's due this week, and the capacity mirror.
  - Everything is strongly grouped, with low colour congestion.
  - Nothing is hidden without a visible count.
  - Overdue and drift states are gentle and always come with a repair action.
- Because defaults stick (d = 0.68) and most people never customize (Mackay), **the default itself must already meet the "out of sight" need.** Do not rely on ADHD users discovering a richer mode.
- **On letting users choose, the evidence is supportive but indirect:**
  - ADHD sensory profiles vary in both directions (Bijlenga†).
  - Users prefer controlling adaptations themselves over having the system do it, and static layouts are fastest (Findlater & McGrenere 2004).
  - Engaged heavy users do customize (Page 1996).
  - An active choice at onboarding beats a silent default (Carroll 2009†).
- **So offer 2–3 named density presets** (for example Calm / Standard / Dense), as an active choice once during onboarding plus a one-click switch where friction appears. Avoid a long list of individual toggles: the barriers to customizing are time and difficulty.
- **What has no evidence either way:** how many ADHD users prefer dense layouts, whether a single-task Focus view improves completion, and whether visual timers help adults. Instrument and test these rather than asserting them.
