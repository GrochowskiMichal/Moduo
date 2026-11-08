import sys, pathlib
F = pathlib.Path(__file__).resolve().parent / "fonts"
src, out = sys.argv[1], sys.argv[2]
h = pathlib.Path(src).read_text()
for ph, fn in [("__G400__","geist-400"),("__G500__","geist-500"),("__G600__","geist-600"),("__GM400__","geist-mono-400")]:
    h = h.replace(ph, "".join((F/f"{fn}.b64").read_text().split()))
pathlib.Path(out).write_text(h)
print(len(h)//1024, "KB")
