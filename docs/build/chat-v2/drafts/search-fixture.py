#!/usr/bin/env python3
"""CV-0 spike 5 fixture: 100,000 chat messages in Polish and English, for search.

Usage: python3 -I search-fixture.py OUT_DIR [TOTAL]

Writes into OUT_DIR (seeded, so every run gives the same files):
  ws_members.csv  workspace_id,user_id
  channels.csv    id,workspace_id,kind,is_private,name
  members.csv     channel_id,user_id,workspace_id
  messages.csv    id,workspace_id,channel_id,parent_id,author_id,body,body_text,created_at
  queries.csv     qid,kind,workspace_id,user_id,query
  personas.csv    role,workspace_id,user_id   (member · plain · outsider · w2 · w3)

3 workspaces (60 / 30 / 10 % of the rows), 50 conversations (public, private, DMs),
Zipf traffic per channel; W1's private "ops" carries most of the newest traffic, so a
non-member's newest matches are unreadable (the starvation case). body_text drops v1
tokens (<@uuid>, <!channel>, <moduo:...|label>) and Markdown marks, so no person id and
no reference label becomes a word. CV-19's chat_search.test.sql can reuse it.
"""
import csv, datetime, os, random, re, sys, uuid
from collections import Counter

R = random.Random(20261014)
OUT = sys.argv[1]
TOTAL = int(sys.argv[2]) if len(sys.argv) > 2 else 100_000
os.makedirs(OUT, exist_ok=True)


def uid():
    return str(uuid.UUID(int=R.getrandbits(128), version=4))


def zipf_weights(n, s=1.1):
    return [1 / (i + 1) ** s for i in range(n)]


PL = [
    "Czy ktoś sprawdził zadania na jutro?", "Skończyłem to zadanie, możesz zerknąć?",
    "Zaczynam pracę nad zadaniem z {proj}.", "Mamy problem z wdrożeniem na produkcję.",
    "Spotkanie przesuwamy na {day} o {time}.", "Dzięki, wygląda dobrze!", "Daj znać, jak skończysz.",
    "Poprawiłem błąd w formularzu logowania.", "Kto bierze przegląd kodu dla {task}?",
    "Wrzuciłem nową wersję makiety, rzućcie okiem.", "Klient prosi o zmianę terminu na {day}.",
    "Nie działa mi lokalne środowisko po aktualizacji.", "Jutro jestem na urlopie, {name} mnie zastępuje.",
    "Ten żółw w biurze znowu uciekł spod biurka.", "Tempo jak żółw, ale idzie do przodu.",
    "Zamknąłem sprint, raport jest w dokumentach.", "Proszę o akceptację budżetu na {proj}.",
    "Czy możemy uprościć ten ekran ustawień?", "Testy przechodzą, scalam gałąź.",
    "Źródło problemu było w pamięci podręcznej.", "Łódź czy Kraków na warsztaty w {day}?",
    "Potrzebuję dostępu do panelu administracyjnego.", "Świetna robota z prezentacją dla klienta!",
    "Zgłoszenie {task} jest już rozwiązane.", "Przenoszę te zadania do następnego sprintu.",
    "Kończymy dzisiaj o {time}, potem retro.", "Mam pytanie odnośnie umowy z dostawcą.",
    "Wdrożenie poszło bez problemów, monitoruję logi.", "Zrobiłem szkic dokumentacji API.",
    "Kto ma klucze do sali konferencyjnej?", "Faktura za październik jest do zapłaty.",
    "Spróbujmy podejścia krok po kroku.", "Zaktualizowałem harmonogram projektu {proj}.",
    "Proszę o przegląd zmian przed {time}.", "Serwer odpowiada wolno od rana.",
    "Zostało nam pięć zadań do końca tygodnia.", "Ustalmy priorytety na {day}.",
    "Dodałem komentarze w zadaniu {task}.", "Wygląda na to, że baza danych jest przeciążona.",
    "Gratulacje z okazji premiery!", "Czy zadaniem zespołu jest też wsparcie klientów?",
    "Przypominam o spotkaniu z zarządem.", "Ładowanie listy trwa za długo na telefonie.",
    "Muszę wyjść wcześniej, jestem pod telefonem.", "Nowa wersja aplikacji jest w sklepie.",
    "Zróbmy krótką rozmowę o {time}.", "Ktoś widział mój zeszyt z notatkami?",
    "Raport sprzedaży wygląda lepiej niż w zeszłym miesiącu.", "Wyślę podsumowanie po spotkaniu.",
    "Zmieniłem kolejność kroków w procesie zamówienia.", "Czy możemy to omówić na żywo?",
    "Odpowiedziałem klientowi w sprawie zwrotu.", "Kolejka zadań w tle rośnie, sprawdzę to.",
    "Przyjęliśmy nową osobę do zespołu, witaj {name}!", "Hasło do wifi zmienia się w poniedziałek.",
]
EN = [
    "Can someone review the deploy before {time}?", "Shipped the fix for the login form.",
    "Moving the standup to {day} at {time}.", "Thanks, looks good to me!", "Let me know when it's done.",
    "Who's taking the code review for {task}?", "Uploaded a new mockup, have a look.",
    "The client wants to push the deadline to {day}.", "My local environment broke after the update.",
    "I'm out tomorrow, {name} covers for me.", "Closed the sprint, the report is in the docs.",
    "Please approve the budget for {proj}.", "Can we simplify the settings screen?",
    "Tests pass, merging the branch.", "The root cause was the cache layer.",
    "I need access to the admin panel.", "Great job on the client presentation!",
    "Ticket {task} is resolved.", "Moving these tasks to the next sprint.",
    "We wrap up at {time}, then retro.", "Question about the vendor contract.",
    "Deploy went fine, watching the logs.", "Drafted the API documentation.",
    "Invoice for October is due.", "Let's try a step by step approach.",
    "Updated the {proj} timeline.", "The server has been slow since the morning.",
    "Five tasks left before the end of the week.", "Let's set priorities for {day}.",
    "Added notes on {task}.", "Looks like the database is overloaded.",
    "Congrats on the launch!", "Reminder: board meeting at {time}.",
    "The list takes too long to load on mobile.", "New build is in the store.",
    "Quick call at {time}?", "Sales report looks better than last month.",
    "I'll send a summary after the meeting.", "Reordered the checkout steps.",
    "Can we discuss this live?", "Replied to the customer about the refund.",
    "The background job queue keeps growing, looking into it.", "Welcome to the team, {name}!",
    "Rollback done, the incident is closed.", "The onboarding checklist needs one more pass.",
    "Pairing on the migration this afternoon.", "Feature flag is on for the beta group.",
]
NAMES = ["Anna", "Mike", "Sofia", "Jana", "Piotr", "Kasia", "Tomek", "Łukasz", "Agnieszka",
         "Zofia", "Michał", "Paweł", "Ewa", "Grzegorz", "Małgorzata", "Alex", "Sam", "Chris"]
DAYS = ["poniedziałek", "wtorek", "środę", "czwartek", "piątek", "Monday", "Tuesday",
        "Wednesday", "Thursday", "Friday"]
PROJ = ["Moduo", "Atlas", "Kestrel", "Żuraw", "Orion", "Wisła", "Helix", "Nimbus"]
STEMS = ["prac", "projekt", "klient", "spotkani", "termin", "raport", "zespoł", "produkt",
         "błęd", "zmian", "wersj", "serwer", "aplikacj", "funkcj", "użytkownik", "zamówieni",
         "faktur", "umow", "dokument", "budżet", "kod", "test", "ekran", "przycisk", "formularz",
         "list", "plik", "folder", "wiadomoś", "rozmow", "decyzj", "pomysł",
         "problem", "wynik", "dział", "sprzedaż", "magazyn", "dostaw", "płatnoś", "konfiguracj",
         "środowisk", "gałęź", "przegląd", "harmonogram", "priorytet", "kolejk", "pamięć",
         "baz", "tabel", "kolumn", "indeks", "zapytani", "wyszukiwani", "powiadomieni"]
ENDS = ["a", "y", "ie", "ę", "ą", "ów", "ami", "ach", "em", "owi", "om", "i", "u", "o"]
EN_ROOTS = ["deploy", "review", "ship", "merge", "build", "test", "design", "plan", "launch",
            "invoice", "client", "server", "query", "index", "cache", "queue", "sprint",
            "ticket", "report", "budget", "contract", "screen", "button", "form", "file",
            "message", "channel", "thread", "decision", "idea", "issue", "result", "team",
            "sale", "order", "payment", "config", "branch", "schedule", "priority", "search"]
EN_SUF = ["", "s", "ed", "ing", "er"]
SYL = ["ka", "ko", "ra", "ro", "ni", "ny", "ło", "ła", "że", "żo", "ść", "ści", "ąg", "ęt",
       "ma", "mi", "po", "pa", "ta", "to", "wa", "wy", "da", "de", "ló", "źr", "cz", "sz"]

# The long tail: inflections plus pseudo-words, Zipf-ranked.
TAIL = [s + e for s in STEMS for e in ENDS] + [r + s for r in EN_ROOTS for s in EN_SUF]
seen = set(TAIL)
while len(TAIL) < 25_000:
    w = "".join(R.choice(SYL) for _ in range(R.randint(2, 4)))
    if w not in seen:
        seen.add(w)
        TAIL.append(w)
R.shuffle(TAIL)
TAIL_W = zipf_weights(len(TAIL), 1.05)


def fill(t):
    return (t.replace("{name}", R.choice(NAMES)).replace("{day}", R.choice(DAYS))
            .replace("{proj}", R.choice(PROJ)).replace("{time}", f"{R.randint(8, 18)}:{R.choice(['00', '15', '30', '45'])}")
            .replace("{task}", f"MOD-{R.randint(1, 4000)}"))


def message(lang_pl, topic, user_ids):
    pool = PL if R.random() < lang_pl else EN
    parts = [fill(R.choice(pool)) for _ in range(R.choices([1, 2, 3], [0.6, 0.3, 0.1])[0])]
    if R.random() < 0.35:
        parts.append(" ".join(R.choices(TAIL, TAIL_W, k=R.randint(1, 6))))
    if R.random() < 0.25:
        parts.append(" ".join(R.choices(topic, k=R.randint(1, 3))))
    if R.random() < 0.03:  # a long message
        parts.append(" ".join(R.choices(TAIL, TAIL_W, k=R.randint(60, 200))))
    if R.random() < 0.05:
        parts.append(f"commit {R.getrandbits(28):07x}")
    if R.random() < 0.04:
        parts.append(f"https://example.com/{R.choice(['doc', 'pr', 'spec'])}/{R.randint(1, 999)}")
    text = " ".join(parts)
    body = text
    if R.random() < 0.08:
        body = f"<@{R.choice(user_ids)}> " + body
    if R.random() < 0.02:
        body = "<!channel> " + body
    if R.random() < 0.02:
        body += f" <moduo:task:{uid()}|Ship the onboarding checklist>"
    if R.random() < 0.08:
        w = text.split(" ")
        i = R.randrange(len(w))
        w[i] = f"**{w[i]}**"
        body = body.replace(text, " ".join(w))
    return body


def strip(body):
    t = re.sub(r"<@[0-9a-f-]{36}>", " ", body)
    t = re.sub(r"<![a-z]+>", " ", t)
    t = re.sub(r"<moduo:[^>|]+(\|[^>]*)?>", " ", t)
    t = re.sub(r"[*_`>~]+", "", t)
    return re.sub(r"\s+", " ", t).strip()


WS = [  # share of rows, Polish share, users, public, private, dms
    (0.60, 0.75, 40, 18, 3, 4),
    (0.30, 0.20, 20, 10, 2, 3),
    (0.10, 0.50, 8, 6, 2, 2),
]
start = datetime.datetime(2025, 10, 14, 7, 0, tzinfo=datetime.timezone.utc)
span = 365 * 86400
personas = []
f_wm = csv.writer(open(f"{OUT}/ws_members.csv", "w", newline=""))
f_ch = csv.writer(open(f"{OUT}/channels.csv", "w", newline=""))
f_me = csv.writer(open(f"{OUT}/members.csv", "w", newline=""))
f_msg = csv.writer(open(f"{OUT}/messages.csv", "w", newline=""))
freq = Counter()
docs = {}  # workspace -> sample of body_texts for multi-word queries
outsider = uid()  # in no workspace at all
personas.append(("nobody", "", outsider))
ws_ids = []
for wi, (share, pl, n_users, n_pub, n_priv, n_dm) in enumerate(WS):
    ws = uid()
    ws_ids.append(ws)
    users = [uid() for _ in range(n_users)]
    for u in users:
        f_wm.writerow([ws, u])
    chans = []  # (id, kind, private, name, members, topic)
    for i in range(n_pub + n_priv + n_dm):
        cid = uid()
        if i < n_pub:
            kind, priv, name = "channel", False, ("general" if i == 0 else f"pub-{i}")
            mem = R.sample(users, max(2, int(n_users * 0.6)))
        elif i < n_pub + n_priv:
            kind, priv, name = "channel", True, ("ops" if i == n_pub else f"priv-{i}")
            mem = R.sample(users[2:], min(len(users) - 2, R.randint(3, 8)))
        else:
            kind, priv, name = "dm", True, None
            mem = R.sample(users[2:], R.choice([2, 2, 3]))
        if wi == 0:  # personas: users[0] is in everything, users[1] in everything but ops
            for p, take in ((users[0], True), (users[1], name != "ops")):
                if take and p not in mem and (kind != "dm" or p == users[0]):
                    mem.append(p)
        topic = R.sample(TAIL[:3000], 12) + (["wdrożenie", "deploy", "incydent", "rollback"] if name == "ops" else [])
        chans.append((cid, kind, priv, name, mem, topic))
        f_ch.writerow([cid, ws, kind, "t" if priv else "f", name or ""])
        for u in mem:
            f_me.writerow([cid, u, ws])
    if wi == 0:
        personas += [("member", ws, users[0]), ("plain", ws, users[1])]
    else:
        personas.append((f"w{wi + 1}", ws, users[0]))
    n = int(TOTAL * share)
    cw = zipf_weights(len(chans), 0.9)
    last = {c[0]: [] for c in chans}
    docs[ws] = []
    for k in range(n):
        frac = k / n
        w = list(cw)
        if wi == 0 and frac > 0.85:  # ops takes over the newest traffic
            w[n_pub] = sum(cw) * 1.5
        ch = R.choices(chans, w)[0]
        cid, kind, priv, name, mem, topic = ch
        body = message(pl, topic, users)
        text = strip(body)
        parent = ""
        if last[cid] and R.random() < 0.15:
            parent = R.choice(last[cid][-50:])
        mid = uid()
        if not parent:
            last[cid].append(mid)
        ts = start + datetime.timedelta(seconds=span * frac + R.random() * 30)
        f_msg.writerow([mid, ws, cid, parent, R.choice(mem), body, text, ts.isoformat()])
        if wi == 0 or R.random() < 0.5:
            for t in re.findall(r"\w+", text.lower()):
                freq[t] += 1
        if R.random() < 0.01:
            docs[ws].append(text)
csv.writer(open(f"{OUT}/personas.csv", "w", newline="")).writerows(personas)

# 200 queries of mixed frequency, 1-3 words.
rank = [w for w, _ in freq.most_common() if len(w) >= 3 and not w.isdigit()]
pl_acc = [w for w in rank[:4000] if re.search(r"[ąćęłńóśźż]", w)]
deacc = str.maketrans("ąćęłńóśźż", "acelnoszz")
pick = lambda lo, hi, k: R.sample(rank[lo:hi], k)
Q = []
Q += [("common", w) for w in pick(0, 60, 40)]
Q += [("mid", w) for w in pick(200, 3000, 40)]
Q += [("rare", w) for w in R.sample([w for w in rank if freq[w] <= 5], 30)]
def from_doc(n_words):
    while True:
        words = [w for w in re.findall(r"\w+", R.choice(docs[ws_ids[0]]).lower()) if len(w) >= 3 and not w.isdigit()]
        if len(words) >= n_words:
            return " ".join(R.sample(words, n_words))
Q += [("two", from_doc(2)) for _ in range(35)]
Q += [("three", from_doc(3)) for _ in range(20)]
Q += [("prefix", w[: R.randint(3, 5)]) for w in pick(20, 1500, 14)] + [("prefix", "zadan")]
Q += [("unaccent", w.translate(deacc)) for w in R.sample(pl_acc, 9)] + [("unaccent", "zolw")]
Q += [("special", q) for q in ['"step by step"', '"zadania na jutro"', '"monitoruję logi"', "MOD-142",
                               "mod-2048", "qwertyuiopx", "zzzyyyxxx brak", "nonexistentword", "żółw", "deploy or wdrożenie"]]
assert len(Q) == 200, len(Q)
pmap = {r: (w, u) for r, w, u in personas}
qw = csv.writer(open(f"{OUT}/queries.csv", "w", newline=""))
for i, (kind, q) in enumerate(Q):
    role = R.choices(["member", "plain", "w2", "w3"], [0.70, 0.15, 0.10, 0.05])[0]
    w, u = pmap[role]
    qw.writerow([i + 1, kind, w, u, q])
print(f"messages={sum(int(TOTAL * s[0]) for s in WS)} distinct_words={len(freq)} out={OUT}")
