"""Generate Sinput app icons — green I-beam cursor on dark background.
Generates PWA icons, Tauri desktop icons, macOS .icns, Windows .ico, and tray icons.
"""
from PIL import Image, ImageDraw, ImageFilter
import subprocess, os, shutil, tempfile

ICONS_DIR = "desktop/src-tauri/icons"


def draw_cursor_and_arcs(img: Image.Image, size: int, color: tuple, with_glow=True):
    """Draw the I-beam cursor + signal arcs onto an existing RGBA image."""
    draw = ImageDraw.Draw(img)

    cx = size * 0.54
    cy = size * 0.5

    # --- Glow layer behind cursor ---
    if with_glow:
        glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        glow_draw = ImageDraw.Draw(glow)
        glow_r = int(size * 0.12)
        glow_draw.ellipse(
            [cx - glow_r, cy - size * 0.28, cx + glow_r, cy + size * 0.28],
            fill=(*color[:3], 25)
        )
        glow = glow.filter(ImageFilter.GaussianBlur(radius=max(size * 0.06, 1)))
        img = Image.alpha_composite(img, glow)
        draw = ImageDraw.Draw(img)

    # --- I-beam cursor ---
    bar_w = max(int(size * 0.022), 2)
    bar_h = int(size * 0.38)
    serif_w = int(size * 0.09)
    serif_h = max(int(size * 0.018), 2)
    bar_x = int(cx - bar_w / 2)
    bar_y = int(cy - bar_h / 2)
    sx = int(cx - serif_w / 2)

    draw.rounded_rectangle([bar_x, bar_y, bar_x + bar_w, bar_y + bar_h],
                           radius=max(bar_w // 2, 1), fill=color)
    draw.rounded_rectangle([sx, bar_y, sx + serif_w, bar_y + serif_h],
                           radius=max(serif_h // 2, 1), fill=color)
    draw.rounded_rectangle([sx, bar_y + bar_h - serif_h, sx + serif_w, bar_y + bar_h],
                           radius=max(serif_h // 2, 1), fill=color)

    # --- Signal arcs ---
    arc_cx = cx - size * 0.06
    arc_cy = cy
    arcs = [(size * 0.07, 180), (size * 0.13, 130), (size * 0.19, 100)]
    opacities = [220, 140, 70]
    stroke = max(int(size * 0.016), 2)

    for (r, sweep), alpha in zip(arcs, opacities):
        half = sweep / 2
        bbox = [int(arc_cx - r), int(arc_cy - r), int(arc_cx + r), int(arc_cy + r)]
        layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(layer).arc(bbox, 180 - half, 180 + half,
                                  fill=(*color[:3], alpha), width=stroke)
        img = Image.alpha_composite(img, layer)

    return img


def make_app_icon(size: int, path: str, force_rgb=False):
    """Full app icon: dark rounded-rect bg + green cursor."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = int(size * 0.22)
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill="#0A0A0A")

    green = (34, 197, 94, 255)
    img = draw_cursor_and_arcs(img, size, green, with_glow=True)

    if force_rgb:
        # PWA icons: no transparency needed
        final = Image.new("RGB", (size, size), (10, 10, 10))
        final.paste(img, mask=img.split()[3])
        final.save(path, "PNG", optimize=True)
    else:
        # Desktop icons: keep RGBA (Tauri requires it)
        img.save(path, "PNG", optimize=True)
    print(f"  {path} ({size}x{size})")


def make_tray_icon(size: int, path: str, color: tuple):
    """Tray icon: transparent bg, bold cursor + 2 arcs. Optimized for menubar legibility."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cx = size * 0.56
    cy = size * 0.5

    # Bold I-beam cursor — much thicker than app icon version
    bar_w = max(int(size * 0.07), 3)       # ~3px at 44
    bar_h = int(size * 0.58)               # taller relative to canvas
    serif_w = int(size * 0.25)             # wider serifs
    serif_h = max(int(size * 0.065), 3)    # thicker serifs

    bar_x = int(cx - bar_w / 2)
    bar_y = int(cy - bar_h / 2)
    sx = int(cx - serif_w / 2)

    draw.rounded_rectangle([bar_x, bar_y, bar_x + bar_w, bar_y + bar_h],
                           radius=max(bar_w // 2, 1), fill=color)
    draw.rounded_rectangle([sx, bar_y, sx + serif_w, bar_y + serif_h],
                           radius=max(serif_h // 2, 1), fill=color)
    draw.rounded_rectangle([sx, bar_y + bar_h - serif_h, sx + serif_w, bar_y + bar_h],
                           radius=max(serif_h // 2, 1), fill=color)

    # 2 bold arcs only
    arc_cx = cx - size * 0.08
    arc_cy = cy
    arcs = [(size * 0.14, 150), (size * 0.24, 110)]
    opacities = [255, 160]
    stroke = max(int(size * 0.055), 3)     # ~2-3px bold stroke

    for (r, sweep), alpha in zip(arcs, opacities):
        half = sweep / 2
        bbox = [int(arc_cx - r), int(arc_cy - r), int(arc_cx + r), int(arc_cy + r)]
        layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(layer).arc(bbox, 180 - half, 180 + half,
                                  fill=(*color[:3], alpha), width=stroke)
        img = Image.alpha_composite(img, layer)

    img.save(path, "PNG", optimize=True)
    print(f"  {path} ({size}x{size} tray)")


def make_icns(source_512: str, out_path: str):
    """Generate macOS .icns from 512px source using iconutil."""
    iconset = tempfile.mkdtemp(suffix=".iconset")
    sizes = [16, 32, 64, 128, 256, 512]
    src = Image.open(source_512)

    for s in sizes:
        resized = src.resize((s, s), Image.LANCZOS)
        resized.save(os.path.join(iconset, f"icon_{s}x{s}.png"))
        # @2x versions
        if s <= 256:
            big = src.resize((s * 2, s * 2), Image.LANCZOS)
            big.save(os.path.join(iconset, f"icon_{s}x{s}@2x.png"))

    # Rename directory to have .iconset extension
    iconset_named = iconset.replace(os.path.basename(iconset),
                                     os.path.basename(iconset).replace(".iconset", "") + ".iconset")
    if iconset != iconset_named:
        os.rename(iconset, iconset_named)
        iconset = iconset_named

    subprocess.run(["iconutil", "-c", "icns", iconset, "-o", out_path], check=True)
    shutil.rmtree(iconset)
    print(f"  {out_path} (icns)")


def make_ico(source_512: str, out_path: str):
    """Generate Windows .ico with multiple sizes."""
    src = Image.open(source_512)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    imgs = [src.resize((s, s), Image.LANCZOS) for s in sizes]
    imgs[0].save(out_path, format="ICO", sizes=[(s, s) for s in sizes], append_images=imgs[1:])
    print(f"  {out_path} (ico)")


if __name__ == "__main__":
    print("Generating Sinput icons...\n[PWA]")
    make_app_icon(512, "pwa/public/icon-512.png", force_rgb=True)
    make_app_icon(192, "pwa/public/icon-192.png", force_rgb=True)
    make_app_icon(180, "pwa/public/apple-touch-icon.png", force_rgb=True)

    print("\n[Desktop — app icons]")
    # Tauri required sizes
    make_app_icon(512, f"{ICONS_DIR}/icon.png")
    make_app_icon(256, f"{ICONS_DIR}/128x128@2x.png")
    make_app_icon(128, f"{ICONS_DIR}/128x128.png")
    make_app_icon(32, f"{ICONS_DIR}/32x32.png")

    # Windows Store icons
    for s in [30, 44, 71, 89, 107, 142, 150, 284, 310]:
        make_app_icon(s, f"{ICONS_DIR}/Square{s}x{s}Logo.png")
    make_app_icon(50, f"{ICONS_DIR}/StoreLogo.png")

    print("\n[Desktop — tray icons]")
    green = (34, 197, 94, 255)
    gray = (163, 163, 163, 255)  # --text2 color for default/inactive
    make_tray_icon(44, f"{ICONS_DIR}/tray-default.png", gray)
    make_tray_icon(44, f"{ICONS_DIR}/tray-connected.png", green)
    # Also generate a larger tray icon as source
    make_tray_icon(128, f"{ICONS_DIR}/tray-icon.png", gray)

    print("\n[Desktop — icns/ico]")
    make_icns(f"{ICONS_DIR}/icon.png", f"{ICONS_DIR}/icon.icns")
    make_ico(f"{ICONS_DIR}/icon.png", f"{ICONS_DIR}/icon.ico")

    print("\nDone. All icons generated.")
