#!/usr/bin/env python3
"""
Moyenne des notes Letterboxd des viewers pour chaque film du Cinédimanche.

Fichiers nécessaires dans le même dossier :
  - letterboxd-viewers.csv   (Twitch;Letterboxd;Lien)
  - films.txt                (un film par ligne, voir plus bas)

Lancer :   python notes_letterboxd.py
Résultat : notes.js (lu par la page cinedimanche-roue.html) + notes.json

films.txt : une ligne par film, au choix
    Alice in wonderland
    65;Alice in wonderland
    65;Alice in wonderland;alice-in-wonderland-2010     <- slug Letterboxd forcé
Le bouton « Exporter la liste » de l'onglet Historique génère ce fichier.
Le slug, c'est la fin de l'adresse  letterboxd.com/film/<slug>/
Le script essaie de retrouver le film tout seul (recherche Letterboxd, puis
titres vus dans les profils des viewers). Si c'est le mauvais film, force le slug.

Installation :  pip install requests curl_cffi
"""
import argparse, csv, html as htmllib, json, os, re, sys, time, unicodedata, urllib.parse
import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
try:
    from curl_cffi import requests as cr   # imite un vrai navigateur (évite le 403)
    IMPERSONATE = True
except ImportError:
    import requests as cr
    IMPERSONATE = False

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
BASE = "https://letterboxd.com"
CACHE = ".cache_profils.json"


class Blocked(Exception):
    pass


def get(sess, url, delay):
    for attempt in range(3):
        time.sleep(delay)
        try:
            r = sess.get(url, timeout=25)
        except Exception as e:
            print(f"   réseau : {e}")
            time.sleep(3)
            continue
        if r.status_code == 200:
            return r.text
        if r.status_code == 404:
            return None
        if r.status_code in (403, 429, 503):
            print(f"   Letterboxd répond {r.status_code} (blocage ou trop de requêtes), pause…")
            time.sleep(10 * (attempt + 1))
            continue
        return None
    raise Blocked(url)


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"\(\d{4}\)\s*$", "", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def is_real_review(text):
    """Faux positif de Letterboxd : 'There is no review for this diary entry. Add a review?'"""
    t = (text or "").strip().lower()
    return bool(t) and "no review for this" not in t and "add a review" not in t \
        and "pas de critique" not in t and "ajouter une critique" not in t


def fetch_review(sess, user, slug, delay):
    """Texte de la critique écrite d'un viewer sur un film ('' s'il n'y en a pas)."""
    page = get(sess, f"{BASE}/{user}/film/{slug}/", delay)
    if not page:
        return ""
    for m in re.finditer(r'<div class="[^"]*(?:js-review-body|review body-text)[^"]*"[^>]*>(.*?)</div>', page, re.S):
        block = m.group(1)
        if "<p" not in block:
            continue
        block = re.sub(r"<br\s*/?>", " ", block)
        block = re.sub(r"</p>", "\n", block)
        text = htmllib.unescape(re.sub(r"<[^>]+>", "", block))
        text = re.sub(r"\s*\n\s*", " ", text).strip()
        if is_real_review(text):
            return text if len(text) <= 400 else text[:399].rstrip() + "…"
    return ""


def read_viewers(path):
    out = []
    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.reader(f, delimiter=";"):
            if len(row) < 3 or row[0].strip().lower() == "twitch":
                continue
            m = re.search(r"letterboxd\.com/([^/\s]+)", row[2])
            out.append({"twitch": row[0].strip(), "user": m.group(1) if m else row[1].strip()})
    return out


def read_films(path):
    films = []
    with open(path, encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = [p.strip() for p in line.split(";")]
            num, slug = None, None
            if len(parts) == 1:
                title = parts[0]
            elif parts[0].isdigit():
                num = int(parts[0])
                title = parts[1]
                slug = parts[2] if len(parts) > 2 and parts[2] else None
            else:
                title, slug = parts[0], (parts[1] or None)
            films.append({"num": num, "title": title, "slug": slug, "how": "forcé" if slug else None})
    return films


def find_slug(sess, title, delay):
    """Recherche Letterboxd (peut échouer : on a alors un plan B)."""
    try:
        page = get(sess, f"{BASE}/search/films/{urllib.parse.quote(title)}/", delay)
    except Blocked:
        return None
    if not page:
        return None
    m = (re.search(r'data-(?:film|item)-slug="([^"]+)"', page)
         or re.search(r'data-(?:target|item)-link="/film/([^/"]+)/"', page)
         or re.search(r'href="/film/([^/"?#]+)/?"', page))
    return m.group(1) if m else None


def parse_items(page):
    """Renvoie {slug: (nom, note sur 5 ou None)} pour une page de profil."""
    res = {}
    for block in re.findall(r"<li\b.*?</li>", page, re.S):
        s = (re.search(r'data-film-slug="([^"]+)"', block)
             or re.search(r'data-item-slug="([^"]+)"', block)
             or re.search(r'/film/([^/"]+)/', block))
        if not s:
            continue
        n = (re.search(r'data-film-name="([^"]+)"', block)
             or re.search(r'data-item-name="([^"]+)"', block)
             or re.search(r'alt="(?:Poster for )?([^"]+)"', block))
        r = (re.search(r'data-owner-rating="(\d+)"', block)
             or re.search(r"\brated-(?:large-)?(\d+)\b", block))
        note = int(r.group(1)) / 2 if r else None
        res[s.group(1)] = (htmllib.unescape(n.group(1)) if n else "", note if note else None)
    return res


def scan_user(sess, user, delay, max_pages):
    out, seen = {}, set()
    for p in range(1, max_pages + 1):
        url = f"{BASE}/{user}/films/" + (f"page/{p}/" if p > 1 else "")
        page = get(sess, url, delay)
        if page is None:
            if p == 1:
                print("   profil introuvable ou privé")
            break
        items = parse_items(page)
        if not (set(items) - seen):
            break
        seen |= set(items)
        for slug, (name, note) in items.items():
            out[slug] = {"n": name, "r": note}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--viewers", default="letterboxd-viewers.csv")
    ap.add_argument("--films", default="films.txt")
    ap.add_argument("--delay", type=float, default=0.4, help="pause entre requêtes (s), par thread")
    ap.add_argument("--max-pages", type=int, default=60)
    ap.add_argument("--workers", type=int, default=6, help="profils lus en parallèle")
    ap.add_argument("--refresh", action="store_true", help="ignorer le cache des profils")
    a = ap.parse_args()

    local = threading.local()

    def make_session():
        s = cr.Session(impersonate="chrome") if IMPERSONATE else cr.Session()
        s.headers.update({"Accept-Language": "en-US,en;q=0.9"})
        if not IMPERSONATE:
            s.headers.update({"User-Agent": UA})
        return s

    def thread_sess():
        if not hasattr(local, "s"):
            local.s = make_session()
        return local.s

    sess = make_session()
    if not IMPERSONATE:
        print("(curl_cffi non installé : Letterboxd risque de bloquer)")

    viewers, films = read_viewers(a.viewers), read_films(a.films)
    print(f"{len(viewers)} viewers, {len(films)} films\n")

    # 1) recherche Letterboxd (plan A)
    for f in films:
        if not f["slug"]:
            f["slug"] = find_slug(sess, f["title"], a.delay)
            f["how"] = "recherche" if f["slug"] else None

    # 2) lecture complète de chaque profil (avec cache)
    cache = {}
    if os.path.exists(CACHE) and not a.refresh:
        cache = json.load(open(CACHE, encoding="utf-8"))
    profils = {}
    todo = []
    for v in viewers:
        key = v["user"].lower()
        if key in cache:
            profils[key] = cache[key]
            print(f"{v['user']}: cache ({len(cache[key])} films)")
        else:
            todo.append(v)

    lock = threading.Lock()

    def work(v):
        key = v["user"].lower()
        res = scan_user(thread_sess(), v["user"], a.delay, a.max_pages)
        with lock:
            profils[key] = cache[key] = res
            print(f"{v['user']}: {len(res)} films lus, {sum(1 for x in res.values() if x['r'])} notés")
            json.dump(cache, open(CACHE, "w", encoding="utf-8"))

    if todo:
        print(f"Lecture de {len(todo)} profil(s) en parallèle…")
        with ThreadPoolExecutor(max_workers=max(1, a.workers)) as ex:
            list(ex.map(work, todo))

    # 3) plan B : retrouver le film par son titre dans les profils des viewers
    by_name = {}
    for prof in profils.values():
        for slug, x in prof.items():
            by_name.setdefault(norm(x["n"]), Counter())[slug] += 1
    print("\nFilms :")
    for f in films:
        if not f["slug"]:
            c = by_name.get(norm(f["title"]))
            if c:
                f["slug"], f["how"] = c.most_common(1)[0][0], "titre dans les profils"
                if len(c) > 1:
                    f["how"] += f" (autres versions : {', '.join(s for s, _ in c.most_common()[1:])})"
        print(f"  {f['title']:<34} -> {f['slug'] or 'INTROUVABLE (ajoute le slug dans films.txt)'}"
              + (f"   [{f['how']}]" if f["slug"] else ""))

    # 4) moyennes
    out = {}
    print("\nRésultats :")
    for f in films:
        per = {}
        if f["slug"]:
            for v in viewers:
                x = profils.get(v["user"].lower(), {}).get(f["slug"])
                if x and x["r"]:
                    per[v["twitch"]] = x["r"]
        avg = round(sum(per.values()) / len(per), 2) if per else None
        out[f["title"]] = {"num": f["num"], "slug": f["slug"], "avg": avg,
                           "count": len(per), "ratings": per}
        print(f"  {f['title']:<34} " + (f"{avg:.2f}/5 ({len(per)} notes)" if avg else "aucune note"))

    # 5) critiques écrites : 3 max par film (les plus longues), avec cache
    rpath = ".cache_reviews.json"
    rcache = {}
    if os.path.exists(rpath) and not a.refresh:
        rcache = json.load(open(rpath, encoding="utf-8"))
    lb_of = {v["twitch"]: v["user"] for v in viewers}
    jobs = []
    for f in films:
        if f["slug"]:
            for tw in out[f["title"]]["ratings"]:
                k = f"{lb_of[tw].lower()}|{f['slug']}"
                if k not in rcache:
                    jobs.append((k, lb_of[tw], f["slug"]))
    if jobs:
        print(f"\nLecture de {len(jobs)} page(s) de critique…")

        def rwork(j):
            k, u, s = j
            try:
                t = fetch_review(thread_sess(), u, s, a.delay)
            except Blocked:
                return
            with lock:
                rcache[k] = t

        with ThreadPoolExecutor(max_workers=max(1, a.workers)) as ex:
            list(ex.map(rwork, jobs))
        json.dump(rcache, open(rpath, "w", encoding="utf-8"))
    for f in films:
        revs = []
        if f["slug"]:
            for tw in out[f["title"]]["ratings"]:
                t = rcache.get(f"{lb_of[tw].lower()}|{f['slug']}")
                if is_real_review(t):
                    revs.append({"user": tw, "text": t})
        revs.sort(key=lambda r: -len(r["text"]))
        out[f["title"]]["reviews"] = revs[:3]
        print(f"  {f['title']:<34} {len(revs[:3])} critique(s)")

    json.dump(out, open("notes.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    with open("notes.js", "w", encoding="utf-8") as fh:
        fh.write("window.CINE_NOTES=" + json.dumps(out, ensure_ascii=False) + ";\n")
    print("\nnotes.js et notes.json écrits. Garde notes.js à côté de cinedimanche-roue.html.")


if __name__ == "__main__":
    try:
        main()
    except Blocked:
        print("\nLetterboxd bloque les requêtes (403).")
        print("Essaie : attendre 15-30 min, ou une autre connexion (partage de connexion du téléphone).")
        sys.exit(1)
