"""2:1 dimetric projection and rounded-prism geometry for SVG."""
from __future__ import annotations
import math
from dataclasses import dataclass
S2 = math.sqrt(2)
# ---------------------------------------------------------------- projection


def f(value: float) -> str:
    rounded = round(value, 2)
    return str(int(rounded)) if rounded == int(rounded) else f"{rounded:g}"


class Proj:
    """iso(x, y, z) = [x - y, (x + y) / 2 - z], shifted to the drawing origin."""

    def __init__(self, ox: float, oy: float):
        self.ox, self.oy = ox, oy

    def iso(self, x, y, z):
        return (self.ox + x - y, self.oy + (x + y) / 2 - z)


@dataclass
class Rect:
    """A rounded-rectangle footprint. r = 0 is a box; r = w/2 = d/2 is a cylinder."""

    x0: float
    y0: float
    x1: float
    y1: float
    r: float = 0

    def centers(self):
        r = self.r
        return [(self.x1 - r, self.y1 - r), (self.x0 + r, self.y1 - r),
                (self.x0 + r, self.y0 + r), (self.x1 - r, self.y0 + r)]

    def inset(self, m, r=None):
        return Rect(self.x0 + m, self.y0 + m, self.x1 - m, self.y1 - m,
                    max(0, self.r - m) if r is None else r)

    def attr(self):
        return " ".join(f(v) for v in (self.x0, self.y0, self.x1, self.y1, self.r))


def corner(theta):
    return int(math.floor(theta / 90)) % 4


def point(P, rect, theta, z, k=None):
    k = corner(theta) if k is None else k
    cx, cy = rect.centers()[k]
    t = math.radians(theta)
    return P.iso(cx + rect.r * math.cos(t), cy + rect.r * math.sin(t), z)


def walk(P, rect, a, b, z):
    """Path commands from outline angle a to b. Each corner is a quarter of one 2:1 ellipse."""
    cmds = []
    rx, ry = rect.r * S2, rect.r / S2
    rising = b > a
    th = a
    while (b - th) * (1 if rising else -1) > 1e-9:
        nxt = min(b, (math.floor(th / 90) + 1) * 90) if rising else max(b, (math.ceil(th / 90) - 1) * 90)
        k = corner((th + nxt) / 2)
        end = point(P, rect, nxt, z, k)
        if rect.r > 0:
            cmds.append(f"A {f(rx)} {f(ry)} 0 0 {1 if rising else 0} {f(end[0])} {f(end[1])}")
        else:
            cmds.append(f"L {f(end[0])} {f(end[1])}")
        th = nxt
        if (b - th) * (1 if rising else -1) > 1e-9:
            nx = point(P, rect, th, z, corner(th + (1 if rising else -1)))
            cmds.append(f"L {f(nx[0])} {f(nx[1])}")
    return " ".join(cmds)


def M(p):
    return f"M {f(p[0])} {f(p[1])}"


def L(p):
    return f"L {f(p[0])} {f(p[1])}"


def outline(P, rect, z):
    return f"{M(point(P, rect, 0, z, 0))} {walk(P, rect, 0, 360, z)} Z"


def prism(P, rect, z0, z1):
    """Top face, the two visible side bands, the silhouette, the top-front edge, and the label anchor."""
    lt, ft, rt = point(P, rect, 135, z1), point(P, rect, 45, z1), point(P, rect, -45, z1)
    lb, fb, rb = point(P, rect, 135, z0), point(P, rect, 45, z0), point(P, rect, -45, z0)
    edge = f"{M(lt)} {walk(P, rect, 135, -45, z1)}"
    if rect.r == 0:
        edge += f" {M(ft)} {L(fb)}"
    n = 24
    poly = [point(P, rect, 135 + 180 * i / n, z1) for i in range(n + 1)]
    poly += [point(P, rect, -45 + 180 * i / n, z0) for i in range(n + 1)]
    return dict(
        top=outline(P, rect, z1),
        left=f"{M(lt)} {walk(P, rect, 135, 45, z1)} {L(fb)} {walk(P, rect, 45, 135, z0)} Z",
        right=f"{M(ft)} {walk(P, rect, 45, -45, z1)} {L(rb)} {walk(P, rect, -45, 45, z0)} Z",
        sil=f"{M(lt)} {walk(P, rect, 135, 315, z1)} {L(rb)} {walk(P, rect, -45, 135, z0)} Z",
        edge=edge,
        rx=rt[0],
        anchor=(rt[0], (rt[1] + rb[1]) / 2),
        poly=poly,
    )


def solid(P, rect, z0, z1, sk, tones, stroke, inner, role=True):
    pr = prism(P, rect, z0, z1)
    tag = ' data-role="silhouette"' if role else ""
    out = [f'<path{tag} d="{pr["sil"]}" fill="{sk["base"]}"/>']
    for path, tone in zip((pr["top"], pr["left"], pr["right"]), tones):
        if tone:
            out.append(f'<path d="{path}" fill="{tone}"/>')
    return pr, out


def finish(pr, stroke, inner, sw=1.2):
    return [f'<path d="{pr["edge"]}" fill="none" stroke="{inner}" stroke-width="0.8"/>',
            f'<path d="{pr["sil"]}" fill="none" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/>']


def styles(sk, focal):
    return (sk["focal"] if focal else sk["shade"], sk["accent"] if focal else sk["sil"],
            sk["inner_acc"] if focal else sk["inner"])


# ---------------------------------------------------------------- pages
