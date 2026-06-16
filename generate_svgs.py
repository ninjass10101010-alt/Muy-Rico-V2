import math

def save_svg(name, content):
    with open(f"/Users/garciafam/Documents/website/Muy-Rico-V2/{name}.svg", "w") as f:
        f.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" fill="none" stroke="#2c3a2f" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">\n{content}\n</svg>')

# 1. Monstera
monstera = """
<path d="M100,180 C100,140 100,100 100,40" stroke-width="4"/>
<path d="M100,180 C40,180 10,120 10,70 C10,20 60,10 100,40 C140,10 190,20 190,70 C190,120 160,180 100,180 Z" fill="#eef2eb" stroke-width="3"/>
<path d="M100,40 C100,40 100,180 100,180" />
<path d="M100,70 C70,60 40,55 20,50" />
<path d="M100,100 C60,95 30,95 15,90" />
<path d="M100,130 C60,130 30,135 20,140" />
<path d="M100,155 C70,160 40,165 30,170" />
<path d="M100,70 C130,60 160,55 180,50" />
<path d="M100,100 C140,95 170,95 185,90" />
<path d="M100,130 C140,130 170,135 180,140" />
<path d="M100,155 C130,160 160,165 170,170" />
<!-- Cutouts -->
<path d="M20,50 C30,65 50,70 70,70" />
<path d="M15,90 C30,105 50,110 70,110" />
<path d="M20,140 C40,145 60,145 70,140" />
<path d="M180,50 C170,65 150,70 130,70" />
<path d="M185,90 C170,105 150,110 130,110" />
<path d="M180,140 C160,145 140,145 130,140" />
"""

# 2. Hibiscus
hibiscus = """
<path d="M100,100 C80,20 40,20 20,60 C40,70 70,80 100,100" fill="#eef2eb"/>
<path d="M100,100 C120,20 160,20 180,60 C160,70 130,80 100,100" fill="#eef2eb"/>
<path d="M100,100 C180,90 190,140 150,180 C130,150 110,130 100,100" fill="#eef2eb"/>
<path d="M100,100 C20,90 10,140 50,180 C70,150 90,130 100,100" fill="#eef2eb"/>
<path d="M100,100 C80,180 120,180 100,100" fill="#eef2eb"/>
<path d="M100,100 C80,100 60,60 50,40" stroke-width="3"/>
<circle cx="50" cy="40" r="4" fill="#2c3a2f"/>
<circle cx="42" cy="45" r="3" fill="#2c3a2f"/>
<circle cx="58" cy="35" r="3" fill="#2c3a2f"/>
<path d="M30,60 C50,55 70,70 100,100" />
<path d="M170,60 C150,55 130,70 100,100" />
<path d="M60,165 C75,140 85,120 100,100" />
<path d="M140,165 C125,140 115,120 100,100" />
"""

# 3. Fern
fern = """
<path d="M100,190 C100,100 100,40 100,10" stroke-width="4"/>
"""
for i in range(1, 15):
    y = 180 - i * 11
    w = 60 - abs(8 - i) * 5
    fern += f'<path d="M100,{y} Q{100 - w*0.5},{y-w*0.3} {100 - w},{y-w*0.8}" />\n'
    fern += f'<path d="M100,{y} Q{100 + w*0.5},{y-w*0.3} {100 + w},{y-w*0.8}" />\n'

# 4. Fern Tree
ferntree = """
<path d="M90,190 Q95,140 100,90 Q105,140 110,190 Z" fill="#eef2eb" stroke-width="3"/>
<path d="M85,190 L115,190" />
<path d="M90,170 L110,170" />
<path d="M93,150 L107,150" />
<path d="M95,130 L105,130" />
<path d="M97,110 L103,110" />
"""
for angle in [-60, -30, 0, 30, 60]:
    rad = math.radians(angle - 90)
    length = 70 if abs(angle) < 40 else 50
    ex = 100 + math.cos(rad) * length
    ey = 90 + math.sin(rad) * length
    ferntree += f'<path d="M100,90 Q{100 + math.cos(rad)*length*0.5},{90 + math.sin(rad)*length*0.5 - 20} {ex},{ey}" stroke-width="3"/>\n'
    for j in range(1, 6):
        fx = 100 + math.cos(rad) * (length * j / 6)
        fy = 90 + math.sin(rad) * (length * j / 6)
        ferntree += f'<path d="M{fx},{fy} L{fx - math.sin(rad)*10},{fy + math.cos(rad)*10}" />\n'
        ferntree += f'<path d="M{fx},{fy} L{fx + math.sin(rad)*10},{fy - math.cos(rad)*10}" />\n'

save_svg("decor_monstera", monstera)
save_svg("decor_hibiscus", hibiscus)
save_svg("decor_fern", fern)
save_svg("decor_ferntree", ferntree)
