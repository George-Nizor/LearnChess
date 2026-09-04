#!/usr/bin/env python3
"""Render the LearnChess brand mark: a rook, modelled and lit rather than drawn.

Why a renderer and not an illustration. The Instrumenta suite's marks are sculptural — the family
resemblance comes from depth, material, and a transparent canvas, not from a shared silhouette
style. A flat rook would sit badly beside them. This builds the piece as real geometry, lights it,
and rasterises it, so the highlights and the occlusion are where the shape actually puts them.

The rook is a surface of revolution apart from its crown, which makes it tractable: the body is a
profile curve spun about the vertical axis, and the four merlons are built as their own solids. No
modelling package is involved, and nothing here is generated or traced from someone else's work.

Usage:
    python3 scripts/render-brand-mark.py [--out DIR] [--size N] [--supersample N]
    python3 scripts/render-brand-mark.py --banner docs/images/learnchess-banner.png

Writes learnchess-mark-<size>.png for the standard sizes plus learnchess-app-art.png at 1024.
Every output is RGBA with a transparent canvas. `--banner` additionally composes the 1600x500
README banner around the same unaltered mark.
"""

from __future__ import annotations

import argparse
import math
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# Palette
#
# One hue with tints and shades, which is the discipline the rest of the suite uses. Emerald is
# the free slot in the family — Imago's teal leans cyan, and the green board is chess's own
# convention, so the mark inherits a colour the subject already owns.
# ---------------------------------------------------------------------------

Vec3 = tuple[float, float, float]


def from_hex(value: int) -> Vec3:
    """sRGB hex to linear light.

    Lighting has to happen in linear space or it is arithmetic on numbers that were never
    proportional to light in the first place. Skipping this step and gamma-encoding at the end
    brightens every midtone twice, which reads as a flat, washed-out surface.
    """
    channels = ((value >> 16) & 0xFF, (value >> 8) & 0xFF, value & 0xFF)
    return tuple(
        (channel / 255.0 / 12.92)
        if channel / 255.0 <= 0.04045
        else (((channel / 255.0) + 0.055) / 1.055) ** 2.4
        for channel in channels
    )


ACCENT = from_hex(0x2FA85F)
HIGHLIGHT = from_hex(0xC6F3D9)
DEEP = from_hex(0x0B331E)
RIM = from_hex(0x7BD9A0)


def sub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def cross(a: Vec3, b: Vec3) -> Vec3:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def scale(a: Vec3, k: float) -> Vec3:
    return (a[0] * k, a[1] * k, a[2] * k)


def add(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def normalise(a: Vec3) -> Vec3:
    length = math.sqrt(dot(a, a))
    return (0.0, 0.0, 0.0) if length == 0 else scale(a, 1.0 / length)


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------


@dataclass
class Mesh:
    vertices: list[Vec3]
    normals: list[Vec3]
    faces: list[tuple[int, int, int]]

    def add_face(self, a: int, b: int, c: int) -> None:
        self.faces.append((a, b, c))


def rook_profile() -> list[tuple[float, float]]:
    """(radius, height) from the foot upward.

    Read it as a silhouette. A turned chess rook is roughly twice as tall as its foot is wide, with
    a stepped base, a collar bead, a shallow concave shaft, and a flare into the battlement. The
    proportion is what makes it read as a rook at 32 pixels; the detail only matters at 1024.
    """
    points: list[tuple[float, float]] = [
        # Stepped foot.
        (0.000, 0.000),
        (0.400, 0.000),
        (0.420, 0.016),
        (0.422, 0.062),
        (0.400, 0.082),
        (0.352, 0.104),
        # Collar bead.
        (0.330, 0.132),
        (0.344, 0.160),
        (0.326, 0.186),
        (0.300, 0.208),
    ]
    # The shaft: a shallow concave sweep, not an hourglass. It narrows by about a fifth and comes
    # back, which is the amount a lathe-turned piece actually loses at the waist.
    shaft_bottom, shaft_top = 0.208, 0.860
    start_radius, end_radius, narrowest = 0.300, 0.306, 0.244
    steps = 30
    for step in range(1, steps + 1):
        t = step / steps
        height = shaft_bottom + (shaft_top - shaft_bottom) * t
        eased = math.sin(math.pi * t) ** 0.85
        radius = start_radius + (end_radius - start_radius) * t - (start_radius - narrowest) * eased
        points.append((radius, height))
    points.extend(
        [
            # Flare into the battlement.
            (0.330, 0.888),
            (0.376, 0.918),
            (0.410, 0.948),
            (0.424, 0.976),
            (0.428, 1.000),
        ]
    )
    return points


CROWN_BASE = 1.000
CROWN_TOP = 1.208
CROWN_OUTER = 0.428
CROWN_INNER = 0.276
MERLON_COUNT = 4
# A merlon is wider than the gap beside it, which is what makes the notches read as cuts rather
# than as four posts. Twenty-four segments plus twelve, four times, fills the revolution.
MERLON_SEGMENTS = 40
EMBRASURE_SEGMENTS = 20
SEGMENTS = MERLON_COUNT * (MERLON_SEGMENTS + EMBRASURE_SEGMENTS)
# Rotates the battlement so a merlon faces the camera rather than a gap. A gap dead centre reads
# as a two-pronged fork; a merlon centred, flanked by two cuts, reads as a battlement.
CROWN_PHASE = 30


def build_rook() -> Mesh:
    mesh = Mesh(vertices=[], normals=[], faces=[])
    profile = rook_profile()
    rings: list[list[int]] = []

    for radius, height in profile:
        ring: list[int] = []
        if radius == 0.0:
            index = len(mesh.vertices)
            mesh.vertices.append((0.0, height, 0.0))
            mesh.normals.append((0.0, -1.0, 0.0))
            ring = [index] * SEGMENTS
        else:
            for segment in range(SEGMENTS):
                angle = 2.0 * math.pi * segment / SEGMENTS
                ring.append(len(mesh.vertices))
                mesh.vertices.append((radius * math.cos(angle), height, radius * math.sin(angle)))
                mesh.normals.append((0.0, 0.0, 0.0))
        rings.append(ring)

    for lower, upper in zip(rings, rings[1:], strict=False):
        for segment in range(SEGMENTS):
            nxt = (segment + 1) % SEGMENTS
            a, b, c, d = lower[segment], lower[nxt], upper[nxt], upper[segment]
            # Wound so the face normal points away from the axis of revolution. Get this backwards
            # and the silhouette still looks right while every surface is lit from the wrong side.
            if a != b:
                mesh.add_face(a, c, b)
            if c != d:
                mesh.add_face(a, d, c)

    add_crown(mesh)
    smooth_normals(mesh)
    return mesh


def ring_vertices(mesh: Mesh, radius: float, height: float, start: int, count: int) -> list[int]:
    indices: list[int] = []
    for step in range(count):
        angle = 2.0 * math.pi * (start + step) / SEGMENTS
        indices.append(len(mesh.vertices))
        mesh.vertices.append((radius * math.cos(angle), height, radius * math.sin(angle)))
        mesh.normals.append((0.0, 0.0, 0.0))
    return indices


def quad(mesh: Mesh, a: int, b: int, c: int, d: int) -> None:
    """A quad whose corners are copied, so the two triangles keep a hard edge.

    The body wants smooth normals — it is a lathe, and the facets are an artefact of sampling. The
    battlement wants the opposite: its corners are real, and averaging across them turns crisp
    stonework into a soft blob. Copying the corners means nothing is shared to average with.
    """
    corners = []
    for index in (a, b, c, d):
        corners.append(len(mesh.vertices))
        mesh.vertices.append(mesh.vertices[index])
        mesh.normals.append((0.0, 0.0, 0.0))
    mesh.add_face(corners[0], corners[2], corners[1])
    mesh.add_face(corners[0], corners[3], corners[2])


def add_crown(mesh: Mesh) -> None:
    """The battlement: four raised merlons with four cut embrasures between them.

    Each merlon is its own solid — outer wall, inner wall, two ends, and a top — because a lathe
    cannot make a shape whose height depends on the angle. The embrasure floors sit at the crown
    base so the cut reads as a notch rather than a gap.
    """
    cycle = MERLON_SEGMENTS + EMBRASURE_SEGMENTS
    for merlon in range(MERLON_COUNT):
        start = merlon * cycle + CROWN_PHASE
        count = MERLON_SEGMENTS + 1  # Share the boundary column with the neighbouring embrasure.
        outer_low = ring_vertices(mesh, CROWN_OUTER, CROWN_BASE, start, count)
        outer_high = ring_vertices(mesh, CROWN_OUTER, CROWN_TOP, start, count)
        inner_low = ring_vertices(mesh, CROWN_INNER, CROWN_BASE, start, count)
        inner_high = ring_vertices(mesh, CROWN_INNER, CROWN_TOP, start, count)

        for step in range(count - 1):
            quad(mesh, outer_low[step], outer_low[step + 1], outer_high[step + 1], outer_high[step])
            quad(mesh, inner_high[step], inner_high[step + 1], inner_low[step + 1], inner_low[step])
            quad(mesh, outer_high[step], outer_high[step + 1], inner_high[step + 1], inner_high[step])

        # The two ends of the merlon, facing into the embrasures either side.
        quad(mesh, outer_low[0], outer_high[0], inner_high[0], inner_low[0])
        last = count - 1
        quad(mesh, inner_low[last], inner_high[last], outer_high[last], outer_low[last])

    # The embrasure floors, and the inner wall below them, close the cup between the merlons.
    for embrasure in range(MERLON_COUNT):
        start = embrasure * cycle + MERLON_SEGMENTS + CROWN_PHASE
        count = EMBRASURE_SEGMENTS + 1
        outer = ring_vertices(mesh, CROWN_OUTER, CROWN_BASE, start, count)
        inner = ring_vertices(mesh, CROWN_INNER, CROWN_BASE, start, count)
        for step in range(count - 1):
            quad(mesh, outer[step], outer[step + 1], inner[step + 1], inner[step])

    # The floor of the cup, so the piece is closed when seen from above.
    floor = ring_vertices(mesh, CROWN_INNER, CROWN_BASE - 0.012, 0, SEGMENTS)
    centre = len(mesh.vertices)
    mesh.vertices.append((0.0, CROWN_BASE - 0.012, 0.0))
    mesh.normals.append((0.0, 0.0, 0.0))
    for step in range(SEGMENTS):
        mesh.add_face(centre, floor[step], floor[(step + 1) % SEGMENTS])

    # The inner wall of the cup, from the floor up to the merlon tops.
    wall_low = ring_vertices(mesh, CROWN_INNER, CROWN_BASE - 0.012, 0, SEGMENTS)
    wall_high = ring_vertices(mesh, CROWN_INNER, CROWN_BASE, 0, SEGMENTS)
    for step in range(SEGMENTS):
        nxt = (step + 1) % SEGMENTS
        quad(mesh, wall_high[step], wall_high[nxt], wall_low[nxt], wall_low[step])


def smooth_normals(mesh: Mesh) -> None:
    """Area-weighted vertex normals.

    Averaging over shared vertices rounds the lathe and leaves the crown's corners sharp, because
    the crown's walls were built from their own vertices and share none with their neighbours.
    """
    accumulated: list[Vec3] = [(0.0, 0.0, 0.0)] * len(mesh.vertices)
    for a, b, c in mesh.faces:
        va, vb, vc = mesh.vertices[a], mesh.vertices[b], mesh.vertices[c]
        face = cross(sub(vb, va), sub(vc, va))
        for index in (a, b, c):
            accumulated[index] = add(accumulated[index], face)
    mesh.normals = [normalise(normal) or (0.0, 1.0, 0.0) for normal in accumulated]


# ---------------------------------------------------------------------------
# Camera and shading
# ---------------------------------------------------------------------------

# Nearly level with the piece, lifted just enough to show the cup between the merlons. Higher than
# this and the foot becomes a large ellipse that dominates the mark.
EYE: Vec3 = (1.02, 0.94, 3.05)
TARGET: Vec3 = (0.0, 0.62, 0.0)
UP: Vec3 = (0.0, 1.0, 0.0)
FOV_DEGREES = 27.5

# The key is lateral, not frontal. A light near the camera puts its highlight down the middle of a
# turned piece and tells you nothing about the form; from the side it wraps the shaft and the waist
# and the flare all read differently.
KEY_LIGHT: Vec3 = (-0.35, 0.56, 0.75)
FILL_LIGHT: Vec3 = (0.80, 0.10, 0.40)
RIM_LIGHT: Vec3 = (-0.34, 0.44, -0.83)


def view_basis() -> tuple[Vec3, Vec3, Vec3]:
    forward = normalise(sub(TARGET, EYE))
    right = normalise(cross(forward, UP))
    up = cross(right, forward)
    return right, up, forward


def mix(a: Vec3, b: Vec3, t: float) -> Vec3:
    t = max(0.0, min(1.0, t))
    return (
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    )


def shade(normal: Vec3, position: Vec3) -> Vec3:
    """Three lights and one hue.

    Key and fill do the modelling; the rim separates the silhouette from whatever the mark is
    placed on, which matters because the canvas is transparent and the host chooses the ground.
    Vertical position feeds a gradient so the piece reads as lit from above rather than uniformly
    tinted, the same way the other marks in the suite do.
    """
    view = normalise(sub(EYE, position))
    key = normalise(KEY_LIGHT)
    fill = normalise(FILL_LIGHT)
    rim = normalise(RIM_LIGHT)

    key_diffuse = max(0.0, dot(normal, key))
    fill_diffuse = max(0.0, dot(normal, fill))
    rim_term = max(0.0, dot(normal, rim)) * (1.0 - max(0.0, dot(normal, view))) ** 1.4

    half = normalise(add(key, view))
    specular = max(0.0, dot(normal, half)) ** 38.0

    height = max(0.0, min(1.0, position[1] / CROWN_TOP))
    base = mix(DEEP, ACCENT, 0.28 + 0.72 * height)

    # A hemispherical ambient rather than a constant one. An upward-facing surface sees the whole
    # sky and a downward-facing one sees almost none of it, which darkens the underside of the
    # battlement and the tuck above the foot without any occlusion tracing. A flat ambient makes
    # exactly those places look like stickers.
    sky = 0.5 + 0.5 * normal[1]
    ambient = scale(DEEP, 0.42 + 1.55 * sky * sky)

    lit = add(ambient, scale(base, 1.55 * key_diffuse + 0.26 * fill_diffuse))
    lit = add(lit, scale(RIM, 0.95 * rim_term))
    lit = add(lit, scale(HIGHLIGHT, 1.15 * specular))
    return tuple(max(0.0, min(1.0, channel)) for channel in lit)


def to_srgb(linear: float) -> int:
    value = 1.055 * (linear ** (1.0 / 2.2)) - 0.055 if linear > 0.0031308 else linear * 12.92
    return max(0, min(255, round(value * 255)))


# ---------------------------------------------------------------------------
# Rasteriser
# ---------------------------------------------------------------------------


def render(mesh: Mesh, resolution: int) -> Image.Image:
    right, up, forward = view_basis()
    focal = 1.0 / math.tan(math.radians(FOV_DEGREES) * 0.5)
    half = resolution * 0.5

    projected: list[tuple[float, float, float] | None] = []
    for vertex in mesh.vertices:
        offset = sub(vertex, EYE)
        depth = dot(offset, forward)
        if depth <= 1e-4:
            projected.append(None)
            continue
        x = dot(offset, right) / depth * focal
        y = dot(offset, up) / depth * focal
        projected.append((half + x * half, half - y * half, depth))

    colour = bytearray(resolution * resolution * 3)
    alpha = bytearray(resolution * resolution)
    depth_buffer = [math.inf] * (resolution * resolution)

    for a, b, c in mesh.faces:
        pa, pb, pc = projected[a], projected[b], projected[c]
        if pa is None or pb is None or pc is None:
            continue
        va, vb, vc = mesh.vertices[a], mesh.vertices[b], mesh.vertices[c]
        if dot(cross(sub(vb, va), sub(vc, va)), sub(EYE, va)) <= 0.0:
            continue  # Facing away from the camera.
        area = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0])
        if area == 0.0:
            continue

        min_x = max(0, int(math.floor(min(pa[0], pb[0], pc[0]))))
        max_x = min(resolution - 1, int(math.ceil(max(pa[0], pb[0], pc[0]))))
        min_y = max(0, int(math.floor(min(pa[1], pb[1], pc[1]))))
        max_y = min(resolution - 1, int(math.ceil(max(pa[1], pb[1], pc[1]))))
        if min_x > max_x or min_y > max_y:
            continue

        inverse_area = 1.0 / area
        for py in range(min_y, max_y + 1):
            sample_y = py + 0.5
            for px in range(min_x, max_x + 1):
                sample_x = px + 0.5
                # An edge function is zero along its edge and one at the opposite vertex, so the
                # edge through a and b weights c, and the edge through b and c weights a. Getting
                # this pairing wrong interpolates each triangle from the wrong corners, which shows
                # up as a seam at every triangle boundary rather than as an obviously broken image.
                weight_c = (
                    (pb[0] - pa[0]) * (sample_y - pa[1]) - (pb[1] - pa[1]) * (sample_x - pa[0])
                ) * inverse_area
                weight_a = (
                    (pc[0] - pb[0]) * (sample_y - pb[1]) - (pc[1] - pb[1]) * (sample_x - pb[0])
                ) * inverse_area
                weight_b = 1.0 - weight_c - weight_a
                if weight_a < 0.0 or weight_b < 0.0 or weight_c < 0.0:
                    continue
                depth = weight_a * pa[2] + weight_b * pb[2] + weight_c * pc[2]
                index = py * resolution + px
                if depth >= depth_buffer[index]:
                    continue
                depth_buffer[index] = depth
                normal = normalise(
                    add(
                        add(scale(mesh.normals[a], weight_a), scale(mesh.normals[b], weight_b)),
                        scale(mesh.normals[c], weight_c),
                    )
                )
                position = add(
                    add(scale(mesh.vertices[a], weight_a), scale(mesh.vertices[b], weight_b)),
                    scale(mesh.vertices[c], weight_c),
                )
                shaded = shade(normal, position)
                colour[index * 3] = to_srgb(shaded[0])
                colour[index * 3 + 1] = to_srgb(shaded[1])
                colour[index * 3 + 2] = to_srgb(shaded[2])
                alpha[index] = 255

    rgb = Image.frombytes("RGB", (resolution, resolution), bytes(colour))
    mask = Image.frombytes("L", (resolution, resolution), bytes(alpha))
    rgb.putalpha(mask)
    return rgb


def frame(rendered: Image.Image, margin: float) -> Image.Image:
    """Centres the piece and gives it the same clear space at every size.

    The camera decides where the rook lands in the frame, and nudging the camera to centre it also
    changes the perspective. Framing afterwards keeps the two decisions apart: the camera chooses
    the view, this chooses the composition.
    """
    box = rendered.getchannel("A").getbbox()
    if box is None:
        return rendered
    edge = rendered.width
    piece = rendered.crop(box)
    available = edge * (1.0 - 2.0 * margin)
    factor = min(available / piece.width, available / piece.height)
    resized = piece.resize(
        (max(1, round(piece.width * factor)), max(1, round(piece.height * factor))),
        Image.LANCZOS,
    )
    canvas = Image.new("RGBA", (edge, edge), (0, 0, 0, 0))
    canvas.paste(resized, ((edge - resized.width) // 2, (edge - resized.height) // 2))
    return canvas


# ---------------------------------------------------------------------------
# README banner
#
# The suite's banners were composed as Imago documents and exported. Imago is not runnable here,
# so this reproduces the same recipe — charcoal radial field, the product accent at the edges,
# the name in Space Grotesk, the mark placed unaltered — from the tokens rather than by eye.
# ---------------------------------------------------------------------------

BANNER_SIZE = (1600, 500)
BANNER_INK = (0x14, 0x16, 0x18)
BANNER_EDGE = (0x0A, 0x0C, 0x0D)
BANNER_TEXT = (0xF0, 0xED, 0xE6)
SPACE_GROTESK = (
    "https://github.com/floriankarsten/space-grotesk/raw/master/fonts/otf/SpaceGrotesk-Bold.otf"
)


def banner_field() -> Image.Image:
    """A charcoal radial field with the accent bleeding in from the right edge."""
    width, height = BANNER_SIZE
    field = Image.new("RGB", BANNER_SIZE, BANNER_EDGE)
    pixels = field.load()
    accent = tuple(round(channel * 255) for channel in to_srgb_triple(ACCENT))
    centre_x, centre_y = width * 0.34, height * 0.5
    longest = math.hypot(max(centre_x, width - centre_x), max(centre_y, height - centre_y))
    for y in range(height):
        for x in range(width):
            radial = 1.0 - min(1.0, math.hypot(x - centre_x, y - centre_y) / longest)
            base = [
                round(BANNER_EDGE[i] + (BANNER_INK[i] - BANNER_EDGE[i]) * (radial ** 0.7))
                for i in range(3)
            ]
            # The accent arrives from the right edge and from the far left corner, never across
            # the middle, so the mark and the name stay on flat ground.
            edge = max(0.0, (x - width * 0.72) / (width * 0.28)) ** 2.1
            edge += max(0.0, (width * 0.06 - x) / (width * 0.06)) ** 2.0 * 0.5
            edge = min(1.0, edge) * 0.55
            pixels[x, y] = tuple(round(base[i] + (accent[i] - base[i]) * edge) for i in range(3))
    return field


def to_srgb_triple(linear: Vec3) -> Vec3:
    return tuple(to_srgb(channel) / 255.0 for channel in linear)


def load_banner_font(size: int) -> ImageFont.FreeTypeFont:
    """Space Grotesk if it can be fetched or found, otherwise whatever the system offers."""
    cache = Path.home() / ".cache" / "learnchess-brand"
    cache.mkdir(parents=True, exist_ok=True)
    local = cache / "SpaceGrotesk-Bold.otf"
    if not local.exists():
        try:
            from urllib.request import urlopen

            with urlopen(SPACE_GROTESK, timeout=30) as response:
                local.write_bytes(response.read())
        except Exception as error:  # noqa: BLE001 - a fallback face is better than no banner
            print(f"Space Grotesk unavailable ({error}); falling back to a system face")
    for candidate in (local, Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")):
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


def compose_banner(mark: Image.Image, destination: Path) -> None:
    width, height = BANNER_SIZE
    banner = banner_field().convert("RGBA")

    # The mark keeps its own clear space; it is placed, not redrawn or recropped.
    target = round(height * 0.62)
    placed = mark.resize((target, target), Image.LANCZOS)
    banner.alpha_composite(placed, (round(width * 0.055), (height - target) // 2))

    draw = ImageDraw.Draw(banner)
    font = load_banner_font(round(height * 0.17))
    draw.text((round(width * 0.30), height // 2), "LearnChess", font=font, fill=BANNER_TEXT, anchor="lm")

    destination.parent.mkdir(parents=True, exist_ok=True)
    banner.convert("RGB").save(destination)
    print(f"wrote {destination} ({width}x{height})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="public/brand", help="Directory for the rendered files")
    parser.add_argument("--banner", help="Also compose the README banner at this path")
    parser.add_argument("--size", type=int, default=1024, help="Largest output edge in pixels")
    parser.add_argument(
        "--margin",
        type=float,
        default=0.07,
        help="Clear space around the piece, as a fraction of the canvas edge",
    )
    parser.add_argument(
        "--supersample",
        type=int,
        default=3,
        help="Render at this multiple and downsample, which is where the antialiasing comes from",
    )
    arguments = parser.parse_args()

    out = Path(arguments.out)
    out.mkdir(parents=True, exist_ok=True)

    mesh = build_rook()
    print(f"rook: {len(mesh.vertices)} vertices, {len(mesh.faces)} triangles")

    resolution = arguments.size * arguments.supersample
    print(f"rendering at {resolution}x{resolution}, downsampling to {arguments.size}")
    rendered = frame(render(mesh, resolution), arguments.margin)
    master = rendered.resize((arguments.size, arguments.size), Image.LANCZOS)

    master.save(out / "learnchess-app-art.png")
    for size in (512, 256, 128, 64, 32):
        if size > arguments.size:
            continue
        master.resize((size, size), Image.LANCZOS).save(out / f"learnchess-mark-{size}.png")
    print(f"wrote {out}/learnchess-app-art.png and the standard sizes")
    if arguments.banner:
        compose_banner(master, Path(arguments.banner))


if __name__ == "__main__":
    main()
