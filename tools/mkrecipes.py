# -*- coding: utf-8 -*-

# name -> (metaColor, internal id, kind)
EL = {
 "Sand":(16032864,"sand","e"), "Wet Sand":(13468991,"wetSand","e"),
 "Residue":(13421772,"residue","e"), "Burnt Residue":(8421504,"burntResidue","e"),
 "Gold":(16766720,"gold","e"), "Water":(2003199,"water","e"),
 "Steam":(16250871,"steam","e"), "Seed":(8388352,"seed","e"),
 "Wet Seed":(6736998,"wetSeed","e"), "Seedling":(1793568,"seedling","e"),
 "Amethelis":(13393115,"petalium","e"), "Dry Amethelis":(16757721,"dryPetalium","e"),
 "Lava":(16724736,"lava","e"), "Redsand":(10502208,"sandium","e"),
 "Voidbloom":(7995560,"gloom","e"), "Cinder":(9109504,"basalt","e"),
 "Fire":(16729344,"fire","e"), "Flame":(16753920,"flame","e"),
 "Snow":(14745599,"freezingIce","e"), "Florin":(13213951,"florin","e"),
 "Florinol":(10178528,"florinol","e"), "Liquid Gold":(16766720,"liquidGold","e"),
 "Liquid Copper":(12088115,"liquidCopper","e"), "Copper":(12088115,"copper","e"),
 "Aurixite":(9143008,"aurixite","e"), "Void Petal":(52945,"voidPetal","e"),
 "Dirt":(9593894,"dirt","t"), "Grass":(2263842,"grass","t"),
 "Sporemound":(5597999,"sporemound","t"), "Frostbed":(11393254,"frostbed","t"),
 "Redsoil":(9109504,"redsoil","t"), "Scoria":(2829099,"scoria","t"),
 "Gold Soil":(14329120,"GoldSoil","t*"), "Petal Soil":(16738740,"Petal","t*"),
}

SECTIONS = [
 ("Contact Reactions", "grower",
  "Two elements touching in the world convert on the spot. No machine required.",
  [ (["Water","Sand"], [("Wet Sand",None)], ""),
    (["Water","Seed"], [("Wet Seed",None)], ""),
    (["Water","Lava"], [("Steam",None)], "lava persists"),
    (["Water","Flame"], [("Steam",None)], ""),
    (["Void Petal","Redsand"], [("Voidbloom",None)], ""),
  ]),
 ("Shaker", None,
  "Wet sand rides on top. Residue is left in place; gold falls through and out the underside.",
  [ (["Wet Sand"], [("Residue",1.0),("Gold",0.25)], "gold drops 2 cells below"),
  ]),
 ("Kinetic Press", None,
  "Internally the velocity soaker. Input must be falling fast enough on impact.",
  [ (["Burnt Residue"], [("Seed",1.0),("Gold",1.0)], "needs downward velocity"),
  ]),
 ("Planter Box", None,
  "Wet seed germinates, the seedling runs, and where it blooms the terrain turns.",
  [ (["Wet Seed"], [("Seedling",None)], "germinates in the box"),
    (["Seedling"], [("Petal Soil",None),("Gold Soil",None)], "on bloom, as terrain"),
  ]),
 ("Smelter", None,
  "Feed from above. Needs heat from an adjacent Thermal Buffer or lava.",
  [ (["Gold"], [("Liquid Gold",0.5)], "NEUTRAL"),
    (["Copper"], [("Liquid Copper",1.0)], ""),
  ]),
 ("Condenser", None,
  "Condenses gases to liquid. Needs cold from a Thermal Buffer or snow above.",
  [ (["Florin"], [("Gold",0.5),("Florinol",0.5)], "one or the other"),
    (["Steam"], [("Water",1.0)], ""),
  ]),
 ("Steam Dryer", None,
  "Put Amethelis on top; steam underneath is the fuel.",
  [ (["Amethelis"], [("Dry Amethelis",1.0)], ""),
  ]),
 ("Snowmaker", None,
  "Consumes water above and energy from the grid; snow spawns below.",
  [ (["Water"], [("Snow",1.0)], "costs energy, output below"),
  ]),
 ("Synthesizer", None,
  "Built as the aurixiteCrystallizer. Fills a 4x4 pocket: sixteen units in, one crystal out.",
  [ (["Florinol"], [("Aurixite",1.0)], "16 units + 800 energy"),
  ]),
 ("Burning", None,
  "Set alight by flame, fire, a flamethrower, or a Burner Belt fuelled by a Thermal Buffer.",
  [ (["Residue"], [("Burnt Residue",0.25)], "75% is lost - intended"),
    (["Dry Amethelis"], [("Florin",0.5)], "florin rises as gas"),
  ]),
 ("Digging Terrain", None,
  "What the ground gives up when excavated.",
  [ (["Dirt"], [("Sand",0.5)], ""),
    (["Grass"], [("Sand",0.5)], ""),
    (["Gold Soil"], [("Gold",1.0)], ""),
    (["Petal Soil"], [("Amethelis",1.0)], ""),
    (["Sporemound"], [("Seed",0.5)], ""),
    (["Frostbed"], [("Snow",0.5)], "dig out before melting"),
    (["Redsoil"], [("Redsand",0.5)], ""),
    (["Scoria"], [("Cinder",1.0)], ""),
  ]),
]

STRUCT_IDS = [
 ("Shaker","shaker"), ("Kinetic Press","velocitySoaker"), ("Planter Box","grower"),
 ("Smelter","smelter"), ("Condenser","thermofroster"), ("Steam Dryer","thermodryer"),
 ("Snowmaker","snowmaker"), ("Synthesizer","aurixiteCrystallizer"),
 ("Thermal Buffer","thermalRelay"), ("Florinol Battery","goldBattery"),
]

def rgb(v):
    return "%.3f %.3f %.3f" % ((v>>16&255)/255.0, (v>>8&255)/255.0, (v&255)/255.0)

def esc(s):
    return s.replace("\\","\\\\").replace("(","\\(").replace(")","\\)")

W, H = 595.0, 842.0
ML, MR, TOP, BOT = 56.0, 56.0, 62.0, 58.0
BG   = "0.129 0.118 0.102"
INK  = "0.898 0.871 0.816"
DIM  = "0.541 0.514 0.455"
ACC  = "0.933 0.796 0.400"
WARN = "0.902 0.451 0.353"
GOOD = "0.541 0.788 0.510"
RULE = "0.259 0.239 0.208"

out = []
def e(s): out.append(s)
page = [0]; y = [0.0]

def footer():
    e("%s setrgbcolor /Helvetica findfont 8 scalefont setfont" % DIM)
    e("%g 36 moveto (Sandustry Recipe Reference) show" % ML)
    lbl = esc(str(page[0]))
    e("/Helvetica findfont 8 scalefont setfont (%s) stringwidth pop %g exch sub 36 moveto (%s) show" % (lbl, W-MR, lbl))
    e("showpage")

def newpage():
    if page[0] > 0: footer()
    page[0] += 1
    e("%s setrgbcolor 0 0 %g %g rectfill" % (BG, W, H))
    y[0] = H - TOP

def need(h):
    if y[0] - h < BOT: newpage()

def txt(colour, font, size, s):
    e("%s setrgbcolor /%s findfont %g scalefont setfont (%s) show" % (colour, font, size, esc(s)))

def gap(n): e("%g 0 rmoveto" % n)

def token(name):
    e("%s SWCH" % rgb(EL.get(name,(8421504,"",""))[0]))
    txt(INK, "Helvetica", 10.5, name)

def pct(p):
    if p is None or abs(p-1.0) < 1e-9: return None
    return "%g%%" % (p*100)

newpage()
e("%s setrgbcolor /Helvetica-Bold findfont 30 scalefont setfont" % ACC)
e("%g %g moveto (SANDUSTRY) show" % (ML, y[0]-22))
e("%s setrgbcolor /Helvetica findfont 12.5 scalefont setfont" % INK)
e("%g %g moveto (Recipe Reference) show" % (ML, y[0]-40))
e("%s setrgbcolor 1 setlinewidth %g %g moveto %g %g lineto stroke" % (ACC, ML, y[0]-52, W-MR, y[0]-52))
e("%s setrgbcolor /Helvetica-Oblique findfont 8.5 scalefont setfont" % DIM)
e("%g %g moveto (Names as shown in game. A static snapshot - mods may add or replace recipes at runtime.) show" % (ML, y[0]-66))
e("%s setrgbcolor /Helvetica-Oblique findfont 8.5 scalefont setfont" % WARN)
e("%g %g moveto (A chance below 100%% is a yield, not a batch success rate: the input is consumed either way. Check the value table.) show" % (ML, y[0]-78))
y[0] -= 104

for title, _sid, blurb, rows in SECTIONS:
    need(30 + 20*len(rows))
    e("%s setrgbcolor /Helvetica-Bold findfont 14 scalefont setfont" % ACC)
    e("%g %g moveto (%s) show" % (ML, y[0], esc(title)))
    y[0] -= 12.5
    e("%s setrgbcolor /Helvetica findfont 8.5 scalefont setfont" % DIM)
    e("%g %g moveto (%s) show" % (ML, y[0], esc(blurb)))
    y[0] -= 7
    e("%s setrgbcolor 0.7 setlinewidth %g %g moveto %g %g lineto stroke" % (RULE, ML, y[0], W-MR, y[0]))
    y[0] -= 17
    for idx, (inputs, outputs, note) in enumerate(rows):
        need(20)
        if idx % 2 == 1:
            e("0.161 0.149 0.129 setrgbcolor %g %g %g %g rectfill" % (ML-6, y[0]-4.5, W-ML-MR+12, 17))
        e("%g %g moveto" % (ML, y[0]))
        for i, nm in enumerate(inputs):
            if i: gap(5); txt(DIM,"Helvetica",10.5,"+"); gap(5)
            token(nm)
        gap(9)
        e("%s setrgbcolor /Symbol findfont 11 scalefont setfont (\\256) show" % ACC)
        gap(9)
        for i, (nm, p) in enumerate(outputs):
            if i:
                gap(4)
                txt(DIM,"Helvetica",10.5,"or" if title=="Condenser" else "+")
                gap(4)
            token(nm)
            s = pct(p)
            if s: gap(4); txt(ACC,"Helvetica-Bold",8.5,s)
        if note == "NEUTRAL":
            gap(10); txt(GOOD,"Helvetica-Bold",8,"value-neutral: 0.5 x 2 = 1")
        elif note:
            gap(10); txt(DIM,"Helvetica-Oblique",8.5,note)
        y[0] -= 19
    y[0] -= 14

# ---- heat and energy ----
need(150)
e("%s setrgbcolor /Helvetica-Bold findfont 14 scalefont setfont" % ACC)
e("%g %g moveto (Heat and Energy) show" % (ML, y[0])); y[0] -= 12.5
e("%s setrgbcolor /Helvetica findfont 8.5 scalefont setfont" % DIM)
e("%g %g moveto (What each machine costs to run, and why the Thermal Buffer beats raw lava.) show" % (ML, y[0]))
y[0] -= 7
e("%s setrgbcolor 0.7 setlinewidth %g %g moveto %g %g lineto stroke" % (RULE, ML, y[0], W-MR, y[0]))
y[0] -= 16
COSTS = [
  ("Smelter", "heat", "Thermal Buffer on any side (-10 temp per smelt), or lava in the row directly below"),
  ("Condenser", "cold", "Thermal Buffer (-2 temp per run), or snow above"),
  ("Steam Dryer", "steam", "steam in the cells below, consumed as fuel"),
  ("Snowmaker", "energy", "1 energy per tick, 100 ms interval"),
  ("Synthesizer", "energy", "800 energy per conversion, all-or-nothing; queues and retries if short"),
  ("Burner Belt", "heat", "Thermal Buffer adjacent; ignites flammables above. Without heat, a plain belt"),
  ("Pyro Dispenser", "heat", "one flame burst per interval, drawn from an adjacent Thermal Buffer"),
]
for nm, kind, desc in COSTS:
    need(15)
    e("%s setrgbcolor /Helvetica-Bold findfont 9 scalefont setfont" % INK)
    e("%g %g moveto (%s) show" % (ML, y[0], esc(nm)))
    e("%s setrgbcolor /Helvetica-Bold findfont 8 scalefont setfont" % ACC)
    e("%g %g moveto (%s) show" % (ML+96, y[0], esc(kind)))
    e("%s setrgbcolor /Helvetica findfont 8.5 scalefont setfont" % DIM)
    e("%g %g moveto (%s) show" % (ML+130, y[0], esc(desc)))
    y[0] -= 13
y[0] -= 6
e("%s setrgbcolor /Helvetica-Bold findfont 9 scalefont setfont" % INK)
e("%g %g moveto (Lava efficiency: the buffer wins 2.5 to 1) show" % (ML, y[0])); y[0] -= 12
e("%s setrgbcolor /Helvetica findfont 8.5 scalefont setfont" % DIM)
for line in [
  "A Thermal Buffer absorbs one adjacent lava cell for +250 temperature, capped at 1000, and the lava is consumed.",
  "Each smelt drains 10, so one lava cell buys 25 smelts. Buffers also diffuse heat between themselves every second",
  "at rate 0.5, so one lava pit can feed a whole network. Lava placed directly under a smelter is consumed on 10% of",
  "smelts instead, which is only 10 smelts per cell. It only absorbs when there is headroom, so nothing is wasted.",
]:
    e("%g %g moveto (%s) show" % (ML, y[0], esc(line))); y[0] -= 11
y[0] -= 16

# ---- collectable values ----
need(90)
e("%s setrgbcolor /Helvetica-Bold findfont 14 scalefont setfont" % ACC)
e("%g %g moveto (Collectable Values) show" % (ML, y[0])); y[0] -= 12.5
e("%s setrgbcolor /Helvetica findfont 8.5 scalefont setfont" % DIM)
e("%g %g moveto (What a Collector pays. These are the only two valued elements in the build.) show" % (ML, y[0]))
y[0] -= 7
e("%s setrgbcolor 0.7 setlinewidth %g %g moveto %g %g lineto stroke" % (RULE, ML, y[0], W-MR, y[0]))
y[0] -= 17
for nm, val in (("Gold", 1), ("Liquid Gold", 2)):
    e("%g %g moveto" % (ML, y[0]))
    token(nm)
    gap(8); txt(ACC,"Helvetica-Bold",10.5,str(val))
    y[0] -= 19
y[0] -= 2
e("%s setrgbcolor /Helvetica-Oblique findfont 8.5 scalefont setfont" % DIM)
e("%g %g moveto (Smelting gold is value-neutral in expectation. The gain is density - one cell carries 2 instead of 1,) show" % (ML, y[0]))
e("%g %g moveto (halving entity count for the same money, and liquid gold moves through pipes. The cost is heat and variance.) show" % (ML, y[0]-11))
y[0] -= 34

# ---- appendix ----
need(200)
e("%s setrgbcolor /Helvetica-Bold findfont 14 scalefont setfont" % ACC)
e("%g %g moveto (Display Name to Internal ID) show" % (ML, y[0])); y[0] -= 12.5
e("%s setrgbcolor /Helvetica findfont 8.5 scalefont setfont" % DIM)
e("%g %g moveto (What you need when calling elements.getElementTypeFromId or structures.recipes.register.) show" % (ML, y[0]))
y[0] -= 7
e("%s setrgbcolor 0.7 setlinewidth %g %g moveto %g %g lineto stroke" % (RULE, ML, y[0], W-MR, y[0]))
y[0] -= 16

COL = (W-ML-MR)/2.0
items = [(k,v[1],v[2]) for k,v in EL.items() if v[2].startswith("e")]
items.sort()
titems = [(k,v[1],v[2]) for k,v in EL.items() if v[2].startswith("t")]
titems.sort()

def table(heading, rows_):
    global COL
    need(40)
    e("%s setrgbcolor /Helvetica-Bold findfont 9.5 scalefont setfont" % INK)
    e("%g %g moveto (%s) show" % (ML, y[0], esc(heading)))
    y[0] -= 13
    half = (len(rows_)+1)//2
    left, right = rows_[:half], rows_[half:]
    start = y[0]
    for col, data in ((0,left),(1,right)):
        yy = start
        for nm, iid, kind in data:
            x = ML + col*COL
            e("%s setrgbcolor /Helvetica findfont 9 scalefont setfont" % INK)
            e("%g %g moveto (%s) show" % (x, yy, esc(nm)))
            lab = iid + ("  *" if kind.endswith("*") else "")
            e("%s setrgbcolor /Courier findfont 8.5 scalefont setfont" % DIM)
            e("%g %g moveto (%s) show" % (x+COL*0.52, yy, esc(lab)))
            yy -= 12
    y[0] = start - 12*half - 10

table("Elements", items)
table("Terrains", titems)
e("%s setrgbcolor /Helvetica-Oblique findfont 8 scalefont setfont" % DIM)
e("%g %g moveto (*  No nameKey in the build - these terrains are unnamed in game; the label above is the internal constant.) show" % (ML, y[0]))
e("%s setrgbcolor /Helvetica-Oblique findfont 8 scalefont setfont" % DIM)
e("%g %g moveto (Structures: Shaker=shaker  Kinetic Press=velocitySoaker  Planter Box=grower  Condenser=thermofroster) show" % (ML, y[0]-12))
e("%g %g moveto (Steam Dryer=thermodryer  Synthesizer=aurixiteCrystallizer  Thermal Buffer=thermalRelay  Florinol Battery=goldBattery) show" % (ML, y[0]-24))

footer()

PROLOG = """%!PS-Adobe-3.0
%%%%BoundingBox: 0 0 595 842
%%%%Pages: {pages}
%%%%EndComments
/SWCH {{ gsave setrgbcolor currentpoint 1 sub 8.5 8.5 rectfill grestore
  gsave 0.42 0.40 0.35 setrgbcolor 0.5 setlinewidth
  currentpoint 1 sub 8.5 8.5 rectstroke grestore 13 0 rmoveto }} bind def
"""
ps = PROLOG.format(pages=page[0]) + "\n".join(out) + "\n%%EOF\n"
open("/tmp/claude-1000/-home-matt-Git-Sandustry-MODS/181a5d72-99bd-46bd-a0be-36f155756a2d/scratchpad/recipes.ps","w").write(ps)
print("pages", page[0])
